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
import type { BenchmarkSplit, TaskCase } from "./task-quality/types.js";
import type { Confidence } from "./types.js";

export type EvidenceSource = "fixture_train" | "fixture_holdout" | "live" | "synthetic";
export type EvidenceStatus = "known" | "insufficient" | "none";

export interface QualityEvidenceRun {
  taskId: string;
  benchmarkSplit: BenchmarkSplit;
  passed: boolean;
  qualityScore: number;
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

let cachedIndex: QualityEvidenceIndex | null = null;

export function loadDefaultQualityEvidence(): QualityEvidenceIndex {
  if (!cachedIndex) {
    cachedIndex = buildQualityEvidenceIndex({ split: "train" });
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
