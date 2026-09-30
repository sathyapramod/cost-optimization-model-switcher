import type { ResolvedModel } from "./catalog.js";
import {
  loadDefaultCapabilities,
  mergeCapabilities,
  type CapabilityCatalog,
} from "./capabilities.js";
import { routeByCapabilities, type CapabilityRouteResult } from "./capability-router.js";
import type { TaskAnalysis } from "./task-analyzer.js";
import type { CapabilityTier, ContextBand, ContextSource } from "./types.js";

export interface RoutingDecision {
  /** Lowest-cost capable tier among models that meet requirements (null if none). */
  capableTier: CapabilityTier | null;
  /** Tier from v1 pickDowngrade / pickUpgrade heuristics (confidence comparison only). */
  legacyTier: CapabilityTier;
  /** Tier metadata of the recommended model (not the routing decision itself). */
  recommendedTier: CapabilityTier;
  recommendedModelId: string | null;
  currentMeetsTask: boolean;
  explanation: string;
  capabilityRoute?: CapabilityRouteResult;
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

/**
 * Capability-based router (Phase 2): task + context requirements → model profiles → optimize cost/speed.
 */
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

  return {
    capableTier: cap.capableTier,
    legacyTier: cap.legacyTier,
    recommendedTier: cap.recommendedTier,
    recommendedModelId: cap.recommendedModelId,
    currentMeetsTask: cap.currentMeetsTask,
    explanation: cap.explanation,
    capabilityRoute: cap,
  };
}

/** @deprecated Tier-level catalog; Phase 2 routing uses `loadDefaultModelProfiles()`. */
export function loadRoutingCapabilities(override?: Partial<CapabilityCatalog>): CapabilityCatalog {
  return mergeCapabilities(loadDefaultCapabilities(), override);
}
