import type { ResolvedModel } from "./catalog.js";
import { pickDowngradeTier, pickUpgradeTier } from "./classify.js";
import { filterCapableModels, modelMeetsRequirements } from "./capability-matching.js";
import {
  findModelProfile,
  listProviderModels,
  type CatalogModelProfile,
  type ModelProfileCatalog,
  loadDefaultModelProfiles,
  mergeModelProfiles,
} from "./model-profiles.js";
import {
  extractRoutingRequirements,
  type RoutingRequirements,
} from "./routing-requirements.js";
import type { TaskAnalysis } from "./task-analyzer.js";
import type { CapabilityTier, ContextBand, ContextSource } from "./types.js";

const TIER_RANK: Record<CapabilityTier, number> = {
  fast: 0,
  balanced: 1,
  premium: 2,
};

export interface RoutingPolicy {
  switchDirection: "downgrade" | "upgrade";
  /** Prefer higher `cost` score (more economical) when optimizing. */
  optimizeForCost: boolean;
  /** Prefer higher `speed` when costs tie. */
  optimizeForSpeed: boolean;
}

export interface CapabilityRouteInput {
  resolved: ResolvedModel;
  taskAnalysis: TaskAnalysis;
  contextBand: ContextBand;
  primarySource: ContextSource;
  userMessage: string;
  taskDifficulty: number;
  switchDirection: "downgrade" | "upgrade";
  effectiveInputTokens: number;
  profiles?: ModelProfileCatalog;
  policy?: Partial<RoutingPolicy>;
}

export interface CapabilityRouteResult {
  requirements: RoutingRequirements;
  /** All roster models that meet mandatory capability/context requirements. */
  capableModels: CatalogModelProfile[];
  /** Capable models that also satisfy switch-direction constraints. */
  eligibleModels: CatalogModelProfile[];
  recommended: CatalogModelProfile | null;
  recommendedTier: CapabilityTier;
  recommendedModelId: string | null;
  capableTier: CapabilityTier | null;
  legacyTier: CapabilityTier;
  currentMeetsTask: boolean;
  explanation: string;
}

function defaultPolicy(direction: "downgrade" | "upgrade"): RoutingPolicy {
  return {
    switchDirection: direction,
    optimizeForCost: true,
    optimizeForSpeed: direction === "downgrade",
  };
}

function legacyRecommendedTier(input: CapabilityRouteInput): CapabilityTier {
  if (input.switchDirection === "downgrade") {
    return pickDowngradeTier(input.userMessage, input.primarySource);
  }
  const tier = input.resolved.tier;
  if (tier !== "fast" && tier !== "balanced") {
    return pickUpgradeTier("fast", input.userMessage, input.contextBand, input.taskDifficulty);
  }
  return pickUpgradeTier(tier, input.userMessage, input.contextBand, input.taskDifficulty);
}

function compareCandidates(
  a: CatalogModelProfile,
  b: CatalogModelProfile,
  policy: RoutingPolicy,
): number {
  if (policy.optimizeForCost && a.capabilities.cost !== b.capabilities.cost) {
    return b.capabilities.cost - a.capabilities.cost;
  }
  if (policy.optimizeForSpeed && a.capabilities.speed !== b.capabilities.speed) {
    return b.capabilities.speed - a.capabilities.speed;
  }
  return TIER_RANK[a.tier] - TIER_RANK[b.tier];
}

function filterBySwitchDirection(
  candidates: CatalogModelProfile[],
  currentTier: CapabilityTier,
  direction: "downgrade" | "upgrade",
): CatalogModelProfile[] {
  const currentRank = TIER_RANK[currentTier];
  if (direction === "downgrade") {
    return candidates.filter((m) => TIER_RANK[m.tier] < currentRank);
  }
  return candidates.filter((m) => TIER_RANK[m.tier] > currentRank);
}

function pickOptimal(
  candidates: CatalogModelProfile[],
  policy: RoutingPolicy,
): CatalogModelProfile | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => compareCandidates(a, b, policy));
  return sorted[0] ?? null;
}

function buildExplanation(
  requirements: RoutingRequirements,
  eligible: CatalogModelProfile[],
  recommended: CatalogModelProfile | null,
  current: CatalogModelProfile | undefined,
  direction: "downgrade" | "upgrade",
): string {
  if (!recommended) {
    return `No ${direction} candidate satisfies mandatory task/context requirements.`;
  }
  const axes = Object.entries(requirements.task)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}≥${v}`)
    .join(", ");
  const ctx = `context≥${requirements.context.contextCapability}`;
  const currentLabel = current?.modelId ?? "current model";
  return (
    `Capability match (${direction}): ${eligible.length} eligible model(s) for [${axes}; ${ctx}]. ` +
    `Selected ${recommended.modelId} (tier=${recommended.tier} metadata) over ${currentLabel} ` +
    `by cost/speed policy — profiles are curated, not objective scores.`
  );
}

/**
 * Phase 2 router: requirements + context → capable models → cost/speed optimization.
 * Tier labels on models are compatibility metadata only.
 */
export function routeByCapabilities(input: CapabilityRouteInput): CapabilityRouteResult {
  const profiles = mergeModelProfiles(loadDefaultModelProfiles(), input.profiles);
  const requirements = extractRoutingRequirements(
    input.taskAnalysis,
    input.effectiveInputTokens,
  );
  const policy = { ...defaultPolicy(input.switchDirection), ...input.policy };

  const roster = listProviderModels(input.resolved.provider, profiles);
  const capable = filterCapableModels(roster, requirements);
  const currentProfile = findModelProfile(
    input.resolved.modelId,
    input.resolved.provider,
    profiles,
  );
  const currentMeetsTask =
    currentProfile != null &&
    modelMeetsRequirements(currentProfile, requirements).meetsMandatory;

  let eligible = capable;
  if (input.switchDirection === "downgrade") {
    eligible = filterBySwitchDirection(capable, input.resolved.tier, "downgrade");
  } else if (currentMeetsTask) {
    eligible = [];
  } else {
    eligible = filterBySwitchDirection(capable, input.resolved.tier, "upgrade");
  }

  const recommended = pickOptimal(eligible, policy);
  const legacyTier = legacyRecommendedTier(input);

  const capableTier = capable.length
    ? capable.reduce((best, m) =>
        TIER_RANK[m.tier] < TIER_RANK[best.tier] ? m : best,
      ).tier
    : null;

  const recommendedTier = recommended?.tier ?? input.resolved.tier;
  const explanation = buildExplanation(
    requirements,
    eligible,
    recommended,
    currentProfile,
    input.switchDirection,
  );

  return {
    requirements,
    capableModels: capable,
    eligibleModels: eligible,
    recommended,
    recommendedTier,
    recommendedModelId: recommended?.modelId ?? null,
    capableTier,
    legacyTier,
    currentMeetsTask,
    explanation,
  };
}
