import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSwitchCostEstimate } from "./cost.js";
import { evaluateGate } from "./gate.js";
import {
  defaultModelForTier,
  loadDefaultCatalog,
  type ModelCatalog,
} from "./catalog.js";
import {
  assumedSuccessRateForCategory,
  hasAssumedSuccessRateCategory,
  inputTokensForCost,
  loadFixtureSuite,
  loadSuccessRates,
  type BenchmarkFixture,
  type SuccessRateTable,
} from "./benchmark.js";
import { loadTaskQualityFixtures } from "./task-quality/fixtures.js";
import { evaluateTaskCandidate } from "./task-quality/runner.js";
import type { TaskCase } from "./task-quality/types.js";
import { loadDomainBenchmarkSuites } from "./task-quality/domain-benchmark-loader.js";
import type {
  CapabilityTier,
  ContextProbe,
  GateDecision,
  GateInput,
  Provider,
} from "./types.js";
import { loadAdversarialSuite } from "./adversarial.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

export type RouterBenchmarkEvidence = "fixture-based" | "synthetic" | "not-empirical" | "mixed";

export type RoutingDecisionKind = "downgrade" | "upgrade" | "stay" | "abstain";

export interface RouterWorkloadManifest {
  version: string;
  provider: Provider;
  startingTier: CapabilityTier;
  note?: string;
  include: {
    gateFixtures: boolean;
    domainCases?: { split: "train" | "holdout" | "all" };
    adversarialPremiumCases?: boolean;
  };
}

export interface RouterBenchmarkTask {
  id: string;
  category: string;
  domain?: string;
  description: string;
  userMessage: string;
  probes?: ContextProbe[];
  workloadSource: "gate_fixture" | "domain_case" | "adversarial_case";
  tags: string[];
  /** Optional gate inputs (e.g. userOptedOut) — still compared against premium baseline cost. */
  gateInput?: Pick<GateInput, "userOptedOut" | "userChosePremium" | "userChoseCheapModel">;
}

export type TaskQualityBasis =
  | "fixture_evaluated"
  | "synthetic_assumed_rate"
  | "quality_not_measured";

export interface TaskQualityOutcome {
  basis: TaskQualityBasis;
  /** Set when basis is fixture_evaluated (task-contract + criterion checks on recorded output). */
  passed?: boolean;
  /** Set when basis is synthetic_assumed_rate (benchmarks/success-rates.json). */
  assumedSuccessRate?: number;
}

export interface TaskStrategyQuality {
  outcome: TaskQualityOutcome;
  /** Heuristic turn cost / success weight; null when success weight is zero. */
  costPerSuccessfulTaskUsd: number | null;
}

export interface StrategyQualityMetrics {
  tasksWithQualityData: number;
  tasksQualityNotMeasured: number;
  successfulTasks: number;
  failedTasks: number;
  /** Router routing abstain count (no model switch), not task-quality abstain. */
  abstainedTasks: number;
  qualityPassRate: number | null;
  costPerSuccessfulTaskUsd: number | null;
}

export interface RouterBenchmarkTaskResult {
  id: string;
  category: string;
  workloadSource: RouterBenchmarkTask["workloadSource"];
  baseline: {
    modelId: string;
    tier: CapabilityTier;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    quality: TaskStrategyQuality;
  };
  router: {
    gateAction: GateDecision["action"];
    routingDecision: RoutingDecisionKind;
    executedTier: CapabilityTier;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    quality: TaskStrategyQuality;
  };
}

export interface RouterBenchmarkReport {
  generatedAt: string;
  routerVersion: string;
  provider: Provider;
  evidence: {
    costEstimates: RouterBenchmarkEvidence;
    taskQuality: RouterBenchmarkEvidence;
    label: string;
  };
  workload: {
    manifestPath: string;
    taskCount: number;
    sources: { gateFixtures: number; domainCases: number; adversarialCases: number };
  };
  strategies: {
    baselinePremium: StrategyMetrics;
    router: StrategyMetrics & {
      routingDecisions: Record<RoutingDecisionKind, number>;
    };
  };
  comparison: {
    estimatedCostReductionUsd: number;
    estimatedCostReductionPercent: number;
    qualityPassRateDifference: number | null;
    costPerSuccessfulTaskReductionUsd: number | null;
  };
  tasks: RouterBenchmarkTaskResult[];
}

