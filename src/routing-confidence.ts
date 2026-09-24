import type { RoutingDecision } from "./router.js";
import type { TaskAnalysis } from "./task-analyzer.js";
import type { ResolvedModel } from "./catalog.js";
import type { CapabilityTier, Confidence, ContextBand } from "./types.js";

const TIER_RANK: Record<CapabilityTier, number> = {
  fast: 0,
  balanced: 1,
  premium: 2,
};

export interface RoutingConfidenceInput {
  resolved: ResolvedModel;
  routing: RoutingDecision;
  taskAnalysis: TaskAnalysis;
  contextBand: ContextBand;
  estimatedInputTokens: number;
  switchDirection: "downgrade" | "upgrade";
}

export interface RoutingConfidenceResult {
  confidence: Confidence;
  /** When false, gate proceeds (no switch) despite tier mismatch heuristics. */
  suggestSwitch: boolean;
  noOpReason?: string;
}

function baseConfidenceFromContext(band: ContextBand, tokens: number): Confidence {
  if (band === "large" && tokens > 0) return "high";
  if (band === "medium" && tokens > 0) return "medium";
  return "low";
}

function capConfidence(current: Confidence, cap: Confidence): Confidence {
  const order: Confidence[] = ["low", "medium", "high"];
  return order[Math.min(order.indexOf(current), order.indexOf(cap))];
}

/**
 * Confidence + safety no-op (#14). Benchmark downgrade/upgrade paths stay unchanged
 * unless signals are genuinely ambiguous (no profile match, mixed intent, weak context).
 */
export function evaluateRoutingConfidence(
  input: RoutingConfidenceInput,
): RoutingConfidenceResult {
  const { routing, resolved, taskAnalysis, contextBand, estimatedInputTokens, switchDirection } =
    input;

  let confidence = baseConfidenceFromContext(contextBand, estimatedInputTokens);
  let suggestSwitch = true;
  let noOpReason: string | undefined;

  const current = resolved.tier;
  const recommended = routing.recommendedTier;

  if (recommended === current) {
    return {
      confidence: "low",
      suggestSwitch: false,
      noOpReason: "already on recommended tier",
    };
  }

  if (routing.capableTier === null) {
    return {
      confidence: "low",
      suggestSwitch: false,
      noOpReason: "no capable tier in profile catalog",
    };
  }

  if (taskAnalysis.flags.mixedIntent) {
    return {
      confidence: "low",
      suggestSwitch: false,
      noOpReason: "mixed straightforward and complex signals",
    };
  }

  if (routing.capableTier !== routing.legacyTier) {
    confidence = capConfidence(confidence, "medium");
  }

  const tierSteps = Math.abs(TIER_RANK[current] - TIER_RANK[recommended]);
  if (
    switchDirection === "downgrade" &&
    tierSteps >= 2 &&
    confidence === "low" &&
    taskClassIsAmbiguous(taskAnalysis)
  ) {
    suggestSwitch = false;
    noOpReason = "two-tier downgrade with low context confidence";
  }

  if (
    switchDirection === "upgrade" &&
    routing.currentMeetsTask &&
    tierSteps === 1 &&
    confidence === "low"
  ) {
    suggestSwitch = false;
    noOpReason = "current model profile already covers task (low upgrade confidence)";
  }

  return { confidence, suggestSwitch, noOpReason };
}

function taskClassIsAmbiguous(taskAnalysis: TaskAnalysis): boolean {
  return taskAnalysis.taskDifficulty === 2 || taskAnalysis.flags.wantsThoroughReview;
}
