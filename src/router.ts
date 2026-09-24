import type { ResolvedModel } from "./catalog.js";
import {
  currentModelMeetsTask,
  higherTier,
  loadDefaultCapabilities,
  mergeCapabilities,
  selectCapableTier,
  type CapabilityCatalog,
} from "./capabilities.js";
import { pickDowngradeTier, pickUpgradeTier } from "./classify.js";
import type { TaskAnalysis } from "./task-analyzer.js";
import type { CapabilityTier, ContextBand, ContextSource } from "./types.js";

export interface RoutingDecision {
  /** Lowest-cost tier whose profile covers task features (null if none). */
  capableTier: CapabilityTier | null;
  /** Tier from v1 pickDowngrade / pickUpgrade heuristics only. */
  legacyTier: CapabilityTier;
  /** Tier to recommend after merging capability match with legacy heuristics. */
  recommendedTier: CapabilityTier;
  currentMeetsTask: boolean;
}

export interface RouteInput {
  resolved: ResolvedModel;
  taskAnalysis: TaskAnalysis;
  contextBand: ContextBand;
  primarySource: ContextSource;
  userMessage: string;
  taskDifficulty: number;
  switchDirection: "downgrade" | "upgrade";
  capabilities?: CapabilityCatalog;
}

function legacyRecommendedTier(
  input: RouteInput,
): CapabilityTier {
  if (input.switchDirection === "downgrade") {
    return pickDowngradeTier(input.userMessage, input.primarySource);
  }
  const tier = input.resolved.tier;
  if (tier !== "fast" && tier !== "balanced") {
    return pickUpgradeTier("fast", input.userMessage, input.contextBand, input.taskDifficulty);
  }
  return pickUpgradeTier(tier, input.userMessage, input.contextBand, input.taskDifficulty);
}

/**
 * Capability-matching router (#13): `selectCapableTier` + v1 tier heuristics (max rank)
 * so benchmark fixtures and PR-review nuance stay aligned; see routing-confidence (#14).
 */
export function routeForTask(input: RouteInput): RoutingDecision {
  const caps = input.capabilities ?? loadDefaultCapabilities();
  const capableTier = selectCapableTier(
    input.resolved.provider,
    input.taskAnalysis.features,
    input.taskAnalysis.minimumCapability,
    caps,
  );
  const legacyTier = legacyRecommendedTier(input);
  const recommendedTier = capableTier
    ? higherTier(capableTier, legacyTier)
    : legacyTier;

  return {
    capableTier,
    legacyTier,
    recommendedTier,
    currentMeetsTask: currentModelMeetsTask(input.resolved, input.taskAnalysis.features, caps),
  };
}

export function loadRoutingCapabilities(override?: Partial<CapabilityCatalog>): CapabilityCatalog {
  return mergeCapabilities(loadDefaultCapabilities(), override);
}
