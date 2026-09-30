import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Provider } from "../types.js";
import { buildLiveUserPrompt, loadCaseInputText } from "./case-input.js";
import {
  completeLiveModel,
  type ChatCompletionResult,
  type LiveModelTarget,
} from "./live-client.js";
import { loadTaskQualityFixtures } from "./fixtures.js";
import { evaluateTaskCandidate } from "./runner.js";
import type { BenchmarkDomain, BenchmarkSplit, EvaluationResult, TaskCase } from "./types.js";
import { TASK_QUALITY_FRAMEWORK_VERSION } from "./runner.js";

const defaultResultsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "benchmarks",
  "results",
);

export const DEFAULT_LIVE_RUNS_PATH = join(defaultResultsDir, "live-runs.json");

export interface LiveBenchmarkRun {
  taskId: string;
  domain?: BenchmarkDomain;
  benchmarkSplit: BenchmarkSplit;
  provider: Provider;
  modelId: string;
  modelVersion?: string;
  completedAt: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  output: string;
  evaluation: Pick<
    EvaluationResult,
    "passed" | "qualityScore" | "specId" | "errors" | "evaluator"
  >;
  /** Train-split live runs can be merged into routing evidence index v2. */
  evidenceEligible: boolean;
}

export interface LiveRunsFile {
  version: "1";
  frameworkVersion: string;
  note: string;
  runs: LiveBenchmarkRun[];
}

export interface RunLiveBenchmarkOptions {
  target: LiveModelTarget;
  /** Default: holdout (generalization slice; not merged into routing evidence). */
  benchmarkSplit?: BenchmarkSplit | "all";
  domains?: BenchmarkDomain[];
  caseIds?: string[];
  maxCases?: number;
  dryRun?: boolean;
  fixturesPath?: string;
  outPath?: string;
  append?: boolean;
  /** Injection point for tests; defaults to the real `completeLiveModel` API call. */
  completeFn?: (
    target: LiveModelTarget,
    prompt: string,
  ) => Promise<ChatCompletionResult>;
}

export function loadLiveRuns(path = DEFAULT_LIVE_RUNS_PATH): LiveRunsFile {
  if (!existsSync(path)) {
    return {
      version: "1",
      frameworkVersion: TASK_QUALITY_FRAMEWORK_VERSION,
      note: "Live model outputs evaluated with the same task-contract criteria as fixtures.",
      runs: [],
    };
  }
  return JSON.parse(readFileSync(path, "utf8")) as LiveRunsFile;
}

