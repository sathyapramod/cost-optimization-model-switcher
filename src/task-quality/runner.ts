import { resolveModel } from "../catalog.js";
import { buildSwitchCostEstimate } from "../cost.js";
import { analyzeTask } from "../task-analyzer.js";
import { buildTaskSuccessSpecification } from "../success-criteria.js";
import { resolveSuccessSpecId } from "../task-contract.js";
import type {
  BenchmarkDomain,
  EvaluableCriterion,
  EvaluationResult,
  ModelDomainBenchmarkStats,
  TaskCase,
  TaskQualityReport,
} from "./types.js";
import { loadTaskQualityFixtures } from "./fixtures.js";
import {
  TASK_CONTRACT_EVALUATOR_ID,
  aggregateQualityScore,
  evaluateOutputAgainstCriteria,
} from "./evaluators.js";
import type { SuccessCriterion } from "../success-criteria.js";

export const TASK_QUALITY_FRAMEWORK_VERSION = "1.0.0";

const EVIDENCE_NOTE =
  "Task-quality scores come from fixture outputs and criterion checks — not from benchmarks/success-rates.json assumed rates.";

function toEvaluable(c: SuccessCriterion): EvaluableCriterion {
  return { ...c, spec: c.spec as EvaluableCriterion["spec"] };
}

export function mergeCriteriaForCase(
  contractCriteria: SuccessCriterion[],
  fixtureCriteria?: EvaluableCriterion[],
  mode: TaskCase["criteriaSource"] = "merged",
): EvaluableCriterion[] {
  if (mode === "fixture_only") {
    return (fixtureCriteria ?? []).map((c) => ({ ...c }));
  }
  if (mode === "contract_only") {
    return contractCriteria.map((c) => toEvaluable(c));
  }
  const byId = new Map<string, EvaluableCriterion>();
  for (const c of contractCriteria) {
    byId.set(c.id, toEvaluable(c));
  }
  for (const c of fixtureCriteria ?? []) {
    byId.set(c.id, { ...(byId.get(c.id) ?? {}), ...c } as EvaluableCriterion);
  }
  return [...byId.values()].filter((c) => hasEvaluableSpec(c, mode));
}

function hasEvaluableSpec(c: EvaluableCriterion, mode: TaskCase["criteriaSource"]): boolean {
  if (mode !== "merged") return true;
  if (c.type === "llm_judge" || c.type === "human") return true;
  if (c.type === "deterministic" && !c.spec?.check) return false;
  if (c.type === "structured" || c.type === "rubric" || c.type === "deterministic") {
    return c.spec != null && Object.keys(c.spec).length > 0;
  }
  return true;
}

export function evaluateTaskCandidate(
  taskCase: TaskCase,
  candidate: TaskCase["candidates"][0],
): EvaluationResult {
  const analysis = analyzeTask({
    userMessage: taskCase.userMessage,
    probes: taskCase.probes,
  });
  const specId = resolveSuccessSpecId(analysis, taskCase.userMessage);
  const spec = buildTaskSuccessSpecification(specId, analysis);
  const criteria = mergeCriteriaForCase(
    spec.criteria,
    taskCase.evaluationCriteria,
    taskCase.criteriaSource ?? "merged",
  );

  const criterionResults = evaluateOutputAgainstCriteria({
    output: candidate.output,
    criteria,
  });
  const { qualityScore, passed, errors } = aggregateQualityScore(criterionResults, criteria);

  const resolved = resolveModel(candidate.modelId, undefined, candidate.provider);
  const cost = buildSwitchCostEstimate({
    currentModelId: candidate.modelId,
    recommendedModelId: candidate.modelId,
    provider: candidate.provider,
    currentTier: resolved.tier,
    recommendedTier: resolved.tier,
    inputTokens: candidate.inputTokens,
    taskClass: analysis.taskClass,
  });

  return {
    taskId: taskCase.id,
    model: candidate.modelId,
    provider: candidate.provider,
    evaluator: TASK_CONTRACT_EVALUATOR_ID,
    qualityScore,
    passed,
    criterionResults,
    latencyMs: candidate.latencyMs,
    inputTokens: candidate.inputTokens,
    outputTokens: candidate.outputTokens,
    estimatedCostUsd: cost.estimated_cost_current_usd,
    errors,
    specId: spec.specId,
  };
}

export function evaluateTaskCase(taskCase: TaskCase): EvaluationResult[] {
  return taskCase.candidates.map((c) => evaluateTaskCandidate(taskCase, c));
}

export interface RunTaskQualityOptions {
  fixturesPath?: string;
  /** When set, only cases with this benchmark split are evaluated. */
  benchmarkSplit?: import("./types.js").BenchmarkSplit;
}

