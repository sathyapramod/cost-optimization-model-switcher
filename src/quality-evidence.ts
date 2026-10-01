import type { Provider } from "./types.js";
import type { SuccessSpecId } from "./success-criteria.js";
import { resolveModel } from "./catalog.js";
import { analyzeTask } from "./task-analyzer.js";
import { resolveSuccessSpecId } from "./task-contract.js";
import { TASK_CONTRACT_EVALUATOR_ID } from "./task-quality/evaluators.js";
import {
  evaluateTaskCandidate,
  TASK_QUALITY_FRAMEWORK_VERSION,
} from "./task-quality/runner.js";
import { loadTaskQualityFixtures } from "./task-quality/fixtures.js";
import {
  DEFAULT_LIVE_RUNS_PATH,
  liveRunsForRoutingEvidence,
  loadLiveRuns,
  type LiveBenchmarkRun,
} from "./task-quality/live-runs.js";
import type { BenchmarkSplit, TaskCase } from "./task-quality/types.js";
import type { Confidence } from "./types.js";

export type EvidenceSource = "fixture_train" | "fixture_holdout" | "live" | "synthetic";
export type EvidenceStatus = "known" | "insufficient" | "none";

export interface QualityEvidenceRun {
  taskId: string;
  benchmarkSplit: BenchmarkSplit;
  passed: boolean;
  qualityScore: number;
  /** When set, distinguishes fixture vs live rows inside a merged record. */
  runSource?: EvidenceSource;
}

export interface QualityEvidenceRecord {
  provider: Provider;
  modelId: string;
  /** Catalog identity snapshot (model id + tier). */
  modelVersion: string;
  specId: SuccessSpecId;
  evaluatorId: string;
  evaluatorVersion: string;
  evidenceSource: EvidenceSource;
  runs: QualityEvidenceRun[];
  passCount: number;
  failCount: number;
  sampleCount: number;
  passRate: number;
  /** Mean quality score across all runs (pass and fail). */
  meanQuality: number;
  /** @deprecated use meanQuality */
  expectedQuality: number;
  evidenceConfidence: Confidence;
  fixtureTaskIds: string[];
}

export interface QualityEvidenceIndex {
  version: "2";
  evaluatorId: string;
  evaluatorVersion: string;
  evidenceSource: EvidenceSource;
  note: string;
  records: QualityEvidenceRecord[];
}

function evidenceKey(provider: Provider, modelId: string, specId: SuccessSpecId): string {
  return `${provider}:${modelId}:${specId}`;
}

function modelVersionString(modelId: string, provider: Provider): string {
  const resolved = resolveModel(modelId, undefined, provider);
  return `${modelId}@tier=${resolved.tier}`;
}

function evidenceConfidenceFromSamples(
  sampleCount: number,
  passRate: number,
): Confidence {
  if (sampleCount < 1) return "low";
  if (sampleCount < 3) return "low";
  if (sampleCount < 6) return passRate >= 0.75 ? "medium" : "low";
  if (passRate >= 0.85) return "high";
  if (passRate >= 0.6) return "medium";
  return "low";
}

export interface BuildQualityEvidenceOptions {
  /** Which fixture split feeds the routing evidence index (default train only). */
  split?: BenchmarkSplit;
  cases?: TaskCase[];
}

