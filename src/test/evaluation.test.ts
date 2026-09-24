import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertAdversarialSuite, runAdversarialSuite } from "../adversarial.js";
import { assertEvaluation, runEvaluation } from "../evaluation.js";

describe("evaluation framework", () => {
  it("adversarial suite passes all cases", () => {
    const report = runAdversarialSuite();
    assert.equal(report.summary.failed, 0);
    assert.ok(report.summary.caseCount >= 10);
    assertAdversarialSuite(report);
  });

  it("full evaluation passes benchmark + adversarial", () => {
    const report = runEvaluation();
    assert.equal(report.summary.passed, true);
    assert.equal(report.summary.benchmarkFailures, 0);
    assert.equal(report.summary.adversarialFailures, 0);
    assertEvaluation(report);
  });
});
