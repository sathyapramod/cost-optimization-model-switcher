import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateOutputAgainstCriteria,
  runTaskQualityEvaluation,
  formatTaskQualityMarkdown,
} from "../task-quality/index.js";
import { loadTaskQualityFixtures } from "../task-quality/fixtures.js";
import { evaluateTaskCandidate } from "../task-quality/runner.js";

describe("task quality evaluation", () => {
  it("loads fixtures for all required categories", () => {
    const suite = loadTaskQualityFixtures();
    const ids = suite.cases.map((c) => c.id);
    assert.ok(ids.includes("summarization-ci-log"));
    assert.ok(ids.includes("extraction-jira-p0"));
    assert.ok(ids.includes("code-generation-plugin"));
    assert.ok(ids.includes("code-review-sql"));
    assert.ok(ids.includes("debugging-race"));
    assert.ok(ids.includes("architecture-auth-migration"));
    assert.ok(ids.includes("analytical-10x-workload"));
  });

  it("analytical fixture passes strong output and fails weak output", () => {
    const suite = loadTaskQualityFixtures();
    const case_ = suite.cases.find((c) => c.id === "analytical-10x-workload")!;
    const good = evaluateTaskCandidate(case_, case_.candidates[0]!);
    const weak = evaluateTaskCandidate(case_, case_.candidates[1]!);
    assert.equal(good.passed, true);
    assert.ok(good.qualityScore >= 0.9);
    assert.equal(weak.passed, false);
    assert.ok(weak.qualityScore < 0.5);
    assert.ok(
      weak.criterionResults.some(
        (r) => r.criterionId === "identifies_bottleneck_a" && !r.passed,
      ),
    );
  });

  it("does not use a generic complexity score as evaluation target", () => {
    const suite = loadTaskQualityFixtures();
    const case_ = suite.cases[0]!;
    const result = evaluateTaskCandidate(case_, case_.candidates[0]!);
    assert.ok(
      result.criterionResults.every((r) => !r.criterionId.includes("complexity")),
    );
    assert.ok(result.criterionResults.length > 0);
  });

  it("llm_judge criterion is not the only path", () => {
    const results = evaluateOutputAgainstCriteria({
      output: "sample",
      criteria: [
        {
          id: "x",
          description: "d",
          type: "structured",
          required: true,
          spec: { mustInclude: ["sample"] },
        },
        {
          id: "j",
          description: "judge",
          type: "llm_judge",
          required: false,
        },
      ],
    });
    assert.equal(results[0]!.passed, true);
    assert.equal(results[1]!.passed, false);
    assert.match(results[1]!.details ?? "", /not implemented/i);
  });

  it("human review placeholder is explicit", () => {
    const results = evaluateOutputAgainstCriteria({
      output: "x",
      criteria: [
        {
          id: "h",
          description: "human",
          type: "human",
          required: true,
        },
      ],
    });
    assert.match(results[0]!.details ?? "", /human review/i);
  });

  it("runTaskQualityEvaluation produces report with cost and latency fields", () => {
    const report = runTaskQualityEvaluation();
    assert.ok(report.summary.resultCount >= 8);
    const first = report.cases[0]!.results[0]!;
    assert.ok(typeof first.latencyMs === "number");
    assert.ok(typeof first.estimatedCostUsd === "number");
    assert.ok(Array.isArray(first.criterionResults));
    const md = formatTaskQualityMarkdown(report);
    assert.match(md, /Task quality evaluation report/);
    assert.match(md, /not from benchmarks\/success-rates/i);
  });
});
