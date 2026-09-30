import type { ResolvedModel } from "./catalog.js";
import { buildSwitchCostEstimate } from "./cost.js";
import type { CatalogModelProfile } from "./model-profiles.js";
import type { CapabilityRouteResult } from "./capability-router.js";
import type { SuccessSpecId } from "./success-criteria.js";
import { resolveSuccessSpecId } from "./task-contract.js";
import type { TaskAnalysis } from "./task-analyzer.js";
import {
  loadDefaultQualityEvidence,
  lookupQualityEvidence,
  type QualityEvidenceIndex,
  type QualityEvidenceRecord,
} from "./quality-evidence.js";
import type { CapabilityTier, Confidence, Provider } from "./types.js";

const TIER_RANK: Record<CapabilityTier, number> = {
  fast: 0,
  balanced: 1,
  premium: 2,
};

export interface QualityConstrainedPolicyConfig {
  /** Minimum expected quality (0–1) for models in the switch candidate set. */
  defaultRequiredQuality: number;
  /** Raised floor for high-stakes success specifications. */
  highStakesRequiredQuality: number;
  minEvidenceSamples: number;
  /** When true, models without fixture-backed evidence are not selected. */
  requireEvidenceForSelection: boolean;
}

export const DEFAULT_QUALITY_CONSTRAINED_POLICY: QualityConstrainedPolicyConfig = {
  defaultRequiredQuality: 0.85,
  highStakesRequiredQuality: 0.9,
  minEvidenceSamples: 1,
  requireEvidenceForSelection: true,
};

export type QualityCandidateStatus =
  | "eligible"
  | "rejected_quality"
  | "rejected_direction"
  | "insufficient_evidence";

export interface QualityConstrainedCandidate {
  modelId: string;
  tier: CapabilityTier;
  expectedQuality: number | null;
  estimatedTurnCostUsd: number;
  status: QualityCandidateStatus;
  rejectReason?: string;
  evidence?: Pick<QualityEvidenceRecord, "sampleCount" | "fixtureTaskIds" | "expectedQuality">;
}

export interface QualityConstrainedRoutingResult {
  policy: "minimize_cost_subject_to_quality";
  successSpecId: SuccessSpecId;
  requiredQuality: number | null;
  evidenceSummary: string;
  candidates: QualityConstrainedCandidate[];
  rejectedModels: Array<{ modelId: string; reason: string }>;
  selectedModelId: string | null;
  selectedTier: CapabilityTier | null;
  preserveCurrentModel: boolean;
  confidence: Confidence;
  costDifferenceUsd: number | null;
  explanation: string;
  noOpReason?: string;
}

export interface QualityConstrainedRoutingInput {
  resolved: ResolvedModel;
  taskAnalysis: TaskAnalysis;
  capabilityResult: CapabilityRouteResult;
  switchDirection: "downgrade" | "upgrade";
  effectiveInputTokens: number;
  evidence?: QualityEvidenceIndex;
  policy?: Partial<QualityConstrainedPolicyConfig>;
}

export function deriveRequiredQuality(
  specId: SuccessSpecId,
  policy: QualityConstrainedPolicyConfig,
): number | null {
  if (specId === "underspecified") return null;
  if (specId === "security" || specId === "architecture") {
    return policy.highStakesRequiredQuality;
  }
  return policy.defaultRequiredQuality;
}

function meetsSwitchDirection(
  modelTier: CapabilityTier,
  currentTier: CapabilityTier,
  direction: "downgrade" | "upgrade",
): boolean {
  const currentRank = TIER_RANK[currentTier];
  const modelRank = TIER_RANK[modelTier];
  if (direction === "downgrade") return modelRank < currentRank;
  return modelRank > currentRank;
}

function estimateTurnCostUsd(
  model: CatalogModelProfile,
  provider: Provider,
  inputTokens: number,
  taskClass: TaskAnalysis["taskClass"],
): number {
  const est = buildSwitchCostEstimate({
    currentModelId: model.modelId,
    recommendedModelId: model.modelId,
    provider,
    currentTier: model.tier,
    recommendedTier: model.tier,
    inputTokens,
    taskClass,
  });
  return est.estimated_cost_current_usd;
}

