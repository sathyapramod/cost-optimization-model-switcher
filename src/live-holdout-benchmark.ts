/**
 * Empirical baseline-vs-router comparison on HOLDOUT tasks, using already-recorded
 * live API runs (`benchmarks/results/live-runs.json`, produced by `npm run evaluate:live`).
 *
 * This module never calls a provider API itself — it only reads recorded live runs —
 * so it requires no API keys and does not affect `npm run gate` / routing evidence.
 *
 * Holdout live runs are never evidence-eligible (see `task-quality/live-runs.ts`
 * `evidenceEligible`), so this comparison cannot leak into routing calibration.
 */
import { evaluateGate } from "./gate.js";
import {
  defaultModelForTier,
  loadDefaultCatalog,
  type ModelCatalog,
} from "./catalog.js";
import {
  estimateTurnCostUsd,
  loadDefaultPricing,
  resolveTokenRates,
  type PricingCatalog,
} from "./cost.js";
import {
  classifyRoutingDecision,
  executedTierForRouter,
  type RoutingDecisionKind,
} from "./router-benchmark.js";
import { loadTaskQualityFixtures } from "./task-quality/fixtures.js";
import {
  DEFAULT_LIVE_RUNS_PATH,
  loadLiveRuns,
  type LiveBenchmarkRun,
} from "./task-quality/live-runs.js";
import type { CapabilityTier, Provider } from "./types.js";

// ponytail: 5 paired holdout live runs is a deliberate, documented minimum before we'll
// report a quality delta instead of "insufficient evidence". Not a statistical test —
// upgrade path is a proper confidence interval / significance test once volume justifies it.
export const MIN_PAIRED_HOLDOUT_SAMPLES = 5;

export interface LiveRunSummary {
  passed: boolean;
  qualityScore: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Pricing-catalog rate × recorded live token usage — not a billing invoice. */
  estimatedCostUsd: number;
  completedAt: string;
}

export interface LiveHoldoutTaskComparison {
  taskId: string;
  domain?: string;
  routingDecision: RoutingDecisionKind;
  executedTier: CapabilityTier;
  baseline: { modelId: string; run: LiveRunSummary | null };
  router: { modelId: string; run: LiveRunSummary | null };
  /** Router decided to stay on the premium model — baseline and router are the same model. */
  sameModel: boolean;
  /** Both sides have a recorded live run AND the models differ (a genuine A/B data point). */
  pairedDifferentModel: boolean;
}

export interface LiveHoldoutStrategyMetrics {
  tasksWithLiveData: number;
  successfulTasks: number;
  failedTasks: number;
  totalCostUsd: number;
  costPerSuccessfulTaskUsd: number | null;
  qualityPassRate: number | null;
}

export interface LiveHoldoutPairedComparison {
  sampleSize: number;
  minRequiredSampleSize: number;
  insufficientEvidence: boolean;
  baselinePassRate: number | null;
  routerPassRate: number | null;
  /** router − baseline over the paired, different-model sample only. Null when sampleSize is 0. */
  qualityPassRateDelta: number | null;
  note: string;
}

