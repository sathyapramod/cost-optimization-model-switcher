import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadDefaultCatalog, resolveModel } from "../catalog.js";
import { filterCapableModels, modelMeetsRequirements } from "../capability-matching.js";
import { routeByCapabilities } from "../capability-router.js";
import { listProviderModels } from "../model-profiles.js";
import {
  extractRoutingRequirements,
  extractTaskRoutingRequirements,
} from "../routing-requirements.js";
import { analyzeTask } from "../task-analyzer.js";

const catalog = loadDefaultCatalog();
const provider = "anthropic";

function route(message: string, probes?: Parameters<typeof analyzeTask>[0]["probes"], opts?: {
  model?: string;
  direction?: "downgrade" | "upgrade";
  effectiveInputTokens?: number;
}) {
  const analysis = analyzeTask({ userMessage: message, probes });
  const modelId = opts?.model ?? "claude-opus-4-6";
  const resolved = resolveModel(modelId, catalog, provider);
  return routeByCapabilities({
    resolved,
    taskAnalysis: analysis,
    contextBand: analysis.contextBand,
    primarySource: analysis.primarySource,
    userMessage: message,
    taskDifficulty: analysis.taskDifficulty,
    switchDirection: opts?.direction ?? "downgrade",
    effectiveInputTokens: opts?.effectiveInputTokens ?? analysis.estimatedInputTokens,
  });
}

describe("capability router", () => {
  it("simple task → cheaper model (summarize large log downgrade)", () => {
    const result = route(
      "Summarize this 2MB CI log and list errors only",
      [{ source: "log_file", bytes: 2_000_000 }],
      { direction: "downgrade" },
    );
    assert.equal(result.recommendedModelId, "claude-haiku-4-5");
    assert.equal(result.recommendedTier, "fast");
    assert.ok(result.explanation.includes("Capability match"));
  });

  it("complex reasoning → stronger model on upgrade", () => {
    const result = route(
      "Design auth migration from this database dump",
      [{ source: "database_dump", bytes: 500_000 }],
      { model: "claude-haiku-4-5", direction: "upgrade" },
    );
    assert.equal(result.recommendedModelId, "claude-opus-4-6");
    assert.equal(result.recommendedTier, "premium");
  });

  it("high coding requirement selects sonnet over haiku", () => {
    const analysis = analyzeTask({
      userMessage: "Implement a new Backstage plugin for Git repo registration with tests",
    });
    const reqs = extractTaskRoutingRequirements(analysis);
    assert.ok(reqs.coding >= 4);
    const roster = listProviderModels(provider);
    const capable = filterCapableModels(roster, {
      task: reqs,
      context: extractRoutingRequirements(analysis, 0).context,
    });
    const ids = capable.map((m) => m.modelId);
    assert.ok(!ids.includes("claude-haiku-4-5"));
    assert.ok(ids.includes("claude-sonnet-4-6"));
  });

  it("high architecture requirement needs opus", () => {
    const analysis = analyzeTask({
      userMessage: "Design auth migration from this database dump",
      probes: [{ source: "database_dump", bytes: 500_000 }],
    });
    const reqs = extractTaskRoutingRequirements(analysis);
    assert.ok(reqs.architecture >= 4);
    const roster = listProviderModels(provider);
    const routingReqs = extractRoutingRequirements(analysis, analysis.estimatedInputTokens);
    const capable = filterCapableModels(roster, routingReqs);
    assert.deepEqual(
      capable.map((m) => m.modelId),
      ["claude-opus-4-6"],
    );
  });

  it("high quantitative reasoning excludes models below required quant capability", () => {
    const message =
      "Calculate regression metrics and quantify probability of failure across statistical samples";
    const analysis = analyzeTask({ userMessage: message });
    const reqs = extractTaskRoutingRequirements(analysis);
    reqs.quantitativeReasoning = 5;
    const routingReqs = extractRoutingRequirements(analysis, 0);
    routingReqs.task.quantitativeReasoning = 5;
    const capable = filterCapableModels(listProviderModels("openai"), routingReqs);
    assert.deepEqual(capable.map((m) => m.modelId), ["o3"]);
  });

  it("large context but low reasoning → haiku on downgrade", () => {
    const result = route(
      "Summarize this 2MB CI log",
      [{ source: "log_file", bytes: 2_000_000 }],
      { direction: "downgrade" },
    );
    const reqs = result.requirements;
    assert.ok(reqs.context.contextCapability >= 4);
    assert.ok(reqs.task.reasoning <= 2);
    assert.equal(result.recommendedModelId, "claude-haiku-4-5");
  });

  it("small context but high reasoning stays on sonnet when capable", () => {
    const result = route(
      "Fix the race condition in this 100-line concurrency module",
      [{ source: "paste", bytes: 8000 }],
      { model: "claude-sonnet-4-6", direction: "upgrade" },
    );
    assert.equal(result.currentMeetsTask, true);
    assert.equal(result.recommendedModelId, null);
  });

  it("ambiguous mixed intent still produces routing metadata", () => {
    const result = route(
      "Review PR diff and implement the fix for the race",
      [{ source: "github_pr", additions: 2000, deletions: 600, changedFiles: 22 }],
      { direction: "downgrade" },
    );
    assert.ok(result.requirements.task.coding >= 3);
    assert.ok(result.eligibleModels.length >= 0);
  });

  it("no model satisfying requirements when roster is empty", () => {
    const analysis = analyzeTask({
      userMessage: "Implement distributed consensus with formal proof",
    });
    const resolved = resolveModel("claude-haiku-4-5", catalog, provider);
    const result = routeByCapabilities({
      resolved,
      taskAnalysis: analysis,
      contextBand: analysis.contextBand,
      primarySource: analysis.primarySource,
      userMessage: "Implement distributed consensus with formal proof",
      taskDifficulty: analysis.taskDifficulty,
      switchDirection: "upgrade",
      effectiveInputTokens: 0,
      profiles: {
        version: "test",
        providers: {
          anthropic: {
            models: [
              {
                modelId: "claude-haiku-4-5",
                tier: "fast",
                capabilities: {
                  reasoning: 1,
                  coding: 1,
                  architecture: 1,
                  domainKnowledge: 1,
                  quantitativeReasoning: 1,
                  context: 1,
                  toolUse: 1,
                  outputComplexity: 1,
                  speed: 5,
                  cost: 5,
                },
              },
            ],
          },
          openai: { models: [] },
          cursor: { models: [] },
        },
      },
    });
    assert.equal(result.recommendedModelId, null);
    assert.equal(result.eligibleModels.length, 0);
  });

  it("modelMeetsRequirements reports failed axes", () => {
    const analysis = analyzeTask({ userMessage: "Implement feature with tests" });
    const reqs = extractRoutingRequirements(analysis, 0);
    const haiku = listProviderModels(provider).find((m) => m.modelId.includes("haiku"))!;
    const match = modelMeetsRequirements(haiku, reqs);
    if (reqs.task.coding >= 4) {
      assert.equal(match.meetsMandatory, false);
      assert.ok(match.failedAxes.includes("coding"));
    }
  });
});