function rankConfidence(
  preserve: boolean,
  eligible: QualityConstrainedCandidate[],
  requiredQuality: number | null,
): Confidence {
  if (preserve || requiredQuality === null) return "low";
  if (eligible.length === 0) return "low";
  const withEvidence = eligible.filter((c) => c.evidence != null);
  if (withEvidence.length === 0) return "low";
  if (withEvidence.length < eligible.length) return "medium";
  const minSamples = Math.min(...withEvidence.map((c) => c.evidence!.sampleCount));
  if (minSamples >= 2) return "high";
  return "medium";
}

function formatEvidenceSummary(
  specId: SuccessSpecId,
  index: QualityEvidenceIndex,
  requiredQuality: number | null,
): string {
  const forSpec = index.records.filter((r) => r.specId === specId);
  if (!forSpec.length) {
    return `No offline task-quality fixture evidence for spec "${specId}".`;
  }
  const models = forSpec.map((r) => `${r.modelId} (n=${r.sampleCount}, q≈${r.expectedQuality.toFixed(2)})`);
  return (
    `Fixture-backed evidence for "${specId}"` +
    (requiredQuality != null ? ` vs required≥${requiredQuality.toFixed(2)}` : "") +
    `: ${models.join("; ")}.`
  );
}

function buildExplanation(result: {
  requiredQuality: number | null;
  evidenceSummary: string;
  rejectedModels: Array<{ modelId: string; reason: string }>;
  selectedModelId: string | null;
  costDifferenceUsd: number | null;
  confidence: Confidence;
  preserveCurrentModel: boolean;
  currentModelId: string;
}): string {
  const parts: string[] = [
    "Quality-constrained routing (minimize cost, quality floor):",
  ];
  if (result.requiredQuality != null) {
    parts.push(`required quality≥${result.requiredQuality.toFixed(2)}.`);
  } else {
    parts.push("required quality undefined (underspecified task).");
  }
  parts.push(result.evidenceSummary);
  if (result.rejectedModels.length) {
    const rej = result.rejectedModels
      .map((r) => `${r.modelId} (${r.reason})`)
      .join("; ");
    parts.push(`Rejected: ${rej}.`);
  }
  if (result.preserveCurrentModel) {
    parts.push(`Preserving ${result.currentModelId} — no safe cheaper/suitable switch.`);
  } else if (result.selectedModelId) {
    parts.push(`Selected ${result.selectedModelId}.`);
    if (result.costDifferenceUsd != null && result.costDifferenceUsd > 0) {
      parts.push(`Estimated turn savings ~$${result.costDifferenceUsd.toFixed(4)} vs current.`);
    } else if (result.costDifferenceUsd != null && result.costDifferenceUsd < 0) {
      parts.push(
        `Estimated extra turn cost ~$${Math.abs(result.costDifferenceUsd).toFixed(4)} vs current.`,
      );
    }
  }
  parts.push(`Confidence: ${result.confidence}.`);
  return parts.join(" ");
}

/**
 * Phase 6: minimize model cost subject to expected task quality ≥ required quality.
 * Uses offline task-quality fixture evidence; does not invent scores when data is missing.
 */
