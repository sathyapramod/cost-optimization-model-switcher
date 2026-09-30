import type { CapabilityRouteResult } from "./capability-router.js";
import type { QualityConstrainedRoutingResult } from "./quality-constrained-policy.js";
import type {
  EvidenceSource,
  EvidenceStatus,
  QualityEvidenceIndex,
} from "./quality-evidence.js";
import { lookupQualityEvidence } from "./quality-evidence.js";
import type { SuccessSpecId } from "./success-criteria.js";
import type { CapabilityTier, Confidence } from "./types.js";

/** Where empirical quality data came from. */
export type { EvidenceSource, EvidenceStatus } from "./quality-evidence.js";

/**
 * Quality guarantee semantics — not interchangeable with routing recommendation.
 * - none: no empirical claim about task success on the suggested model
 * - probabilistic: fixture/live pass-rate + mean quality vs declared floor (not deterministic truth)
 * - abstain: insufficient evidence or underspecified task — do not treat as safe to switch down
 */
export type QualityGuaranteeLevel = "none" | "probabilistic" | "abstain";

export interface QualityGuarantee {
  level: QualityGuaranteeLevel;
  statement: string;
}

export interface RoutingRecommendation {
  kind: "capability_routing";
  recommendedModelId: string | null;
  recommendedTier: CapabilityTier;
  capableTier: CapabilityTier | null;
  legacyTier: CapabilityTier;
  currentMeetsTask: boolean;
  explanation: string;
  /** Capability profiles + cost policy only — not task-success ground truth. */
  disclaimer: string;
  capabilityRoute: CapabilityRouteResult;
}

export interface QualityAssurance {
  kind: "quality_assurance";
  guarantee: QualityGuarantee;
  evidenceStatus: EvidenceStatus;
  evidenceSource: EvidenceSource;
  /** Evidence confidence for the selected model (if any). */
  evidenceConfidence: Confidence | null;
  result: QualityConstrainedRoutingResult;
}

export type EffectiveRecommendationBasis =
  | "capability_only"
  | "quality_assured"
  | "abstain_preserve_current";

export interface EffectiveRoutingRecommendation {
  modelId: string | null;
  tier: CapabilityTier;
  basis: EffectiveRecommendationBasis;
  routingConfidenceNote: string;
}

export function buildRoutingRecommendation(
  cap: CapabilityRouteResult,
  resolvedTier: CapabilityTier,
): RoutingRecommendation {
  return {
    kind: "capability_routing",
    recommendedModelId: cap.recommendedModelId,
    recommendedTier: cap.recommendedTier ?? resolvedTier,
    capableTier: cap.capableTier,
    legacyTier: cap.legacyTier,
    currentMeetsTask: cap.currentMeetsTask,
    explanation: cap.explanation,
    disclaimer:
      "Capability routing estimates fit from curated profiles and cost policy — not verified task quality.",
    capabilityRoute: cap,
  };
}

export function deriveQualityGuarantee(
  quality: QualityConstrainedRoutingResult,
  evidenceStatus: EvidenceStatus,
): QualityGuarantee {
  if (quality.requiredQuality === null || quality.preserveCurrentModel) {
    return {
      level: "abstain",
      statement:
        "No quality-assured model switch: underspecified task, insufficient evidence, or no model meets the quality floor.",
    };
  }
  if (evidenceStatus === "insufficient" || evidenceStatus === "none") {
    return {
      level: "abstain",
      statement:
        "Quality assurance abstains: empirical evaluation evidence is missing or below minimum sample count.",
    };
  }
  if (quality.selectedModelId) {
    return {
      level: "probabilistic",
      statement:
        "Probabilistic guarantee only: offline evaluator pass-rate and mean quality met the declared floor on training fixtures — not deterministic correctness.",
    };
  }
  return {
    level: "none",
    statement: "No model satisfied the quality floor under available evidence.",
  };
}

export function resolveEvidenceStatusForSpec(
  index: QualityEvidenceIndex,
  specId: SuccessSpecId,
  minSamples: number,
): { status: EvidenceStatus; source: EvidenceSource } {
  const rows = index.records.filter((r) => r.specId === specId);
  if (!rows.length) {
    return { status: "none", source: index.evidenceSource };
  }
  const totalSamples = rows.reduce((n, r) => n + r.sampleCount, 0);
  if (totalSamples < minSamples) {
    return { status: "insufficient", source: index.evidenceSource };
  }
  return { status: "known", source: index.evidenceSource };
}

export function buildQualityAssurance(
  quality: QualityConstrainedRoutingResult,
  index: QualityEvidenceIndex,
  minSamples: number,
  provider?: import("./types.js").Provider,
): QualityAssurance {
  const { status, source } = resolveEvidenceStatusForSpec(
    index,
    quality.successSpecId,
    minSamples,
  );
  const selectedRecord =
    quality.selectedModelId != null && provider
      ? lookupQualityEvidence(index, provider, quality.selectedModelId, quality.successSpecId)
      : null;

  return {
    kind: "quality_assurance",
    guarantee: deriveQualityGuarantee(quality, status),
    evidenceStatus: status,
    evidenceSource: source,
    evidenceConfidence: selectedRecord?.evidenceConfidence ?? null,
    result: quality,
  };
}

/**
 * Gate-facing merge: quality assurance may veto capability downgrade when abstaining;
 * it may adopt quality-selected model when guarantee is probabilistic.
 */
export function resolveEffectiveRecommendation(
  routing: RoutingRecommendation,
  assurance: QualityAssurance,
  currentTier: CapabilityTier,
  currentModelId: string,
): EffectiveRoutingRecommendation {
  const q = assurance.result;

  if (assurance.guarantee.level === "abstain") {
    return {
      modelId: null,
      tier: currentTier,
      basis: "abstain_preserve_current",
      routingConfidenceNote:
        "Quality assurance abstained; preserve current model despite capability-only candidate.",
    };
  }

  if (
    assurance.guarantee.level === "probabilistic" &&
    q.selectedModelId &&
    !q.preserveCurrentModel
  ) {
    return {
      modelId: q.selectedModelId,
      tier: q.selectedTier ?? routing.recommendedTier,
      basis: "quality_assured",
      routingConfidenceNote:
        "Switch model aligns with quality-assured selection (probabilistic, not deterministic).",
    };
  }

  return {
    modelId: routing.recommendedModelId,
    tier: routing.recommendedTier,
    basis: "capability_only",
    routingConfidenceNote:
      "Switch follows capability routing only — no probabilistic quality guarantee attached.",
  };
}
