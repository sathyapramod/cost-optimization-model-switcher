import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultModelForTier, loadDefaultCatalog } from "../catalog.js";
import { evaluateGate } from "../gate.js";
import { buildSwitchCostEstimate } from "../cost.js";
import {
  aggregateStrategyQualityMetrics,
  classifyRoutingDecision,
  evaluateRouterBenchmarkTask,
  loadRouterBenchmarkWorkload,
  premiumBaselineModelId,
  resolveTaskQualityOutcome,
  runRouterBenchmark,
} from "../router-benchmark.js";
import type { TaskQualityOutcome } from "../router-benchmark.js";

describe("router benchmark", () => {
  it("premium baseline always uses premium model", () => {
    const report = runRouterBenchmark({ generatedAt: "2026-01-01T00:00:00.000Z" });
    const catalog = loadDefaultCatalog();
    const premiumId = defaultModelForTier(report.provider, "premium", catalog);
    for (const task of report.tasks) {
      assert.equal(task.baseline.tier, "premium");
      assert.equal(task.baseline.modelId, premiumId);
      assert.equal(premiumBaselineModelId(report.provider, catalog), premiumId);
    }
  });

  it("router path matches evaluateGate (production gate)", () => {
    const workload = loadRouterBenchmarkWorkload();
    const catalog = loadDefaultCatalog();
    const provider = "anthropic";
    const sample = workload.slice(0, 5);
    for (const task of sample) {
      const result = evaluateRouterBenchmarkTask(task, provider, "premium", catalog);
      const decision = evaluateGate({
        currentModel: defaultModelForTier(provider, "premium", catalog),
        provider,
        userMessage: task.userMessage,
        probes: task.probes,
      });
      assert.equal(result.router.gateAction, decision.action);
      assert.equal(result.router.routingDecision, classifyRoutingDecision(decision));
      if (decision.action === "suggest_switch") {
        assert.equal(
          result.router.executedTier,
          decision.suggestSwitch!.recommended_capability_tier,
        );
      }
    }
  });

  it("aggregates cost totals from per-task rows", () => {
    const report = runRouterBenchmark({ generatedAt: "2026-01-01T00:00:00.000Z" });
    const sumBaseline = report.tasks.reduce((a, t) => a + t.baseline.costUsd, 0);
    const sumRouter = report.tasks.reduce((a, t) => a + t.router.costUsd, 0);
    assert.equal(report.strategies.baselinePremium.totalCostUsd, Math.round(sumBaseline * 1e6) / 1e6);
    assert.equal(report.strategies.router.totalCostUsd, Math.round(sumRouter * 1e6) / 1e6);
    assert.equal(
      report.comparison.estimatedCostReductionUsd,
      Math.round((sumBaseline - sumRouter) * 1e6) / 1e6,
    );
  });

  it("routing decision counts match per-task labels", () => {
    const report = runRouterBenchmark({ generatedAt: "2026-01-01T00:00:00.000Z" });
    const counts = { downgrade: 0, upgrade: 0, stay: 0, abstain: 0 };
    for (const t of report.tasks) {
      counts[t.router.routingDecision]++;
    }
    assert.deepEqual(counts, report.strategies.router.routingDecisions);
  });

  it("is deterministic when generatedAt is fixed", () => {
    const a = runRouterBenchmark({ generatedAt: "fixed" });
    const b = runRouterBenchmark({ generatedAt: "fixed" });
    assert.deepEqual(
      { ...a, generatedAt: "fixed" },
      { ...b, generatedAt: "fixed" },
    );
  });

  it("runs offline without provider API keys", () => {
    const envKeys = [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "CURSOR_API_KEY",
    ] as const;
    const saved: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};
    for (const k of envKeys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      const report = runRouterBenchmark({ generatedAt: "2026-01-01T00:00:00.000Z" });
      assert.ok(report.workload.taskCount > 0);
    } finally {
      for (const k of envKeys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  it("cost math matches buildSwitchCostEstimate for a single task", () => {
    const workload = loadRouterBenchmarkWorkload();
    const task = workload.find((t) => t.id === "summarize-large-log");
    assert.ok(task);
    const result = evaluateRouterBenchmarkTask(task, "anthropic", "premium");
    const est = buildSwitchCostEstimate({
      currentModelId: result.baseline.modelId,
      recommendedModelId: result.baseline.modelId,
      provider: "anthropic",
      currentTier: "premium",
      recommendedTier: "premium",
      inputTokens: result.baseline.inputTokens,
      taskClass: "straightforward",
    });
    assert.equal(result.baseline.costUsd, est.estimated_cost_current_usd);
  });
});

describe("router benchmark quality metrics", () => {
  it("computes cost per successful task from total cost and success weight", () => {
    const costs = [1, 1, 1];
    const outcomes: TaskQualityOutcome[] = [
      { basis: "fixture_evaluated", passed: true },
      { basis: "fixture_evaluated", passed: true },
      { basis: "fixture_evaluated", passed: false },
    ];
    const q = aggregateStrategyQualityMetrics(costs, outcomes);
    assert.equal(q.successfulTasks, 2);
    assert.equal(q.failedTasks, 1);
    assert.equal(q.costPerSuccessfulTaskUsd, 1.5);
    assert.equal(q.qualityPassRate, Math.round((2 / 3) * 1000) / 1000);
  });

  it("returns N/A cost per success when zero successful tasks", () => {
    const q = aggregateStrategyQualityMetrics(
      [0.5, 0.5],
      [
        { basis: "fixture_evaluated", passed: false },
        { basis: "fixture_evaluated", passed: false },
      ],
    );
    assert.equal(q.successfulTasks, 0);
    assert.equal(q.costPerSuccessfulTaskUsd, null);
    assert.equal(q.qualityPassRate, 0);
  });

  it("treats all fixture passes as full quality pass rate", () => {
    const q = aggregateStrategyQualityMetrics(
      [0.2, 0.3],
      [
        { basis: "fixture_evaluated", passed: true },
        { basis: "fixture_evaluated", passed: true },
      ],
    );
    assert.equal(q.qualityPassRate, 1);
    assert.equal(q.costPerSuccessfulTaskUsd, 0.25);
  });

  it("marks quality_not_measured when no fixture candidate and no success-rate row", () => {
    const outcome = resolveTaskQualityOutcome(
      { id: "fp-user-opt-out", category: "router_abstain_stay" },
      "premium",
      "claude-opus-4-6",
      "anthropic",
      0.9,
      { casesById: new Map(), successRates: { version: "1", rates: {} } },
    );
    assert.equal(outcome.outcome.basis, "quality_not_measured");
    assert.equal(outcome.costPerSuccessfulTaskUsd, null);
  });

  it("router vs baseline comparison includes quality and cost-per-success deltas", () => {
    const report = runRouterBenchmark({ generatedAt: "2026-01-01T00:00:00.000Z" });
    assert.ok(report.strategies.baselinePremium.quality.tasksWithQualityData > 0);
    assert.ok(report.comparison.estimatedCostReductionPercent >= 0);
    if (
      report.strategies.baselinePremium.quality.qualityPassRate != null &&
      report.strategies.router.quality.qualityPassRate != null
    ) {
      assert.equal(
        report.comparison.qualityPassRateDifference,
        Math.round(
          (report.strategies.router.quality.qualityPassRate -
            report.strategies.baselinePremium.quality.qualityPassRate) *
            1000,
        ) / 1000,
      );
    }
  });
});
