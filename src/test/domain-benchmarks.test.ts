import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BENCHMARK_DOMAIN_DIRS,
  loadDomainBenchmarkSuites,
} from "../task-quality/domain-benchmark-loader.js";
import { resetTaskQualityFixturesCache, loadTaskQualityFixtures } from "../task-quality/fixtures.js";
import { runTaskQualityEvaluation } from "../task-quality/runner.js";

describe("domain task-quality benchmarks", () => {
  it("loads at least 3 cases per domain folder", () => {
    const { suites, cases } = loadDomainBenchmarkSuites();
    assert.equal(suites.length, BENCHMARK_DOMAIN_DIRS.length);
    for (const domain of BENCHMARK_DOMAIN_DIRS) {
      const count = cases.filter((c) => c.domain === domain).length;
      assert.ok(count >= 3, `${domain} expected >=3 cases, got ${count}`);
    }
  });

  it("each case includes task, criteria, evaluator, and candidates", () => {
    const { cases } = loadDomainBenchmarkSuites();
    for (const c of cases) {
      assert.ok(c.userMessage.length > 0, c.id);
      assert.ok(c.evaluationCriteria?.length, c.id);
      assert.ok(c.evaluator, c.id);
      assert.ok(c.candidates.length >= 1, c.id);
    }
  });

  it("report includes model×domain comparison metrics", () => {
    resetTaskQualityFixturesCache();
    const report = runTaskQualityEvaluation();
    assert.ok(report.summary.byModelDomain.length >= 8);
    const row = report.summary.byModelDomain.find((r) => r.domain === "analytical");
    assert.ok(row);
    assert.ok(typeof row!.failureRate === "number");
    assert.ok(typeof row!.meanQuality === "number");
    assert.ok(typeof row!.meanCostUsd === "number");
    assert.ok(typeof row!.meanLatencyMs === "number");
  });

  it("merged fixture loader includes domain cases", () => {
    resetTaskQualityFixturesCache();
    const suite = loadTaskQualityFixtures();
    assert.ok(suite.cases.some((c) => c.id === "sum-ci-log-errors"));
    assert.ok(suite.cases.some((c) => c.id === "ana-10x-workload"));
  });
});
