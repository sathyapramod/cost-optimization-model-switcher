import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildQualityEvidenceIndex,
  mergeLiveRunsIntoEvidenceIndex,
  resetQualityEvidenceCache,
} from "../quality-evidence.js";
import type { LiveBenchmarkRun } from "../task-quality/live-evaluation.js";
import { buildLiveUserPrompt } from "../task-quality/case-input.js";
import { loadTaskQualityFixtures } from "../task-quality/fixtures.js";

describe("live evidence merge", () => {
  it("merges train-split live runs into fixture evidence and ignores holdout", () => {
    resetQualityEvidenceCache();
    const base = buildQualityEvidenceIndex({ split: "train" });
    const before = base.records.find((r) => r.modelId === "claude-haiku-4-5");
    assert.ok(before);

    const liveRuns: LiveBenchmarkRun[] = [
      {
        taskId: "sum-ci-log-errors",
        domain: "summarization",
        benchmarkSplit: "train",
        provider: "anthropic",
        modelId: "claude-haiku-4-5",
        completedAt: new Date().toISOString(),
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 5,
        output: "test",
        evaluation: {
          passed: true,
          qualityScore: 0.95,
          specId: before!.specId,
          errors: [],
          evaluator: before!.evaluatorId,
        },
        evidenceEligible: true,
      },
      {
        taskId: "sum-release-breaking",
        domain: "summarization",
        benchmarkSplit: "holdout",
        provider: "anthropic",
        modelId: "claude-haiku-4-5",
        completedAt: new Date().toISOString(),
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 5,
        output: "test",
        evaluation: {
          passed: false,
          qualityScore: 0.1,
          specId: before!.specId,
          errors: [],
          evaluator: before!.evaluatorId,
        },
        evidenceEligible: false,
      },
    ];

    const merged = mergeLiveRunsIntoEvidenceIndex(base, liveRuns);
    const after = merged.records.find(
      (r) => r.modelId === "claude-haiku-4-5" && r.specId === before!.specId,
    );
    assert.ok(after);
    assert.equal(after!.evidenceSource, "live");
    assert.ok(after!.runs.some((r) => r.runSource === "live" && r.taskId === "sum-ci-log-errors"));
    assert.ok(!after!.runs.some((r) => r.taskId === "sum-release-breaking"));
    assert.ok(after!.sampleCount > before!.sampleCount);
  });

  it("buildLiveUserPrompt includes asset text for holdout summarization case", () => {
    const suite = loadTaskQualityFixtures();
    const case_ = suite.cases.find((c) => c.id === "sum-release-breaking");
    assert.ok(case_);
    const prompt = buildLiveUserPrompt(case_!);
    assert.match(prompt, /SOURCE MATERIAL/);
    assert.match(prompt, /displayName|v2\/users/i);
  });
});
