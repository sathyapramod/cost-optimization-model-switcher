import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadDefaultCatalog, resolveModel } from "../catalog.js";
import { routeByCapabilities } from "../capability-router.js";
import { analyzeTask } from "../task-analyzer.js";
import {
  DEFAULT_PROGRESSIVE_ROUTING_CONFIG,
  EXPERIMENTAL_PROGRESSIVE_ROUTING_ENABLED,
  executeExperimentalProgressiveRouting,
} from "../progressive-routing.js";

const catalog = loadDefaultCatalog();
const provider = "anthropic";

const CRITERIA = [
  {
    id: "task_ok",
    description: "Output marks success",
    type: "structured" as const,
    required: true,
    spec: { mustInclude: ["PROGRESSIVE_PASS"] },
  },
];

function baseInput(
  outputs: Record<string, string>,
  opts?: { enabled?: boolean },
) {
  const userMessage = "Summarize this 2MB CI log and list errors only";
  const probes = [{ source: "log_file" as const, bytes: 2_000_000 }];
  const analysis = analyzeTask({ userMessage, probes });
  const resolved = resolveModel("claude-opus-4-6", catalog, provider);
  const cap = routeByCapabilities({
    resolved,
    taskAnalysis: analysis,
    contextBand: analysis.contextBand,
    primarySource: analysis.primarySource,
    userMessage,
    taskDifficulty: analysis.taskDifficulty,
    switchDirection: "downgrade",
    effectiveInputTokens: analysis.estimatedInputTokens,
  });

  return {
    resolved,
    taskAnalysis: analysis,
    userMessage,
    effectiveInputTokens: analysis.estimatedInputTokens,
    capabilityResult: cap,
    evaluationCriteria: CRITERIA,
    criteriaSource: "fixture_only" as const,
    config: { ...DEFAULT_PROGRESSIVE_ROUTING_CONFIG, enabled: opts?.enabled ?? true },
    execute: (model: { modelId: string }) => ({
      output: outputs[model.modelId] ?? "no output",
      latencyMs: 100,
    }),
  };
}

describe("experimental progressive routing", () => {
  it("is disabled by default at module level", () => {
    assert.equal(EXPERIMENTAL_PROGRESSIVE_ROUTING_ENABLED, false);
    assert.equal(DEFAULT_PROGRESSIVE_ROUTING_CONFIG.enabled, false);
  });

  it("returns disabled when config.enabled is false", async () => {
    const result = await executeExperimentalProgressiveRouting(
      baseInput({ "claude-haiku-4-5": "PROGRESSIVE_PASS" }, { enabled: false }),
    );
    assert.equal(result.stoppedReason, "disabled");
    assert.equal(result.attempts.length, 0);
  });

  it("cheap model succeeds on first attempt", async () => {
    const result = await executeExperimentalProgressiveRouting(
      baseInput({
        "claude-haiku-4-5": "PROGRESSIVE_PASS summary",
        "claude-sonnet-4-6": "unused",
        "claude-opus-4-6": "unused",
      }),
    );
    assert.equal(result.stoppedReason, "passed");
    assert.equal(result.initialModel?.modelId, "claude-haiku-4-5");
    assert.equal(result.finalModel?.modelId, "claude-haiku-4-5");
    assert.equal(result.evaluationResult?.passed, true);
    assert.equal(result.escalatedFrom, null);
    assert.equal(result.escalatedTo, null);
    assert.equal(result.attempts.length, 1);
  });

  it("cheap fails → balanced succeeds", async () => {
    const result = await executeExperimentalProgressiveRouting(
      baseInput({
        "claude-haiku-4-5": "incomplete",
        "claude-sonnet-4-6": "PROGRESSIVE_PASS with detail",
        "claude-opus-4-6": "unused",
      }),
    );
    assert.equal(result.stoppedReason, "passed");
    assert.equal(result.initialModel?.modelId, "claude-haiku-4-5");
    assert.equal(result.finalModel?.modelId, "claude-sonnet-4-6");
    assert.equal(result.escalatedFrom, "claude-haiku-4-5");
    assert.equal(result.escalatedTo, "claude-sonnet-4-6");
    assert.ok(result.escalationReason);
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0]!.passed, false);
    assert.equal(result.attempts[1]!.passed, true);
  });

  it("cheap fails → balanced fails → premium succeeds", async () => {
    const result = await executeExperimentalProgressiveRouting(
      baseInput({
        "claude-haiku-4-5": "fail",
        "claude-sonnet-4-6": "still wrong",
        "claude-opus-4-6": "PROGRESSIVE_PASS final",
      }),
    );
    assert.equal(result.stoppedReason, "passed");
    assert.equal(result.finalModel?.modelId, "claude-opus-4-6");
    assert.equal(result.escalatedTo, "claude-opus-4-6");
    assert.equal(result.attempts.length, 3);
  });

  it("all models fail", async () => {
    const result = await executeExperimentalProgressiveRouting(
      baseInput({
        "claude-haiku-4-5": "nope",
        "claude-sonnet-4-6": "nope",
        "claude-opus-4-6": "nope",
      }),
    );
    assert.equal(result.stoppedReason, "exhausted_models");
    assert.equal(result.evaluationResult?.passed, false);
    assert.equal(result.attempts.length, 3);
    assert.ok(result.attempts.every((a) => !a.passed));
  });

  it("prevents thrashing when the ladder repeats a model id", async () => {
    const input = baseInput({ "claude-haiku-4-5": "fail" });
    const haiku = input.capabilityResult!.capableModels.find(
      (m) => m.modelId === "claude-haiku-4-5",
    )!;
    let calls = 0;
    const result = await executeExperimentalProgressiveRouting({
      ...input,
      config: { enabled: true, antiThrashing: true, maxAttempts: 5 },
      capabilityResult: {
        ...input.capabilityResult!,
        capableModels: [haiku, haiku],
      },
      execute: () => {
        calls++;
        return { output: "fail" };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.stoppedReason, "thrashing_prevented");
  });
});