export interface StrategyMetrics {
  taskCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  averageCostPerTaskUsd: number;
  medianCostPerTaskUsd: number;
  quality: StrategyQualityMetrics;
}

export function loadRouterBenchmarkManifest(
  path = join(repoRoot, "benchmarks", "router-workload.json"),
): RouterWorkloadManifest {
  return JSON.parse(readFileSync(path, "utf8")) as RouterWorkloadManifest;
}

function readRouterVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ) as { version: string };
    return pkg.version;
  } catch {
    return "unknown";
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function aggregateMetrics(
  costs: number[],
  inputTokens: number[],
  outputTokens: number[],
  qualityOutcomes: TaskQualityOutcome[],
  abstainedTasks = 0,
): StrategyMetrics {
  const totalCostUsd = roundUsd(costs.reduce((a, b) => a + b, 0));
  const totalInputTokens = inputTokens.reduce((a, b) => a + b, 0);
  const totalOutputTokens = outputTokens.reduce((a, b) => a + b, 0);
  const taskCount = costs.length;
  return {
    taskCount,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    averageCostPerTaskUsd: taskCount ? roundUsd(totalCostUsd / taskCount) : 0,
    medianCostPerTaskUsd: roundUsd(median(costs)),
    quality: aggregateStrategyQualityMetrics(costs, qualityOutcomes, abstainedTasks),
  };
}

export function aggregateStrategyQualityMetrics(
  costs: number[],
  outcomes: TaskQualityOutcome[],
  abstainedTasks = 0,
): StrategyQualityMetrics {
  let successfulTasks = 0;
  let failedTasks = 0;
  let tasksWithQualityData = 0;
  let tasksQualityNotMeasured = 0;

  for (let i = 0; i < outcomes.length; i++) {
    const o = outcomes[i]!;
    if (o.basis === "quality_not_measured") {
      tasksQualityNotMeasured++;
      continue;
    }
    tasksWithQualityData++;
    if (o.basis === "fixture_evaluated") {
      if (o.passed) successfulTasks += 1;
      else failedTasks += 1;
    } else if (o.basis === "synthetic_assumed_rate") {
      const rate = o.assumedSuccessRate ?? 0;
      successfulTasks += rate;
      failedTasks += 1 - rate;
    }
  }

  const totalCostUsd = roundUsd(costs.reduce((a, b) => a + b, 0));
  const costPerSuccessfulTaskUsd =
    successfulTasks > 0 ? roundUsd(totalCostUsd / successfulTasks) : null;
  const qualityPassRate =
    tasksWithQualityData > 0 ? successfulTasks / tasksWithQualityData : null;

  return {
    tasksWithQualityData,
    tasksQualityNotMeasured,
    successfulTasks: roundUsd(successfulTasks),
    failedTasks: roundUsd(failedTasks),
    abstainedTasks,
    qualityPassRate:
      qualityPassRate != null ? Math.round(qualityPassRate * 1000) / 1000 : null,
    costPerSuccessfulTaskUsd,
  };
}

function buildTaskCasesById(): Map<string, TaskCase> {
  const suite = loadTaskQualityFixtures();
  return new Map(suite.cases.map((c) => [c.id, c]));
}

export function resolveTaskQualityOutcome(
  task: Pick<RouterBenchmarkTask, "id" | "category">,
  tier: CapabilityTier,
  modelId: string,
  provider: Provider,
  costUsd: number,
  options?: {
    casesById?: Map<string, TaskCase>;
    successRates?: SuccessRateTable;
  },
): TaskStrategyQuality {
  const casesById = options?.casesById ?? buildTaskCasesById();
  const successRates = options?.successRates ?? loadSuccessRates();
  const taskCase = casesById.get(task.id);

  if (taskCase) {
    const candidate = taskCase.candidates.find(
      (c) =>
        c.modelId.toLowerCase() === modelId.toLowerCase() &&
        (c.provider ?? provider) === provider,
    );
    if (candidate) {
      const evaluation = evaluateTaskCandidate(taskCase, candidate);
      const outcome: TaskQualityOutcome = {
        basis: "fixture_evaluated",
        passed: evaluation.passed,
      };
      return {
        outcome,
        costPerSuccessfulTaskUsd: evaluation.passed ? roundUsd(costUsd) : null,
      };
    }
  }

  if (hasAssumedSuccessRateCategory(successRates, task.category)) {
    const rate = assumedSuccessRateForCategory(successRates, task.category, tier);
    if (rate != null) {
      return {
        outcome: {
          basis: "synthetic_assumed_rate",
          assumedSuccessRate: rate,
        },
        costPerSuccessfulTaskUsd: roundUsd(costUsd / rate),
      };
    }
  }

  return {
    outcome: { basis: "quality_not_measured" },
    costPerSuccessfulTaskUsd: null,
  };
}

function formatPassRate(rate: number | null): string {
  if (rate == null) return "N/A";
  return `${(rate * 100).toFixed(1)}%`;
}

function formatCostPerSuccess(value: number | null): string {
  if (value == null) return "N/A";
  return `$${value.toFixed(4)}`;
}

export function classifyRoutingDecision(decision: GateDecision): RoutingDecisionKind {
  if (decision.action === "suggest_switch" && decision.suggestSwitch) {
    return decision.suggestSwitch.switch_direction === "upgrade" ? "upgrade" : "downgrade";
  }
  if (decision.reason.includes("no-op")) return "abstain";
  if (decision.routing?.effectiveRecommendation?.basis === "abstain_preserve_current") {
    return "abstain";
  }
  if (decision.reason.includes("opted out")) return "abstain";
  return "stay";
}

export function premiumBaselineModelId(provider: Provider, catalog?: ModelCatalog): string {
  return defaultModelForTier(provider, "premium", catalog ?? loadDefaultCatalog());
}

export function executedTierForRouter(decision: GateDecision, startingTier: CapabilityTier): CapabilityTier {
  if (decision.action === "suggest_switch" && decision.suggestSwitch) {
    return decision.suggestSwitch.recommended_capability_tier;
  }
  return startingTier;
}

function fixtureToTask(f: BenchmarkFixture): RouterBenchmarkTask {
  return {
    id: f.id,
    category: f.category,
    description: f.description,
    userMessage: f.userMessage,
    probes: f.probes,
    workloadSource: "gate_fixture",
    tags: [f.category, "gate_regression"],
  };
}

export function loadRouterBenchmarkWorkload(
  manifest = loadRouterBenchmarkManifest(),
): RouterBenchmarkTask[] {
  const tasks: RouterBenchmarkTask[] = [];
  const seen = new Set<string>();

  if (manifest.include.gateFixtures) {
    const suite = loadFixtureSuite();
    for (const f of suite.fixtures) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      tasks.push(fixtureToTask(f));
    }
  }

  const split = manifest.include.domainCases?.split ?? "train";
  if (manifest.include.domainCases) {
    const { cases } = loadDomainBenchmarkSuites();
    for (const c of cases) {
      if (split !== "all" && c.benchmarkSplit !== split) continue;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      tasks.push({
        id: c.id,
        category: c.category,
        domain: c.domain,
        description: `${c.domain}: ${c.taskType ?? c.domain}`,
        userMessage: c.userMessage,
        probes: c.probes ?? c.context?.probes,
        workloadSource: "domain_case",
        tags: [c.category, ...(c.domain ? [c.domain] : []), "task_quality_fixture"],
      });
    }
  }

  if (manifest.include.adversarialPremiumCases) {
    const adv = loadAdversarialSuite();
    for (const c of adv.cases) {
      if (c.kind !== "false_positive") continue;
      if (!c.currentModel.toLowerCase().includes("opus")) continue;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const gateInput: RouterBenchmarkTask["gateInput"] = {};
      if (c.userOptedOut) gateInput.userOptedOut = true;
      tasks.push({
        id: c.id,
        category: c.kind === "false_positive" ? "router_abstain_stay" : "router_switch_trap",
        description: c.description,
        userMessage: c.userMessage,
        probes: c.probes,
        workloadSource: "adversarial_case",
        tags: [c.kind, "adversarial_regression"],
        gateInput: Object.keys(gateInput).length ? gateInput : undefined,
      });
    }
  }

  tasks.sort((a, b) => a.id.localeCompare(b.id));
  return tasks;
}

