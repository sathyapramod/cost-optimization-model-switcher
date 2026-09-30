import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildQualityEvidenceIndex,
  resetQualityEvidenceCache,
} from "../quality-evidence.js";
import { TASK_CONTRACT_EVALUATOR_ID } from "../task-quality/evaluators.js";
import { TASK_QUALITY_FRAMEWORK_VERSION } from "../task-quality/runner.js";
import { resetTaskQualityFixturesCache } from "../task-quality/fixtures.js";

describe("evidence index v2", () => {
  it("includes passing and failing runs in aggregates", () => {
    resetTaskQualityFixturesCache();
    resetQualityEvidenceCache();
    const train = buildQualityEvidenceIndex({ split: "train" });
    assert.equal(train.version, "2");
    assert.equal(train.evaluatorId, TASK_CONTRACT_EVALUATOR_ID);
    assert.equal(train.evaluatorVersion, TASK_QUALITY_FRAMEWORK_VERSION);

    const withFails = train.records.filter((r) => r.failCount > 0);
    assert.ok(withFails.length > 0, "expected some models with failing fixture runs");

    const row = withFails[0]!;
    assert.equal(row.sampleCount, row.passCount + row.failCount);
    assert.ok(row.runs.some((run) => !run.passed));
    assert.ok(row.runs.some((run) => run.passed));
    assert.ok(row.meanQuality >= 0 && row.meanQuality <= 1);
    assert.ok(row.modelVersion.includes("@tier="));
  });

  it("holdout split is excluded from train evidence index", () => {
    const train = buildQualityEvidenceIndex({ split: "train" });
    const holdout = buildQualityEvidenceIndex({ split: "holdout" });
    assert.ok(holdout.records.length > 0);
    const trainIds = new Set(train.records.flatMap((r) => r.fixtureTaskIds));
    for (const r of holdout.records) {
      for (const id of r.fixtureTaskIds) {
        assert.ok(
          ["sum-release-breaking", "code-retry-wrapper", "review-idor", "dbg-wrong-env", "ana-queue-saturation"].includes(id),
        );
        assert.equal(trainIds.has(id), false);
      }
    }
  });
});
