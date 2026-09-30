import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadDomainBenchmarkSuites } from "../task-quality/domain-benchmark-loader.js";
import { runHeldOutBenchmarkEvaluation } from "../task-quality/runner.js";

const PRIORITY_DOMAINS = [
  "summarization",
  "coding",
  "code-review",
  "debugging",
  "analytical",
] as const;

describe("held-out benchmarks", () => {
  it("has at least one holdout case per priority domain with evaluable criteria", () => {
    const { cases } = loadDomainBenchmarkSuites();
    for (const domain of PRIORITY_DOMAINS) {
      const holdout = cases.filter(
        (c) => c.domain === domain && c.benchmarkSplit === "holdout",
      );
      assert.ok(holdout.length >= 1, `${domain} holdout`);
      for (const c of holdout) {
        assert.ok(c.evaluationCriteria?.length, c.id);
        const hasCheck = c.evaluationCriteria!.some(
          (cr) =>
            cr.spec &&
            (cr.spec.mustInclude?.length ||
              cr.spec.patternsAny?.length ||
              cr.spec.check ||
              cr.spec.testPatterns?.length),
        );
        assert.ok(hasCheck, `${c.id} needs substantive evaluator spec`);
      }
    }
  });

  it("runHeldOutBenchmarkEvaluation evaluates only holdout cases", () => {
    const report = runHeldOutBenchmarkEvaluation();
    assert.ok(report.summary.caseCount >= PRIORITY_DOMAINS.length);
    assert.match(report.note, /Held-out/i);
    const ids = report.cases.map((c) => c.caseId);
    assert.ok(ids.includes("sum-release-breaking"));
    assert.ok(!ids.includes("sum-ci-log-errors"));
  });
});
