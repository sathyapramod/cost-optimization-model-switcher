import type { ResolvedModel } from "./catalog.js";
import {
  loadDefaultCapabilities,
  mergeCapabilities,
  type CapabilityCatalog,
} from "./capabilities.js";
import { routeByCapabilities, type CapabilityRouteResult } from "./capability-router.js";
import {
  DEFAULT_QUALITY_CONSTRAINED_POLICY,
  executeQualityConstrainedRouting,
  type QualityConstrainedRoutingResult,
} from "./quality-constrained-policy.js";
import { loadDefaultQualityEvidence } from "./quality-evidence.js";
import type { ProgressiveRoutingResult } from "./progressive-routing.js";
import {
  buildQualityAssurance,
  buildRoutingRecommendation,
  resolveEffectiveRecommendation,
  type EffectiveRoutingRecommendation,
  type QualityAssurance,
  type RoutingRecommendation,
} from "./routing-assurance.js";
import type { TaskAnalysis } from "./task-analyzer.js";
import type { CapabilityTier, ContextBand, ContextSource } from "./types.js";

export interface RoutingDecision {
  /** Capability-only recommendation (not a quality guarantee). */
  routingRecommendation: RoutingRecommendation;
  /** Empirical quality layer (may abstain). */
  qualityAssurance: QualityAssurance;
  /** Merged gate hint — quality abstain preserves current model. */
  effectiveRecommendation: EffectiveRoutingRecommendation;
  /** Lowest-cost capable tier among models that meet requirements (null if none). */
  capableTier: CapabilityTier | null;
  legacyTier: CapabilityTier;
  /** @deprecated Prefer `effectiveRecommendation.tier` — kept for gate compatibility. */
  recommendedTier: CapabilityTier;
  /** @deprecated Prefer `effectiveRecommendation.modelId`. */
  recommendedModelId: string | null;
  currentMeetsTask: boolean;
  explanation: string;
  capabilityRoute?: CapabilityRouteResult;
  /** @deprecated Use `qualityAssurance.result`. */
  qualityConstrained?: QualityConstrainedRoutingResult;
  progressiveRouting?: ProgressiveRoutingResult;
}

export interface RouteInput {
  resolved: ResolvedModel;
  taskAnalysis: TaskAnalysis;
  contextBand: ContextBand;
  primarySource: ContextSource;
  userMessage: string;
  taskDifficulty: number;
  switchDirection: "downgrade" | "upgrade";
  effectiveInputTokens?: number;
}

export function routeForTask(input: RouteInput): RoutingDecision {
  const effectiveInputTokens =
    input.effectiveInputTokens ?? input.taskAnalysis.estimatedInputTokens;

  const cap = routeByCapabilities({
    resolved: input.resolved,
    taskAnalysis: input.taskAnalysis,
    contextBand: input.contextBand,
    primarySource: input.primarySource,
    userMessage: input.userMessage,
    taskDifficulty: input.taskDifficulty,
    switchDirection: input.switchDirection,
    effectiveInputTokens,
  });

  const routingRecommendation = buildRoutingRecommendation(cap, input.resolved.tier);

  const evidenceIndex = loadDefaultQualityEvidence();
  const qualityResult = executeQualityConstrainedRouting({
    resolved: input.resolved,
    taskAnalysis: input.taskAnalysis,
    capabilityResult: cap,
    switchDirection: input.switchDirection,
    effectiveInputTokens,
    evidence: evidenceIndex,
  });

  const qualityAssurance = buildQualityAssurance(
    qualityResult,
    evidenceIndex,
    DEFAULT_QUALITY_CONSTRAINED_POLICY.minEvidenceSamples,
    input.resolved.provider,
  );

  const effectiveRecommendation = resolveEffectiveRecommendation(
    routingRecommendation,
    qualityAssurance,
    input.resolved.tier,
    input.resolved.modelId,
  );

  const explanation = [
    routingRecommendation.explanation,
    qualityAssurance.result.explanation,
    `Effective: ${effectiveRecommendation.routingConfidenceNote}`,
  ].join(" ");

  return {
    routingRecommendation,
    qualityAssurance,
    effectiveRecommendation,
    capableTier: cap.capableTier,
    legacyTier: cap.legacyTier,
    recommendedTier: effectiveRecommendation.tier,
    recommendedModelId: effectiveRecommendation.modelId,
    currentMeetsTask: cap.currentMeetsTask,
    explanation,
    capabilityRoute: cap,
    qualityConstrained: qualityResult,
  };
}

/** @deprecated Tier-level catalog; Phase 2 routing uses `loadDefaultModelProfiles()`. */
export function loadRoutingCapabilities(override?: Partial<CapabilityCatalog>): CapabilityCatalog {
  return mergeCapabilities(loadDefaultCapabilities(), override);
}
