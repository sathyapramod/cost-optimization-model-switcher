import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Provider } from "../types.js";
import type { BenchmarkDomain, BenchmarkSplit, EvaluationResult } from "./types.js";
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

/** Runs eligible to update routing evidence (train split only). */
export function liveRunsForRoutingEvidence(file: LiveRunsFile): LiveBenchmarkRun[] {
  return file.runs.filter((r) => r.evidenceEligible);
}
