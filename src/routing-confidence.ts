import type { RoutingDecision } from "./router.js";
import type { TaskAnalysis } from "./task-analyzer.js";
import type { ResolvedModel } from "./catalog.js";
import {
  assessRoutingUncertainty,
  type ClarificationRequest,
  type ConfidenceDimensions,
  type RoutingState,
  type RoutingUncertaintyConfig,
} from "./routing-uncertainty.js";
import type { CapabilityTier, Confidence, ContextBand, ContextProbe } from "./types.js";

const TIER_RANK: Record<CapabilityTier, number> = {
  fast: 0,
  balanced: 1,
  premium: 2,
};

export interface RoutingConfidenceInput {
  resolved: ResolvedModel;
  routing: RoutingDecision;
  taskAnalysis: TaskAnalysis;
  userMessage: string;
  contextBand: ContextBand;
  estimatedInputTokens: number;
  effectiveInputTokens?: number;
  probes?: ContextProbe[];
  switchDirection: "downgrade" | "upgrade";
  config?: RoutingUncertaintyConfig;
}

export interface RoutingConfidenceResult {
  /** Legacy aggregate (min of routing + task understanding dimensions). */
  confidence: Confidence;
  suggestSwitch: boolean;
  noOpReason?: string;
  state: RoutingState;
  dimensions: ConfidenceDimensions;
  lowConfidenceReasons: string[];
  clarification: ClarificationRequest;
  capabilityInsufficient: boolean;
}

/**
 * Phase 3: multi-dimensional uncertainty before suggesting a model switch.
 * Routing confidence is not derived from context size alone.
 */
export function evaluateRoutingConfidence(
  input: RoutingConfidenceInput,
): RoutingConfidenceResult {
  const assessment = assessRoutingUncertainty({
    resolved: input.resolved,
    routing: input.routing,
    taskAnalysis: input.taskAnalysis,
    userMessage: input.userMessage,
    contextBand: input.contextBand,
    estimatedInputTokens: input.estimatedInputTokens,
    effectiveInputTokens: input.effectiveInputTokens ?? input.estimatedInputTokens,
    probes: input.probes ?? [],
    switchDirection: input.switchDirection,
    config: input.config,
  });

  let { suggestSwitch, noOpReason, confidence } = assessment;

  const current = input.resolved.tier;
  const recommended = input.routing.recommendedTier;
  const tierSteps = Math.abs(TIER_RANK[current] - TIER_RANK[recommended]);

  if (
    suggestSwitch &&
    assessment.state === "confident" &&
    input.switchDirection === "downgrade" &&
    tierSteps >= 2 &&
    assessment.dimensions.context === "low" &&
    taskClassIsAmbiguous(input.taskAnalysis)
  ) {
    suggestSwitch = false;
    noOpReason = "two-tier downgrade with low context understanding confidence";
  }

  if (
    suggestSwitch &&
    input.switchDirection === "upgrade" &&
    input.routing.currentMeetsTask &&
    tierSteps === 1 &&
    assessment.dimensions.capabilityMatching === "low"
  ) {
    suggestSwitch = false;
    noOpReason = "current model profile already covers task (weak capability-match signal)";
  }

  return {
    confidence,
    suggestSwitch,
    noOpReason,
    state: assessment.state,
    dimensions: assessment.dimensions,
    lowConfidenceReasons: assessment.lowConfidenceReasons,
    clarification: assessment.clarification,
    capabilityInsufficient: assessment.capabilityInsufficient,
  };
}

function taskClassIsAmbiguous(taskAnalysis: TaskAnalysis): boolean {
  return taskAnalysis.taskDifficulty === 2 || taskAnalysis.flags.wantsThoroughReview;
}
