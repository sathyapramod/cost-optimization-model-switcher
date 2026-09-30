import type { Provider } from "./types.js";
import type { SuccessSpecId } from "./success-criteria.js";
import { analyzeTask } from "./task-analyzer.js";
import { resolveSuccessSpecId } from "./task-contract.js";
import { evaluateTaskCandidate } from "./task-quality/runner.js";
import { loadTaskQualityFixtures } from "./task-quality/fixtures.js";

export interface QualityEvidenceRecord {
  provider: Provider;
  modelId: string;
  specId: SuccessSpecId;
  expectedQuality: number;
  sampleCount: number;
  /** Fixture task ids that contributed to this aggregate. */
  fixtureTaskIds: string[];
}

export interface QualityEvidenceIndex {
  version: string;
  note: string;
  records: QualityEvidenceRecord[];
}

function evidenceKey(provider: Provider, modelId: string, specId: SuccessSpecId): string {
  return `${provider}:${modelId}:${specId}`;
}

export function buildQualityEvidenceFromFixtures(): QualityEvidenceIndex {
  const suite = loadTaskQualityFixtures();
  const buckets = new Map<
    string,
    { provider: Provider; modelId: string; specId: SuccessSpecId; scores: number[]; taskIds: string[] }
  >();

  for (const taskCase of suite.cases) {
    const analysis = analyzeTask({
      userMessage: taskCase.userMessage,
      probes: taskCase.probes,
    });
    const specId = resolveSuccessSpecId(analysis, taskCase.userMessage);

    for (const candidate of taskCase.candidates) {
      const result = evaluateTaskCandidate(taskCase, candidate);
      if (!result.passed) continue;
      const key = evidenceKey(candidate.provider, candidate.modelId, specId);
      const bucket =
        buckets.get(key) ??
        {
          provider: candidate.provider,
          modelId: candidate.modelId,
          specId,
          scores: [],
          taskIds: [],
        };
      bucket.scores.push(result.qualityScore);
      bucket.taskIds.push(taskCase.id);
      buckets.set(key, bucket);
    }
  }

  const records: QualityEvidenceRecord[] = [...buckets.values()].map((b) => ({
    provider: b.provider,
    modelId: b.modelId,
    specId: b.specId,
    expectedQuality: b.scores.reduce((a, n) => a + n, 0) / b.scores.length,
    sampleCount: b.scores.length,
    fixtureTaskIds: [...b.taskIds],
  }));

  return {
    version: suite.version,
    note:
      "Aggregated expected quality from offline task-quality fixtures — not benchmarks/success-rates.json.",
    records,
  };
}

let cachedIndex: QualityEvidenceIndex | null = null;

export function loadDefaultQualityEvidence(): QualityEvidenceIndex {
  if (!cachedIndex) {
    cachedIndex = buildQualityEvidenceFromFixtures();
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

  // Shared catalog model ids (e.g. claude-opus-4-6 on cursor vs anthropic) reuse fixture evidence.
  if (forModelSpec.length === 1) return forModelSpec[0]!;

  const ranked = [...forModelSpec].sort((a, b) => b.sampleCount - a.sampleCount);
  return ranked[0] ?? null;
}