function costBreakdown(
  modelId: string,
  provider: Provider,
  tier: CapabilityTier,
  inputTokens: number,
  taskClass: GateDecision["taskClass"],
): { outputTokens: number; costUsd: number } {
  const est = buildSwitchCostEstimate({
    currentModelId: modelId,
    recommendedModelId: modelId,
    provider,
    currentTier: tier,
    recommendedTier: tier,
    inputTokens,
    taskClass,
  });
  return {
    outputTokens: est.estimated_output_tokens,
    costUsd: est.estimated_cost_current_usd,
  };
}

export function evaluateRouterBenchmarkTask(
  task: RouterBenchmarkTask,
  provider: Provider,
  startingTier: CapabilityTier = "premium",
  catalog?: ModelCatalog,
  context?: {
    casesById?: Map<string, TaskCase>;
    successRates?: SuccessRateTable;
  },
): RouterBenchmarkTaskResult {
  const cat = catalog ?? loadDefaultCatalog();
  const premiumModelId = defaultModelForTier(provider, "premium", cat);

  const decision = evaluateGate({
    currentModel: defaultModelForTier(provider, startingTier, cat),
    provider,
    userMessage: task.userMessage,
    probes: task.probes,
    ...task.gateInput,
  });

  const inputTokens = inputTokensForCost(decision);
  const baselineCost = costBreakdown(
    premiumModelId,
    provider,
    "premium",
    inputTokens,
    decision.taskClass,
  );

  const executedTier = executedTierForRouter(decision, startingTier);
  const routerModelId = defaultModelForTier(provider, executedTier, cat);
  const routerCost = costBreakdown(
    routerModelId,
    provider,
    executedTier,
    inputTokens,
    decision.taskClass,
  );

  const qualityOpts = {
    casesById: context?.casesById,
    successRates: context?.successRates,
  };

  return {
    id: task.id,
    category: task.category,
    workloadSource: task.workloadSource,
    baseline: {
      modelId: premiumModelId,
      tier: "premium",
      inputTokens,
      outputTokens: baselineCost.outputTokens,
      costUsd: baselineCost.costUsd,
      quality: resolveTaskQualityOutcome(
        task,
        "premium",
        premiumModelId,
        provider,
        baselineCost.costUsd,
        qualityOpts,
      ),
    },
    router: {
      gateAction: decision.action,
      routingDecision: classifyRoutingDecision(decision),
      executedTier,
      modelId: routerModelId,
      inputTokens,
      outputTokens: routerCost.outputTokens,
      costUsd: routerCost.costUsd,
      quality: resolveTaskQualityOutcome(
        task,
        executedTier,
        routerModelId,
        provider,
        routerCost.costUsd,
        qualityOpts,
      ),
    },
  };
}