function aggregateByModelDomain(
  cases: { domain?: BenchmarkDomain; results: EvaluationResult[] }[],
): ModelDomainBenchmarkStats[] {
  const buckets = new Map<
    string,
    {
      modelId: string;
      provider: EvaluationResult["provider"];
      domain: BenchmarkDomain;
      qualities: number[];
      costs: number[];
      latencies: number[];
      passCount: number;
      caseCount: number;
    }
  >();

  for (const c of cases) {
    if (!c.domain) continue;
    const domain = c.domain;
    for (const r of c.results) {
      const key = `${domain}:${r.provider}:${r.model}`;
      const bucket =
        buckets.get(key) ??
        {
          modelId: r.model,
          provider: r.provider,
          domain,
          qualities: [],
          costs: [],
          latencies: [],
          passCount: 0,
          caseCount: 0,
        };
      bucket.qualities.push(r.qualityScore);
      bucket.costs.push(r.estimatedCostUsd);
      bucket.latencies.push(r.latencyMs);
      bucket.caseCount++;
      if (r.passed) bucket.passCount++;
      buckets.set(key, bucket);
    }
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  return [...buckets.values()].map((b) => ({
    modelId: b.modelId,
    provider: b.provider,
    domain: b.domain,
    caseCount: b.caseCount,
    passCount: b.passCount,
    failureRate: b.caseCount ? 1 - b.passCount / b.caseCount : 0,
    meanQuality: Math.round(mean(b.qualities) * 1000) / 1000,
    meanCostUsd: Math.round(mean(b.costs) * 1_000_000) / 1_000_000,
    meanLatencyMs: Math.round(mean(b.latencies)),
  }));
}

export function runHeldOutBenchmarkEvaluation(
  options?: Omit<RunTaskQualityOptions, "benchmarkSplit">,
): TaskQualityReport {
  const report = runTaskQualityEvaluation({ ...options, benchmarkSplit: "holdout" });
  return {
    ...report,
    note: `Held-out benchmark (excluded from routing evidence index). ${report.note}`,
  };
}

export function runTaskQualityEvaluation(
  options?: RunTaskQualityOptions,
): TaskQualityReport {
  const suite = loadTaskQualityFixtures(options?.fixturesPath);
  const filtered = options?.benchmarkSplit
    ? suite.cases.filter((c) => (c.benchmarkSplit ?? "train") === options.benchmarkSplit)
    : suite.cases;
  const cases = filtered.map((taskCase) => ({
    caseId: taskCase.id,
    category: taskCase.category,
    domain: taskCase.domain,
    benchmarkSplit: taskCase.benchmarkSplit ?? "train",
    results: evaluateTaskCase(taskCase),
  }));

  let passed = 0;
  let failed = 0;
  let resultCount = 0;
  for (const c of cases) {
    for (const r of c.results) {
      resultCount++;
      if (r.passed) passed++;
      else failed++;
    }
  }

  const byModelDomain = aggregateByModelDomain(cases);

  return {
    generatedAt: new Date().toISOString(),
    frameworkVersion: TASK_QUALITY_FRAMEWORK_VERSION,
    note: suite.note ? `${suite.note} ${EVIDENCE_NOTE}` : EVIDENCE_NOTE,
    cases,
    summary: {
      caseCount: cases.length,
      resultCount,
      passed,
      failed,
      byModelDomain,
    },
  };
}

export function formatTaskQualityMarkdown(report: TaskQualityReport): string {
  const lines: string[] = [
    "# Task quality evaluation report",
    "",
    `Generated: ${report.generatedAt}`,
    `Framework: ${report.frameworkVersion}`,
    "",
    `> ${report.note}`,
    "",
    `Cases: ${report.summary.caseCount} | Results: ${report.summary.resultCount} | Passed: ${report.summary.passed} | Failed: ${report.summary.failed}`,
    "",
    "## Model comparison by task domain",
    "",
    "Purpose: for each task class, what quality can each model reliably achieve on recorded outputs (not universal ranking).",
    "",
    "| Domain | Model | Cases | Pass | Failure rate | Mean quality | Mean latency ms | Mean est. $ |",
    "|--------|-------|-------|------|--------------|--------------|-----------------|-------------|",
  ];

  for (const row of report.summary.byModelDomain.sort(
    (a, b) => a.domain.localeCompare(b.domain) || a.modelId.localeCompare(b.modelId),
  )) {
    lines.push(
      `| ${row.domain} | ${row.modelId} | ${row.caseCount} | ${row.passCount} | ${(row.failureRate * 100).toFixed(0)}% | ${row.meanQuality} | ${row.meanLatencyMs} | ${row.meanCostUsd.toFixed(4)} |`,
    );
  }
  lines.push("");

  for (const c of report.cases) {
    lines.push(`## ${c.caseId} (${c.category})`);
    lines.push("");
    lines.push("| Model | Passed | Quality | Latency ms | In tok | Out tok | Est. $ |");
    lines.push("|-------|--------|---------|------------|--------|---------|--------|");
    for (const r of c.results) {
      lines.push(
        `| ${r.model} | ${r.passed ? "yes" : "no"} | ${r.qualityScore} | ${r.latencyMs} | ${r.inputTokens} | ${r.outputTokens} | ${r.estimatedCostUsd.toFixed(4)} |`,
      );
    }
    lines.push("");
    for (const r of c.results) {
      lines.push(`### ${r.model} — criterion results`);
      lines.push("");
      lines.push("| Criterion | Type | Pass | Score | Details |");
      lines.push("|-----------|------|------|-------|---------|");
      for (const cr of r.criterionResults) {
        lines.push(
          `| ${cr.criterionId} | ${cr.type} | ${cr.passed} | ${cr.score} | ${(cr.details ?? "").replace(/\|/g, "/")} |`,
        );
      }
      if (r.errors.length) {
        lines.push("", `Errors: ${r.errors.join("; ")}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