export function saveLiveRuns(file: LiveRunsFile, path = DEFAULT_LIVE_RUNS_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

function filterCases(
  cases: TaskCase[],
  options: RunLiveBenchmarkOptions,
): TaskCase[] {
  let out = cases;
  const split = options.benchmarkSplit ?? "holdout";
  if (split !== "all") {
    out = out.filter((c) => (c.benchmarkSplit ?? "train") === split);
  }
  if (options.domains?.length) {
    out = out.filter((c) => c.domain && options.domains!.includes(c.domain));
  }
  if (options.caseIds?.length) {
    const ids = new Set(options.caseIds);
    out = out.filter((c) => ids.has(c.id));
  }
  if (options.maxCases != null && options.maxCases > 0) {
    out = out.slice(0, options.maxCases);
  }
  return out;
}

export interface LiveBenchmarkReport {
  generatedAt: string;
  target: LiveModelTarget;
  benchmarkSplit: RunLiveBenchmarkOptions["benchmarkSplit"];
  dryRun: boolean;
  cases: {
    caseId: string;
    domain?: BenchmarkDomain;
    benchmarkSplit: BenchmarkSplit;
    promptChars: number;
    hasInputAsset: boolean;
    skipped?: string;
    /** API/network error for this case only — other cases still ran. */
    error?: string;
    result?: LiveBenchmarkRun;
  }[];
  summary: {
    caseCount: number;
    evaluated: number;
    passed: number;
    failed: number;
    errored: number;
    evidenceEligiblePassed: number;
  };
  outPath?: string;
}

export async function runLiveBenchmarkEvaluation(
  options: RunLiveBenchmarkOptions,
): Promise<LiveBenchmarkReport> {
  const suite = loadTaskQualityFixtures(options.fixturesPath);
  const cases = filterCases(suite.cases, options);
  const report: LiveBenchmarkReport = {
    generatedAt: new Date().toISOString(),
    target: options.target,
    benchmarkSplit: options.benchmarkSplit ?? "holdout",
    dryRun: Boolean(options.dryRun),
    cases: [],
    summary: {
      caseCount: cases.length,
      evaluated: 0,
      passed: 0,
      failed: 0,
      errored: 0,
      evidenceEligiblePassed: 0,
    },
  };

  const newRuns: LiveBenchmarkRun[] = [];

  for (const taskCase of cases) {
    const inputText = loadCaseInputText(taskCase);
    const prompt = buildLiveUserPrompt(taskCase, inputText);
    const split = taskCase.benchmarkSplit ?? "train";
    const entry: LiveBenchmarkReport["cases"][0] = {
      caseId: taskCase.id,
      domain: taskCase.domain,
      benchmarkSplit: split,
      promptChars: prompt.length,
      hasInputAsset: Boolean(inputText),
    };

    if (options.dryRun) {
      report.cases.push(entry);
      continue;
    }

    try {
      const complete = options.completeFn ?? completeLiveModel;
      const completion = await complete(options.target, prompt);
      const candidate = {
        modelId: options.target.modelId,
        provider: options.target.provider,
        output: completion.output,
        latencyMs: completion.latencyMs,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
      };
      const evaluation = evaluateTaskCandidate(taskCase, candidate);
      const evidenceEligible = split === "train";
      const run: LiveBenchmarkRun = {
        taskId: taskCase.id,
        domain: taskCase.domain,
        benchmarkSplit: split,
        provider: options.target.provider,
        modelId: options.target.modelId,
        completedAt: new Date().toISOString(),
        latencyMs: completion.latencyMs,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        output: completion.output,
        evaluation: {
          passed: evaluation.passed,
          qualityScore: evaluation.qualityScore,
          specId: evaluation.specId,
          errors: evaluation.errors,
          evaluator: evaluation.evaluator,
        },
        evidenceEligible,
      };
      entry.result = run;
      newRuns.push(run);
      report.summary.evaluated++;
      if (evaluation.passed) {
        report.summary.passed++;
        if (evidenceEligible) report.summary.evidenceEligiblePassed++;
      } else {
        report.summary.failed++;
      }
    } catch (err) {
      // One case failing (quota, timeout, malformed response) must not abort the batch —
      // record it and keep evaluating the rest.
      entry.error = err instanceof Error ? err.message : String(err);
      report.summary.errored++;
    }
    report.cases.push(entry);
  }

  if (!options.dryRun && newRuns.length) {
    const outPath = options.outPath ?? DEFAULT_LIVE_RUNS_PATH;
    const store =
      options.append === false
        ? {
            version: "1" as const,
            frameworkVersion: TASK_QUALITY_FRAMEWORK_VERSION,
            note: "Live model outputs evaluated with the same task-contract criteria as fixtures.",
            runs: [] as LiveBenchmarkRun[],
          }
        : loadLiveRuns(outPath);
    store.runs.push(...newRuns);
    saveLiveRuns(store, outPath);
    report.outPath = outPath;
  }

  return report;
}

export function formatLiveBenchmarkMarkdown(report: LiveBenchmarkReport): string {
  const lines = [
    "# Live benchmark evaluation",
    "",
    `Generated: ${report.generatedAt}`,
    `Model: ${report.target.provider}:${report.target.modelId}`,
    `Split filter: ${report.benchmarkSplit ?? "holdout"}${report.dryRun ? " (dry run)" : ""}`,
    "",
    `Cases: ${report.summary.caseCount} | Evaluated: ${report.summary.evaluated} | Pass: ${report.summary.passed} | Fail: ${report.summary.failed} | Errored: ${report.summary.errored}`,
    "",
    "| Case | Domain | Split | Input asset | Pass | Quality | Error |",
    "|------|--------|-------|-------------|------|---------|-------|",
  ];
  for (const c of report.cases) {
    const pass = c.result?.evaluation.passed;
    const q = c.result?.evaluation.qualityScore;
    lines.push(
      `| ${c.caseId} | ${c.domain ?? ""} | ${c.benchmarkSplit} | ${c.hasInputAsset ? "yes" : "no"} | ${pass == null ? "—" : pass ? "yes" : "no"} | ${q ?? "—"} | ${(c.error ?? "").replace(/\|/g, "/").slice(0, 200)} |`,
    );
  }
  if (report.summary.errored > 0) {
    lines.push("", `⚠️ ${report.summary.errored} case(s) errored (see table) — batch continued.`);
  }
  if (report.outPath) {
    lines.push("", `Appended runs to \`${report.outPath}\`. Train-split runs merge into routing evidence when present.`);
  }
  return lines.join("\n");
}

/** Runs eligible to update routing evidence (train split only). */
export function liveRunsForRoutingEvidence(file: LiveRunsFile): LiveBenchmarkRun[] {
  return file.runs.filter((r) => r.evidenceEligible);
}