export interface RunRouterBenchmarkOptions {
  manifestPath?: string;
  generatedAt?: string;
}

export function runRouterBenchmark(options?: RunRouterBenchmarkOptions): RouterBenchmarkReport {
  const manifestPath = options?.manifestPath ?? join(repoRoot, "benchmarks", "router-workload.json");
  const manifest = loadRouterBenchmarkManifest(manifestPath);
  const provider = manifest.provider;
  const startingTier = manifest.startingTier;
  const tasks = loadRouterBenchmarkWorkload(manifest);
  const catalog = loadDefaultCatalog();
  const casesById = buildTaskCasesById();
  const successRates = loadSuccessRates();
  const evalContext = { casesById, successRates };

  const results = tasks.map((t) =>
    evaluateRouterBenchmarkTask(t, provider, startingTier, catalog, evalContext),
  );

  const baselineCosts = results.map((r) => r.baseline.costUsd);
  const baselineInputs = results.map((r) => r.baseline.inputTokens);
  const baselineOutputs = results.map((r) => r.baseline.outputTokens);
  const baselineQuality = results.map((r) => r.baseline.quality.outcome);

  const routerCosts = results.map((r) => r.router.costUsd);
  const routerInputs = results.map((r) => r.router.inputTokens);
  const routerOutputs = results.map((r) => r.router.outputTokens);
  const routerQuality = results.map((r) => r.router.quality.outcome);

  const routingDecisions: Record<RoutingDecisionKind, number> = {
    downgrade: 0,
    upgrade: 0,
    stay: 0,
    abstain: 0,
  };
  for (const r of results) {
    routingDecisions[r.router.routingDecision]++;
  }

  const baselinePremium = aggregateMetrics(
    baselineCosts,
    baselineInputs,
    baselineOutputs,
    baselineQuality,
  );
  const routerMetrics = aggregateMetrics(
    routerCosts,
    routerInputs,
    routerOutputs,
    routerQuality,
    routingDecisions.abstain,
  );

  const estimatedCostReductionUsd = roundUsd(
    baselinePremium.totalCostUsd - routerMetrics.totalCostUsd,
  );
  const estimatedCostReductionPercent =
    baselinePremium.totalCostUsd > 0
      ? Math.round((estimatedCostReductionUsd / baselinePremium.totalCostUsd) * 1000) / 10
      : 0;

  const qualityPassRateDifference =
    baselinePremium.quality.qualityPassRate != null &&
    routerMetrics.quality.qualityPassRate != null
      ? Math.round(
          (routerMetrics.quality.qualityPassRate - baselinePremium.quality.qualityPassRate) *
            1000,
        ) / 1000
      : null;

  const costPerSuccessfulTaskReductionUsd =
    baselinePremium.quality.costPerSuccessfulTaskUsd != null &&
    routerMetrics.quality.costPerSuccessfulTaskUsd != null
      ? roundUsd(
          baselinePremium.quality.costPerSuccessfulTaskUsd -
            routerMetrics.quality.costPerSuccessfulTaskUsd,
        )
      : null;

  const gateFixtures = tasks.filter((t) => t.workloadSource === "gate_fixture").length;
  const domainCases = tasks.filter((t) => t.workloadSource === "domain_case").length;
  const adversarialCases = tasks.filter((t) => t.workloadSource === "adversarial_case").length;

  return {
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    routerVersion: readRouterVersion(),
    provider,
    evidence: {
      costEstimates: "fixture-based",
      taskQuality: "mixed",
      label:
        "Costs: fixture-based heuristics (catalogs/pricing.json). Quality: task-quality fixture evaluation where a recorded candidate exists for the executed model; otherwise tier×category rates from benchmarks/success-rates.json (synthetic); otherwise quality_not_measured. Not live API quality.",
    },
    workload: {
      manifestPath,
      taskCount: tasks.length,
      sources: { gateFixtures, domainCases, adversarialCases },
    },
    strategies: {
      baselinePremium,
      router: {
        ...routerMetrics,
        routingDecisions,
      },
    },
    comparison: {
      estimatedCostReductionUsd,
      estimatedCostReductionPercent,
      qualityPassRateDifference,
      costPerSuccessfulTaskReductionUsd,
    },
    tasks: results,
  };
}

