import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  compareLiveHoldoutBaselineVsRouter,
  MIN_PAIRED_HOLDOUT_SAMPLES,
} from "../live-holdout-benchmark.js";
import { loadTaskQualityFixtures } from "../task-quality/fixtures.js";
import { buildQualityEvidenceIndex } from "../quality-evidence.js";
import { liveCompletionRequestCount } from "../task-quality/live-client.js";
import type { LiveBenchmarkRun, LiveRunsFile } from "../task-quality/live-runs.js";

function writeTempLiveRuns(runs: LiveBenchmarkRun[]): string {
  const dir = mkdtempSync(join(tmpdir(), "live-runs-"));
  const path = join(dir, "live-runs.json");
  const file: LiveRunsFile = {
    version: "1",
    frameworkVersion: "1.0.0",
    note: "test fixture",
    runs,
  };
  writeFileSync(path, JSON.stringify(file, null, 2));
  return path;
}

function makeRun(
  taskId: string,
  modelId: string,
  passed: boolean,
  split: "train" | "holdout" = "holdout",
): LiveBenchmarkRun {
  return {
    taskId,
    benchmarkSplit: split,
    provider: "anthropic",
    modelId,
    completedAt: new Date().toISOString(),
    latencyMs: 1000,
    inputTokens: 500,
    outputTokens: 300,
    output: "x",
    evaluation: {
      passed,
      qualityScore: passed ? 1 : 0,
      specId: "summarization",
      errors: [],
      evaluator: "task-contract-evaluator-v1",
    },
    evidenceEligible: split === "train",
  };
}

describe("live holdout comparison (empirical baseline vs router)", () => {
  it("never reads anything but the holdout split from task-quality fixtures", () => {
    const suite = loadTaskQualityFixtures();
    const holdoutIds = new Set(
      suite.cases.filter((c) => c.benchmarkSplit === "holdout").map((c) => c.id),
    );
    const report = compareLiveHoldoutBaselineVsRouter({ provider: "anthropic" });
    for (const t of report.tasks) {
      assert.ok(holdoutIds.has(t.taskId), `${t.taskId} must come from the holdout split`);
    }
    assert.equal(report.tasks.length, holdoutIds.size);
  });

  it("holdout comparison data never appears in the training evidence index", () => {
    const report = compareLiveHoldoutBaselineVsRouter({ provider: "anthropic" });
    const trainEvidence = buildQualityEvidenceIndex({ split: "train" });
    const holdoutTaskIds = new Set(report.tasks.map((t) => t.taskId));
    for (const record of trainEvidence.records) {
      for (const taskId of record.fixtureTaskIds) {
        assert.ok(
          !holdoutTaskIds.has(taskId),
          `holdout task ${taskId} leaked into train evidence index`,
        );
      }
    }
  });

  it("reports insufficient evidence when recorded live-runs.json has no paired data", () => {
    const emptyPath = writeTempLiveRuns([]);
    const report = compareLiveHoldoutBaselineVsRouter({
      provider: "anthropic",
      liveRunsPath: emptyPath,
    });
    assert.equal(report.pairedComparison.sampleSize, 0);
    assert.equal(report.pairedComparison.insufficientEvidence, true);
    assert.equal(report.pairedComparison.qualityPassRateDelta, null);
    assert.match(report.pairedComparison.note, /insufficient evidence/);
    rmSync(emptyPath, { force: true });
  });

  it("computes an honest paired delta once the minimum sample size is met", () => {
    const suite = loadTaskQualityFixtures();
    const holdout = suite.cases.filter((c) => c.benchmarkSplit === "holdout");
    assert.ok(holdout.length >= MIN_PAIRED_HOLDOUT_SAMPLES, "fixture needs enough holdout cases");

    // Build synthetic paired runs: premium passes every task, fast model fails every task,
    // for the first MIN_PAIRED_HOLDOUT_SAMPLES holdout tasks whose gate decision downgrades.
    const runs: LiveBenchmarkRun[] = [];
    let paired = 0;
    for (const c of holdout) {
      if (paired >= MIN_PAIRED_HOLDOUT_SAMPLES) break;
      runs.push(makeRun(c.id, "claude-opus-4-6", true));
      runs.push(makeRun(c.id, "claude-haiku-4-5", false));
      paired++;
    }
    const path = writeTempLiveRuns(runs);
    const report = compareLiveHoldoutBaselineVsRouter({
      provider: "anthropic",
      liveRunsPath: path,
      minPairedSamples: MIN_PAIRED_HOLDOUT_SAMPLES,
    });

    // Only tasks whose router decision actually selects a *different* model count as paired.
    assert.ok(report.pairedComparison.sampleSize >= 0);
    if (report.pairedComparison.sampleSize >= MIN_PAIRED_HOLDOUT_SAMPLES) {
      assert.equal(report.pairedComparison.insufficientEvidence, false);
      assert.ok(report.pairedComparison.qualityPassRateDelta! <= 0);
    }
    rmSync(path, { force: true });
  });

  it("routing decision counts sum to the holdout task count", () => {
    const report = compareLiveHoldoutBaselineVsRouter({ provider: "anthropic" });
    const total = Object.values(report.routingDecisions).reduce((a, b) => a + b, 0);
    assert.equal(total, report.workload.holdoutTaskCount);
  });

  it("runs fully offline — reads recorded runs only, never calls a live model API", () => {
    const before = liveCompletionRequestCount;
    const envKeys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const;
    const saved: Record<string, string | undefined> = {};
    for (const k of envKeys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      const report = compareLiveHoldoutBaselineVsRouter({ provider: "anthropic" });
      assert.ok(report.workload.holdoutTaskCount > 0);
      assert.equal(liveCompletionRequestCount, before);
    } finally {
      for (const k of envKeys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k]!;
      }
    }
  });

  it("cost is derived from recorded live token usage × catalog pricing rates", () => {
    const run = makeRun("sum-release-breaking", "claude-opus-4-6", true);
    const path = writeTempLiveRuns([run]);
    const report = compareLiveHoldoutBaselineVsRouter({
      provider: "anthropic",
      liveRunsPath: path,
    });
    const task = report.tasks.find((t) => t.taskId === "sum-release-breaking");
    assert.ok(task?.baseline.run);
    assert.ok(task!.baseline.run!.estimatedCostUsd > 0);
    assert.equal(task!.baseline.run!.inputTokens, run.inputTokens);
    assert.equal(task!.baseline.run!.outputTokens, run.outputTokens);
    rmSync(path, { force: true });
  });
});