export function buildQualityEvidenceIndex(
  options?: BuildQualityEvidenceOptions,
): QualityEvidenceIndex {
  const split = options?.split ?? "train";
  const suite = options?.cases
    ? { version: "1", cases: options.cases }
    : loadTaskQualityFixtures();
  const cases = suite.cases.filter((c) => (c.benchmarkSplit ?? "train") === split);

  const buckets = new Map<
    string,
    {
      provider: Provider;
      modelId: string;
      specId: SuccessSpecId;
      runs: QualityEvidenceRun[];
      taskIds: string[];
    }
  >();

  for (const taskCase of cases) {
    const analysis = analyzeTask({
      userMessage: taskCase.userMessage,
      probes: taskCase.probes,
    });
    const specId = resolveSuccessSpecId(analysis, taskCase.userMessage);
    const caseSplit = taskCase.benchmarkSplit ?? "train";

    for (const candidate of taskCase.candidates) {
      const result = evaluateTaskCandidate(taskCase, candidate);
      const key = evidenceKey(candidate.provider, candidate.modelId, specId);
      const bucket =
        buckets.get(key) ??
        {
          provider: candidate.provider,
          modelId: candidate.modelId,
          specId,
          runs: [],
          taskIds: [],
        };
      bucket.runs.push({
        taskId: taskCase.id,
        benchmarkSplit: caseSplit,
        passed: result.passed,
        qualityScore: result.qualityScore,
        runSource: split === "holdout" ? "fixture_holdout" : "fixture_train",
      });
      bucket.taskIds.push(taskCase.id);
      buckets.set(key, bucket);
    }
  }

  const evidenceSource: EvidenceSource =
    split === "holdout" ? "fixture_holdout" : "fixture_train";

  const records: QualityEvidenceRecord[] = [...buckets.values()].map((b) => {
    const passCount = b.runs.filter((r) => r.passed).length;
    const failCount = b.runs.length - passCount;
    const sampleCount = b.runs.length;
    const passRate = sampleCount ? passCount / sampleCount : 0;
    const meanQuality =
      sampleCount ? b.runs.reduce((a, r) => a + r.qualityScore, 0) / sampleCount : 0;

    return {
      provider: b.provider,
      modelId: b.modelId,
      modelVersion: modelVersionString(b.modelId, b.provider),
      specId: b.specId,
      evaluatorId: TASK_CONTRACT_EVALUATOR_ID,
      evaluatorVersion: TASK_QUALITY_FRAMEWORK_VERSION,
      evidenceSource,
      runs: b.runs,
      passCount,
      failCount,
      sampleCount,
      passRate,
      meanQuality,
      expectedQuality: meanQuality,
      evidenceConfidence: evidenceConfidenceFromSamples(sampleCount, passRate),
      fixtureTaskIds: [...new Set(b.taskIds)],
    };
  });

  return {
    version: "2",
    evaluatorId: TASK_CONTRACT_EVALUATOR_ID,
    evaluatorVersion: TASK_QUALITY_FRAMEWORK_VERSION,
    evidenceSource,
    note:
      "Evidence Index v2: all evaluation runs (pass and fail). Training split feeds routing quality assurance; holdout is for generalization checks.",
    records,
  };
}

/** @deprecated alias */
export function buildQualityEvidenceFromFixtures(
  options?: BuildQualityEvidenceOptions,
): QualityEvidenceIndex {
  return buildQualityEvidenceIndex(options);
}

function recordEvidenceSourceFromRuns(runs: QualityEvidenceRun[]): EvidenceSource {
  if (runs.some((r) => r.runSource === "live")) return "live";
  return "fixture_train";
}

function rebuildRecord(
  partial: Omit<QualityEvidenceRecord, "passCount" | "failCount" | "sampleCount" | "passRate" | "meanQuality" | "expectedQuality" | "evidenceConfidence" | "evidenceSource">,
  runs: QualityEvidenceRun[],
): QualityEvidenceRecord {
  const passCount = runs.filter((r) => r.passed).length;
  const failCount = runs.length - passCount;
  const sampleCount = runs.length;
  const passRate = sampleCount ? passCount / sampleCount : 0;
  const meanQuality =
    sampleCount ? runs.reduce((a, r) => a + r.qualityScore, 0) / sampleCount : 0;
  return {
    ...partial,
    runs,
    passCount,
    failCount,
    sampleCount,
    passRate,
    meanQuality,
    expectedQuality: meanQuality,
    evidenceConfidence: evidenceConfidenceFromSamples(sampleCount, passRate),
    evidenceSource: recordEvidenceSourceFromRuns(runs),
    fixtureTaskIds: [...new Set(runs.map((r) => r.taskId))],
  };
}

