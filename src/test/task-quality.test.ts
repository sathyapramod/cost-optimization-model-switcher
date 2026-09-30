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
  it("loads domain benchmark cases", () => {
    const suite = loadTaskQualityFixtures();
    const ids = suite.cases.map((c) => c.id);
    assert.ok(ids.includes("sum-ci-log-errors"));
    assert.ok(ids.includes("ext-jira-p0-json"));
    assert.ok(ids.includes("code-hello-endpoint"));
    assert.ok(ids.includes("review-sql-injection"));
    assert.ok(ids.includes("dbg-cache-race"));
    assert.ok(ids.includes("arch-auth-migration"));
    assert.ok(ids.includes("sec-api-audit"));
    assert.ok(ids.includes("ana-10x-workload"));
  });

  it("analytical fixture passes strong output and fails weak output", () => {
    const suite = loadTaskQualityFixtures();
    const case_ = suite.cases.find((c) => c.id === "ana-10x-workload")!;
    const good = evaluateTaskCandidate(case_, case_.candidates[0]!);
    const weak = evaluateTaskCandidate(case_, case_.candidates[1]!);
    assert.equal(good.passed, true);
    assert.ok(good.qualityScore >= 0.9);
    assert.equal(weak.passed, false);
    assert.ok(weak.qualityScore < 0.5);
    assert.ok(
      weak.criterionResults.some((r) => r.criterionId === "bottleneck_a" && !r.passed),
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
    assert.ok(report.summary.resultCount >= 24);
    assert.ok(report.summary.byModelDomain.length > 0);
    const first = report.cases[0]!.results[0]!;
    assert.ok(typeof first.latencyMs === "number");
    assert.ok(typeof first.estimatedCostUsd === "number");
    assert.ok(Array.isArray(first.criterionResults));
    const md = formatTaskQualityMarkdown(report);
    assert.match(md, /Task quality evaluation report/);
    assert.match(md, /not from benchmarks\/success-rates/i);
  });
});