export function formatRouterBenchmarkMarkdown(report: RouterBenchmarkReport): string {
  const b = report.strategies.baselinePremium;
  const r = report.strategies.router;
  const d = r.routingDecisions;
  const bq = b.quality;
  const rq = r.quality;

  return [
    "# Router benchmark (premium baseline vs cost gate)",
    "",
    `Generated: ${report.generatedAt}`,
    `Provider: ${report.provider} | Router package: ${report.routerVersion}`,
    "",
    "## Evidence",
    "",
    `**${report.evidence.label}**`,
    "",
    `- Cost estimates: **${report.evidence.costEstimates}** (see \`catalogs/pricing.json\`)`,
    `- Task quality: **${report.evidence.taskQuality}** — fixture criteria + synthetic success rates; not live API runs`,
    "",
    "## Workload",
    "",
    `Tasks: ${report.workload.taskCount} (${report.workload.sources.gateFixtures} gate fixtures + ${report.workload.sources.domainCases} domain train cases + ${report.workload.sources.adversarialCases} adversarial premium cases)`,
    `Manifest: \`${report.workload.manifestPath}\``,
    `Router starting tier: **premium** (production gate path)`,
    "",
    "## Cost & quality comparison",
    "",
    "```text",
    "cost_per_successful_task_usd = total_estimated_cost / successful_tasks",
    "successful_tasks = fixture passes + sum(synthetic assumed success rates)",
    "```",
    "",
    "| | Premium baseline | Router |",
    "|--|------------------|--------|",
    `| Tasks | ${b.taskCount} | ${r.taskCount} |`,
    `| Successful (est.) | ${bq.successfulTasks} | ${rq.successfulTasks} |`,
    `| Failed (est.) | ${bq.failedTasks} | ${rq.failedTasks} |`,
    `| Quality not measured | ${bq.tasksQualityNotMeasured} | ${rq.tasksQualityNotMeasured} |`,
    `| Routing abstain | — | ${rq.abstainedTasks} |`,
    `| Estimated cost (USD) | $${b.totalCostUsd.toFixed(4)} | $${r.totalCostUsd.toFixed(4)} |`,
    `| Cost / task | $${b.averageCostPerTaskUsd.toFixed(4)} | $${r.averageCostPerTaskUsd.toFixed(4)} |`,
    `| Cost / success | ${formatCostPerSuccess(bq.costPerSuccessfulTaskUsd)} | ${formatCostPerSuccess(rq.costPerSuccessfulTaskUsd)} |`,
    `| Quality pass rate | ${formatPassRate(bq.qualityPassRate)} | ${formatPassRate(rq.qualityPassRate)} |`,
    "",
    "## Strategy A — Always premium (detail)",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Tasks | ${b.taskCount} |`,
    `| Total input tokens (est.) | ${b.totalInputTokens.toLocaleString()} |`,
    `| Total output tokens (est.) | ${b.totalOutputTokens.toLocaleString()} |`,
    `| Total cost (est. USD) | $${b.totalCostUsd.toFixed(4)} |`,
    `| Avg cost / task | $${b.averageCostPerTaskUsd.toFixed(4)} |`,
    `| Median cost / task | $${b.medianCostPerTaskUsd.toFixed(4)} |`,
    "",
    "## Strategy B — Cost gate router (detail)",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Tasks | ${r.taskCount} |`,
    `| Total input tokens (est.) | ${r.totalInputTokens.toLocaleString()} |`,
    `| Total output tokens (est.) | ${r.totalOutputTokens.toLocaleString()} |`,
    `| Total cost (est. USD) | $${r.totalCostUsd.toFixed(4)} |`,
    `| Avg cost / task | $${r.averageCostPerTaskUsd.toFixed(4)} |`,
    `| Median cost / task | $${r.medianCostPerTaskUsd.toFixed(4)} |`,
    "",
    "### Routing decisions (premium start)",
    "",
    "| Decision | Count |",
    "|----------|-------|",
    `| Downgrade | ${d.downgrade} |`,
    `| Upgrade | ${d.upgrade} |`,
    `| Stay (premium) | ${d.stay} |`,
    `| Abstain (no switch) | ${d.abstain} |`,
    "",
    "## Comparison",
    "",
    "```text",
    "estimated_cost_reduction_percent = (baseline_total - router_total) / baseline_total * 100",
    "```",
    "",
    `| Estimated savings (USD) | $${report.comparison.estimatedCostReductionUsd.toFixed(4)} |`,
    `| Estimated cost reduction | ${report.comparison.estimatedCostReductionPercent}% |`,
    `| Quality pass rate Δ (router − baseline) | ${report.comparison.qualityPassRateDifference != null ? `${(report.comparison.qualityPassRateDifference * 100).toFixed(1)} pp` : "N/A"} |`,
    `| Cost / success Δ (baseline − router) | ${report.comparison.costPerSuccessfulTaskReductionUsd != null ? `$${report.comparison.costPerSuccessfulTaskReductionUsd.toFixed(4)}` : "N/A"} |`,
    "",
    "## Per-task summary",
    "",
    "| Task | Category | Router | Tier | Baseline $ | Router $ | Baseline quality | Router quality |",
    "|------|----------|--------|------|------------|----------|------------------|----------------|",
    ...report.tasks.map((t) => {
      const bQual =
        t.baseline.quality.outcome.basis === "quality_not_measured"
          ? "quality_not_measured"
          : t.baseline.quality.outcome.basis === "fixture_evaluated"
            ? t.baseline.quality.outcome.passed
              ? "pass"
              : "fail"
            : `synthetic ${((t.baseline.quality.outcome.assumedSuccessRate ?? 0) * 100).toFixed(0)}%`;
      const rQual =
        t.router.quality.outcome.basis === "quality_not_measured"
          ? "quality_not_measured"
          : t.router.quality.outcome.basis === "fixture_evaluated"
            ? t.router.quality.outcome.passed
              ? "pass"
              : "fail"
            : `synthetic ${((t.router.quality.outcome.assumedSuccessRate ?? 0) * 100).toFixed(0)}%`;
      return `| ${t.id} | ${t.category} | ${t.router.routingDecision} | ${t.router.executedTier} | ${t.baseline.costUsd.toFixed(4)} | ${t.router.costUsd.toFixed(4)} | ${bQual} | ${rQual} |`;
    }),
    "",
  ].join("\n");
}