export interface LiveHoldoutComparisonReport {
  generatedAt: string;
  provider: Provider;
  liveRunsPath: string;
  evidence: { label: string };
  workload: { holdoutTaskCount: number };
  routingDecisions: Record<RoutingDecisionKind, number>;
  liveCoverage: {
    baselineRunsAvailable: number;
    routerRunsAvailable: number;
    pairedDifferentModelRuns: number;
    pairedSameModelRuns: number;
  };
  baseline: LiveHoldoutStrategyMetrics;
  router: LiveHoldoutStrategyMetrics;
  pairedComparison: LiveHoldoutPairedComparison;
  tasks: LiveHoldoutTaskComparison[];
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function roundRate(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function findLiveRun(
  runs: LiveBenchmarkRun[],
  taskId: string,
  provider: Provider,
  modelId: string,
): LiveBenchmarkRun | undefined {
  return runs.find(
    (r) =>
      r.taskId === taskId &&
      r.benchmarkSplit === "holdout" &&
      r.provider === provider &&
      r.modelId.toLowerCase() === modelId.toLowerCase(),
  );
}

function summarizeLiveRun(
  run: LiveBenchmarkRun,
  provider: Provider,
  tier: CapabilityTier,
  pricing: PricingCatalog,
): LiveRunSummary {
  const rates = resolveTokenRates(run.modelId, provider, tier, pricing);
  const costUsd = estimateTurnCostUsd(run.inputTokens, run.outputTokens, rates.rates);
  return {
    passed: run.evaluation.passed,
    qualityScore: run.evaluation.qualityScore,
    latencyMs: run.latencyMs,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    estimatedCostUsd: costUsd,
    completedAt: run.completedAt,
  };
}

function aggregateStrategy(runs: (LiveRunSummary | null)[]): LiveHoldoutStrategyMetrics {
  const present = runs.filter((r): r is LiveRunSummary => r != null);
  const successfulTasks = present.filter((r) => r.passed).length;
  const failedTasks = present.length - successfulTasks;
  const totalCostUsd = roundUsd(present.reduce((a, r) => a + r.estimatedCostUsd, 0));
  return {
    tasksWithLiveData: present.length,
    successfulTasks,
    failedTasks,
    totalCostUsd,
    costPerSuccessfulTaskUsd:
      successfulTasks > 0 ? roundUsd(totalCostUsd / successfulTasks) : null,
    qualityPassRate: present.length > 0 ? roundRate(successfulTasks / present.length) : null,
  };
}

export interface CompareLiveHoldoutOptions {
  provider?: Provider;
  liveRunsPath?: string;
  fixturesPath?: string;
  catalog?: ModelCatalog;
  pricing?: PricingCatalog;
  minPairedSamples?: number;
  generatedAt?: string;
}

export function compareLiveHoldoutBaselineVsRouter(
  options?: CompareLiveHoldoutOptions,
): LiveHoldoutComparisonReport {
  const provider = options?.provider ?? "anthropic";
  const liveRunsPath = options?.liveRunsPath ?? DEFAULT_LIVE_RUNS_PATH;
  const catalog = options?.catalog ?? loadDefaultCatalog();
  const pricing = options?.pricing ?? loadDefaultPricing();
  const minPairedSamples = options?.minPairedSamples ?? MIN_PAIRED_HOLDOUT_SAMPLES;

  const suite = loadTaskQualityFixtures(options?.fixturesPath);
  const holdoutCases = suite.cases.filter((c) => c.benchmarkSplit === "holdout");
  const liveRuns = loadLiveRuns(liveRunsPath).runs;
  const premiumModelId = defaultModelForTier(provider, "premium", catalog);

  const routingDecisions: Record<RoutingDecisionKind, number> = {
    downgrade: 0,
    upgrade: 0,
    stay: 0,
    abstain: 0,
  };

  const tasks: LiveHoldoutTaskComparison[] = holdoutCases.map((taskCase) => {
    const decision = evaluateGate({
      currentModel: premiumModelId,
      provider,
      userMessage: taskCase.userMessage,
      probes: taskCase.probes ?? taskCase.context?.probes,
    });
    const routingDecision = classifyRoutingDecision(decision);
    routingDecisions[routingDecision]++;
    const executedTier = executedTierForRouter(decision, "premium");
    const routerModelId = defaultModelForTier(provider, executedTier, catalog);
    const sameModel = routerModelId.toLowerCase() === premiumModelId.toLowerCase();

    const baselineRunRaw = findLiveRun(liveRuns, taskCase.id, provider, premiumModelId);
    const routerRunRaw = sameModel
      ? baselineRunRaw
      : findLiveRun(liveRuns, taskCase.id, provider, routerModelId);

    const baselineRun = baselineRunRaw
      ? summarizeLiveRun(baselineRunRaw, provider, "premium", pricing)
      : null;
    const routerRun = routerRunRaw
      ? summarizeLiveRun(routerRunRaw, provider, executedTier, pricing)
      : null;

    return {
      taskId: taskCase.id,
      domain: taskCase.domain,
      routingDecision,
      executedTier,
      baseline: { modelId: premiumModelId, run: baselineRun },
      router: { modelId: routerModelId, run: routerRun },
      sameModel,
      pairedDifferentModel: !sameModel && baselineRun != null && routerRun != null,
    };
  });

  const baseline = aggregateStrategy(tasks.map((t) => t.baseline.run));
  const router = aggregateStrategy(tasks.map((t) => t.router.run));

  const pairedTasks = tasks.filter((t) => t.pairedDifferentModel);
  const pairedBaselinePass = pairedTasks.filter((t) => t.baseline.run!.passed).length;
  const pairedRouterPass = pairedTasks.filter((t) => t.router.run!.passed).length;
  const sampleSize = pairedTasks.length;
  const insufficientEvidence = sampleSize < minPairedSamples;
  const baselinePassRate = sampleSize > 0 ? roundRate(pairedBaselinePass / sampleSize) : null;
  const routerPassRate = sampleSize > 0 ? roundRate(pairedRouterPass / sampleSize) : null;
  const qualityPassRateDelta =
    baselinePassRate != null && routerPassRate != null
      ? roundRate(routerPassRate - baselinePassRate)
      : null;

  const note = insufficientEvidence
    ? `insufficient evidence: ${sampleSize} paired holdout live run(s) with different baseline/router models (need >= ${minPairedSamples}). Run \`npm run evaluate:live -- --split holdout\` for both the premium model and router-selected models to grow this sample. Do not treat the router as quality-preserving on this basis.`
    : `${sampleSize} paired holdout live run(s). Reporting observed pass-rate delta as-is — not a claim that the router preserves quality beyond this sample.`;

  const sameModelPairs = tasks.filter(
    (t) => t.sameModel && t.baseline.run != null,
  ).length;

  return {
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    provider,
    liveRunsPath,
    evidence: {
      label:
        "Empirical where a recorded live run exists for the exact (task, model) pair; otherwise no claim is made. Holdout runs are never merged into routing evidence (see docs/ROUTING_ASSURANCE.md).",
    },
    workload: { holdoutTaskCount: holdoutCases.length },
    routingDecisions,
    liveCoverage: {
      baselineRunsAvailable: baseline.tasksWithLiveData,
      routerRunsAvailable: router.tasksWithLiveData,
      pairedDifferentModelRuns: sampleSize,
      pairedSameModelRuns: sameModelPairs,
    },
    baseline,
    router,
    pairedComparison: {
      sampleSize,
      minRequiredSampleSize: minPairedSamples,
      insufficientEvidence,
      baselinePassRate,
      routerPassRate,
      qualityPassRateDelta,
      note,
    },
    tasks,
  };
}

function fmtRate(v: number | null): string {
  return v == null ? "N/A" : `${(v * 100).toFixed(1)}%`;
}

function fmtCost(v: number | null): string {
  return v == null ? "N/A" : `$${v.toFixed(4)}`;
}

export function formatLiveHoldoutComparisonMarkdown(
  report: LiveHoldoutComparisonReport,
): string {
  const d = report.routingDecisions;
  const p = report.pairedComparison;

  return [
    "# Live holdout: premium baseline vs router (empirical)",
    "",
    `Generated: ${report.generatedAt}`,
    `Provider: ${report.provider}`,
    `Live runs source: \`${report.liveRunsPath}\` (gitignored; produced by \`npm run evaluate:live\`)`,
    "",
    `> ${report.evidence.label}`,
    "",
    `Holdout tasks: ${report.workload.holdoutTaskCount}`,
    "",
    "## Routing decisions on holdout (gate behavior, independent of live data availability)",
    "",
    "| Decision | Count |",
    "|----------|-------|",
    `| Downgrade | ${d.downgrade} |`,
    `| Upgrade | ${d.upgrade} |`,
    `| Stay (premium) | ${d.stay} |`,
    `| Abstain | ${d.abstain} |`,
    "",
    "## Live data coverage",
    "",
    `- Baseline (premium) live runs available: ${report.liveCoverage.baselineRunsAvailable}`,
    `- Router-selected-model live runs available: ${report.liveCoverage.routerRunsAvailable}`,
    `- Paired, different-model runs (real A/B data points): ${report.liveCoverage.pairedDifferentModelRuns}`,
    `- Paired, same-model runs (router stayed on premium): ${report.liveCoverage.pairedSameModelRuns}`,
    "",
    "## Strategy metrics (over tasks with recorded live data; not full holdout set)",
    "",
    "| | Baseline (premium) | Router |",
    "|--|---------------------|--------|",
    `| Tasks with live data | ${report.baseline.tasksWithLiveData} | ${report.router.tasksWithLiveData} |`,
    `| Successful | ${report.baseline.successfulTasks} | ${report.router.successfulTasks} |`,
    `| Failed | ${report.baseline.failedTasks} | ${report.router.failedTasks} |`,
    `| Estimated cost (USD) | $${report.baseline.totalCostUsd.toFixed(4)} | $${report.router.totalCostUsd.toFixed(4)} |`,
    `| Cost / success | ${fmtCost(report.baseline.costPerSuccessfulTaskUsd)} | ${fmtCost(report.router.costPerSuccessfulTaskUsd)} |`,
    `| Quality pass rate | ${fmtRate(report.baseline.qualityPassRate)} | ${fmtRate(report.router.qualityPassRate)} |`,
    "",
    "## Paired comparison (same holdout task, baseline model vs router-selected model, both empirically run)",
    "",
    `Sample size: ${p.sampleSize} (minimum required before drawing a conclusion: ${p.minRequiredSampleSize})`,
    `Status: **${p.insufficientEvidence ? "INSUFFICIENT EVIDENCE" : "sample meets minimum size"}**`,
    "",
    `> ${p.note}`,
    "",
    `| Baseline pass rate | ${fmtRate(p.baselinePassRate)} |`,
    `| Router pass rate | ${fmtRate(p.routerPassRate)} |`,
    `| Quality delta (router − baseline) | ${p.qualityPassRateDelta == null ? "N/A" : `${(p.qualityPassRateDelta * 100).toFixed(1)} pp`} |`,
    "",
    "## Per-task detail",
    "",
    "| Task | Routing | Baseline model | Baseline pass | Router model | Router pass | Paired A/B |",
    "|------|---------|-----------------|----------------|---------------|--------------|------------|",
    ...report.tasks.map((t) => {
      const bPass = t.baseline.run == null ? "no live data" : t.baseline.run.passed ? "pass" : "fail";
      const rPass = t.router.run == null ? "no live data" : t.router.run.passed ? "pass" : "fail";
      return `| ${t.taskId} | ${t.routingDecision} | ${t.baseline.modelId} | ${bPass} | ${t.router.modelId} | ${rPass} | ${t.pairedDifferentModel ? "yes" : "no"} |`;
    }),
    "",
  ].join("\n");
}