export function executeQualityConstrainedRouting(
  input: QualityConstrainedRoutingInput,
): QualityConstrainedRoutingResult {
  const policy = { ...DEFAULT_QUALITY_CONSTRAINED_POLICY, ...input.policy };
  const evidence = input.evidence ?? loadDefaultQualityEvidence();
  const { taskAnalysis, capabilityResult, resolved } = input;
  const specId = resolveSuccessSpecId(taskAnalysis, taskAnalysis.contract.objective);

  const requiredQuality = deriveRequiredQuality(specId, policy);
  const evidenceSummary = formatEvidenceSummary(specId, evidence, requiredQuality);

  if (requiredQuality === null) {
    return {
      policy: "minimize_cost_subject_to_quality",
      successSpecId: specId,
      requiredQuality: null,
      evidenceSummary,
      candidates: [],
      rejectedModels: [],
      selectedModelId: null,
      selectedTier: null,
      preserveCurrentModel: true,
      confidence: "low",
      costDifferenceUsd: null,
      noOpReason: "underspecified task — cannot derive required quality threshold",
      explanation: buildExplanation({
        requiredQuality: null,
        evidenceSummary,
        rejectedModels: [],
        selectedModelId: null,
        costDifferenceUsd: null,
        confidence: "low",
        preserveCurrentModel: true,
        currentModelId: resolved.modelId,
      }),
    };
  }

  const rejectedModels: Array<{ modelId: string; reason: string }> = [];
  const candidates: QualityConstrainedCandidate[] = [];

  for (const model of capabilityResult.capableModels) {
    const directionOk = meetsSwitchDirection(
      model.tier,
      resolved.tier,
      input.switchDirection,
    );
    const turnCost = estimateTurnCostUsd(
      model,
      resolved.provider,
      input.effectiveInputTokens,
      taskAnalysis.taskClass,
    );

    if (!directionOk) {
      const row: QualityConstrainedCandidate = {
        modelId: model.modelId,
        tier: model.tier,
        expectedQuality: null,
        estimatedTurnCostUsd: turnCost,
        status: "rejected_direction",
        rejectReason: `not a ${input.switchDirection} from ${resolved.tier}`,
      };
      candidates.push(row);
      continue;
    }

    const record = lookupQualityEvidence(
      evidence,
      resolved.provider,
      model.modelId,
      specId,
    );

    if (!record || record.sampleCount < policy.minEvidenceSamples) {
      const row: QualityConstrainedCandidate = {
        modelId: model.modelId,
        tier: model.tier,
        expectedQuality: null,
        estimatedTurnCostUsd: turnCost,
        status: "insufficient_evidence",
        rejectReason: "no fixture-backed quality evidence for this model and task spec",
      };
      candidates.push(row);
      if (policy.requireEvidenceForSelection) {
        rejectedModels.push({ modelId: model.modelId, reason: row.rejectReason! });
      }
      continue;
    }

    if (record.expectedQuality < requiredQuality) {
      const reason = `expected quality ${record.expectedQuality.toFixed(2)} < required ${requiredQuality.toFixed(2)}`;
      candidates.push({
        modelId: model.modelId,
        tier: model.tier,
        expectedQuality: record.expectedQuality,
        estimatedTurnCostUsd: turnCost,
        status: "rejected_quality",
        rejectReason: reason,
        evidence: {
          expectedQuality: record.expectedQuality,
          sampleCount: record.sampleCount,
          fixtureTaskIds: record.fixtureTaskIds,
        },
      });
      rejectedModels.push({ modelId: model.modelId, reason });
      continue;
    }

    candidates.push({
      modelId: model.modelId,
      tier: model.tier,
      expectedQuality: record.expectedQuality,
      estimatedTurnCostUsd: turnCost,
      status: "eligible",
      evidence: {
        expectedQuality: record.expectedQuality,
        sampleCount: record.sampleCount,
        fixtureTaskIds: record.fixtureTaskIds,
      },
    });
  }

  const eligible = candidates.filter((c) => c.status === "eligible");
  const sortedEligible = [...eligible].sort(
    (a, b) => a.estimatedTurnCostUsd - b.estimatedTurnCostUsd,
  );
  const selected = sortedEligible[0] ?? null;

  const preserveCurrentModel = selected == null;
  const confidence = rankConfidence(preserveCurrentModel, eligible, requiredQuality);

  let costDifferenceUsd: number | null = null;
  if (selected && !preserveCurrentModel) {
    const switchEst = buildSwitchCostEstimate({
      currentModelId: resolved.modelId,
      recommendedModelId: selected.modelId,
      provider: resolved.provider,
      currentTier: resolved.tier,
      recommendedTier: selected.tier,
      inputTokens: input.effectiveInputTokens,
      taskClass: taskAnalysis.taskClass,
    });
    costDifferenceUsd = switchEst.estimated_savings_usd;
  }

  const noOpReason = preserveCurrentModel
    ? eligible.length === 0
      ? "no model with sufficient quality evidence meets the required quality floor"
      : "no eligible model after quality constraints"
    : undefined;

  const explanation = buildExplanation({
    requiredQuality,
    evidenceSummary,
    rejectedModels,
    selectedModelId: selected?.modelId ?? null,
    costDifferenceUsd,
    confidence,
    preserveCurrentModel,
    currentModelId: resolved.modelId,
  });

  return {
    policy: "minimize_cost_subject_to_quality",
    successSpecId: specId,
    requiredQuality,
    evidenceSummary,
    candidates,
    rejectedModels,
    selectedModelId: preserveCurrentModel ? null : selected!.modelId,
    selectedTier: preserveCurrentModel ? null : selected!.tier,
    preserveCurrentModel,
    confidence,
    costDifferenceUsd,
    explanation,
    noOpReason,
  };
}