/** Merge train-split live runs into a fixture-built index (holdout live runs are ignored). */
export function mergeLiveRunsIntoEvidenceIndex(
  base: QualityEvidenceIndex,
  liveRuns: LiveBenchmarkRun[],
): QualityEvidenceIndex {
  const eligible = liveRuns.filter((r) => r.evidenceEligible);
  if (!eligible.length) return base;

  const byKey = new Map<string, QualityEvidenceRecord>();
  for (const r of base.records) {
    byKey.set(evidenceKey(r.provider, r.modelId, r.specId), r);
  }

  for (const live of eligible) {
    const specId = live.evaluation.specId as SuccessSpecId;
    const key = evidenceKey(live.provider, live.modelId, specId);
    const existing = byKey.get(key);
    const liveRun: QualityEvidenceRun = {
      taskId: live.taskId,
      benchmarkSplit: live.benchmarkSplit,
      passed: live.evaluation.passed,
      qualityScore: live.evaluation.qualityScore,
      runSource: "live",
    };
    if (!existing) {
      byKey.set(
        key,
        rebuildRecord(
          {
            provider: live.provider,
            modelId: live.modelId,
            modelVersion: modelVersionString(live.modelId, live.provider),
            specId,
            evaluatorId: live.evaluation.evaluator,
            evaluatorVersion: TASK_QUALITY_FRAMEWORK_VERSION,
            runs: [liveRun],
            fixtureTaskIds: [live.taskId],
          },
          [liveRun],
        ),
      );
      continue;
    }
    const mergedRuns = [...existing.runs, liveRun];
    byKey.set(
      key,
      rebuildRecord(
        {
          provider: existing.provider,
          modelId: existing.modelId,
          modelVersion: existing.modelVersion,
          specId: existing.specId,
          evaluatorId: existing.evaluatorId,
          evaluatorVersion: existing.evaluatorVersion,
          runs: mergedRuns,
          fixtureTaskIds: existing.fixtureTaskIds,
        },
        mergedRuns,
      ),
    );
  }

  return {
    ...base,
    evidenceSource: [...byKey.values()].some((r) => r.evidenceSource === "live")
      ? "live"
      : base.evidenceSource,
    note: `${base.note} Live train-split runs merged when benchmarks/results/live-runs.json is present.`,
    records: [...byKey.values()],
  };
}

export interface LoadDefaultQualityEvidenceOptions {
  liveRunsPath?: string;
  /** Force-enable/disable live merge regardless of NODE_ENV (tests use this explicitly). */
  includeLive?: boolean;
}

/**
 * Live runs are a gitignored, developer-machine artifact (`benchmarks/results/live-runs.json`).
 * Unit tests must stay hermetic and reproducible in CI/clean clones regardless of what a
 * developer has run locally, so live merge is skipped under NODE_ENV=test unless a caller
 * explicitly opts in via `includeLive: true` (e.g. a test asserting merge behavior itself).
 */
export function buildRoutingQualityEvidence(
  options?: LoadDefaultQualityEvidenceOptions,
): QualityEvidenceIndex {
  const fixture = buildQualityEvidenceIndex({ split: "train" });
  const includeLive = options?.includeLive ?? process.env.NODE_ENV !== "test";
  if (!includeLive) return fixture;
  const path = options?.liveRunsPath ?? DEFAULT_LIVE_RUNS_PATH;
  const liveFile = loadLiveRuns(path);
  return mergeLiveRunsIntoEvidenceIndex(fixture, liveRunsForRoutingEvidence(liveFile));
}

let cachedIndex: QualityEvidenceIndex | null = null;

export function loadDefaultQualityEvidence(
  options?: LoadDefaultQualityEvidenceOptions,
): QualityEvidenceIndex {
  if (!cachedIndex) {
    cachedIndex = buildRoutingQualityEvidence(options);
  }
  return cachedIndex;
}

export function resetQualityEvidenceCache(): void {
  cachedIndex = null;
}

export function lookupQualityEvidence(
  index: QualityEvidenceIndex,
  provider: Provider,
  modelId: string,
  specId: SuccessSpecId,
): QualityEvidenceRecord | null {
  const forModelSpec = index.records.filter(
    (r) => r.modelId === modelId && r.specId === specId,
  );
  if (!forModelSpec.length) return null;

  const forProvider = forModelSpec.find((r) => r.provider === provider);
  if (forProvider) return forProvider;

  if (forModelSpec.length === 1) return forModelSpec[0]!;

  const ranked = [...forModelSpec].sort((a, b) => b.sampleCount - a.sampleCount);
  return ranked[0] ?? null;
}
