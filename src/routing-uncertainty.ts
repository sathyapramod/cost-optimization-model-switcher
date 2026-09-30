import type { RoutingDecision } from "./router.js";
import type { TaskAnalysis } from "./task-analyzer.js";
import type { ResolvedModel } from "./catalog.js";
import { isUnderspecifiedUserMessage } from "./task-contract.js";
import type { Confidence, ContextBand, ContextProbe } from "./types.js";

export type RoutingState =
  | "confident"
  | "uncertain"
  | "ambiguous"
  | "insufficient_information";

export interface ConfidenceDimensions {
  taskUnderstanding: Confidence;
  context: Confidence;
  capabilityMatching: Confidence;
  routing: Confidence;
}

export interface ClarificationRequest {
  needed: boolean;
  summary: string;
  questions: string[];
}

export interface RoutingUncertaintyConfig {
  /** Minimum routing dimension confidence to suggest a switch (unless capability gap is clear). */
  minRoutingConfidenceToSwitch: Confidence;
}

export const DEFAULT_ROUTING_UNCERTAINTY_CONFIG: RoutingUncertaintyConfig = {
  minRoutingConfidenceToSwitch: "medium",
};

export interface RoutingUncertaintyInput {
  resolved: ResolvedModel;
  routing: RoutingDecision;
  taskAnalysis: TaskAnalysis;
  userMessage: string;
  contextBand: ContextBand;
  estimatedInputTokens: number;
  effectiveInputTokens: number;
  probes: ContextProbe[];
  switchDirection: "downgrade" | "upgrade";
  config?: RoutingUncertaintyConfig;
}

export interface RoutingUncertaintyAssessment {
  state: RoutingState;
  dimensions: ConfidenceDimensions;
  lowConfidenceReasons: string[];
  clarification: ClarificationRequest;
  /** Current model clearly fails mandatory capability requirements (non-vague tasks). */
  capabilityInsufficient: boolean;
  /** Legacy aggregate for tool schema / suggestSwitch payloads. */
  confidence: Confidence;
  suggestSwitch: boolean;
  noOpReason?: string;
}

const CONF_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

function rank(c: Confidence): number {
  return CONF_RANK[c];
}

function minConfidence(a: Confidence, b: Confidence): Confidence {
  return rank(a) <= rank(b) ? a : b;
}

function scoreToConfidence(score: number): Confidence {
  if (score >= 0.67) return "high";
  if (score >= 0.34) return "medium";
  return "low";
}

function isAmbiguousIntent(analysis: TaskAnalysis): boolean {
  if (analysis.flags.mixedIntent) return true;
  if (analysis.intents.length === 1 && analysis.intents[0] === "other") return true;
  if (analysis.contract.confidence.ambiguities.length >= 2) return true;
  return false;
}

function assessTaskUnderstanding(
  userMessage: string,
  analysis: TaskAnalysis,
): { confidence: Confidence; reasons: string[]; underspecified: boolean; ambiguous: boolean } {
  const reasons: string[] = [];
  const underspecified = isUnderspecifiedUserMessage(userMessage, analysis);
  const ambiguous = isAmbiguousIntent(analysis) || underspecified;

  if (underspecified) {
    reasons.push("task prompt is too short or underspecified to infer intent");
  }
  if (analysis.flags.mixedIntent) {
    reasons.push("mixed straightforward and complex intent signals");
  }
  if (analysis.intents.length === 1 && analysis.intents[0] === "other") {
    reasons.push("no strong task-intent keywords detected");
  }
  for (const a of analysis.contract.confidence.ambiguities) {
    reasons.push(a);
  }

  let confidence = analysis.contract.confidence.overall;
  if (underspecified) confidence = "low";
  if (ambiguous && confidence === "high") confidence = "medium";

  return { confidence, reasons, underspecified, ambiguous };
}

function assessContextConfidence(
  probes: ContextProbe[],
  contextBand: ContextBand,
  userMessage: string,
  taskUnderstanding: Confidence,
): { confidence: Confidence; reasons: string[] } {
  const reasons: string[] = [];
  const text = userMessage.toLowerCase();

  const referencesContext =
    /\b(this|attached|above|log|pr|diff|dump|file|paste)\b/i.test(text) || probes.length > 0;

  if (probes.length === 0 && /\b(this|attached|the file)\b/i.test(text)) {
    reasons.push("message references context but no probes were provided");
  }

  if (probes.length > 0 && estimatedProbeQuality(probes)) {
    reasons.push(...estimatedProbeQuality(probes)!);
  }

  let score = 0.5;
  if (probes.length > 0) score += 0.25;
  if (contextBand === "large" || contextBand === "medium") score += 0.15;
  if (!referencesContext && probes.length === 0) {
    score -= 0.2;
    reasons.push("no external context attached and message does not scope inputs");
  }
  if (taskUnderstanding === "low") score -= 0.15;

  return { confidence: scoreToConfidence(score), reasons };
}

function estimatedProbeQuality(probes: ContextProbe[]): string[] | null {
  const issues: string[] = [];
  for (const p of probes) {
    if (p.source === "other" && !p.bytes && !p.lines) {
      issues.push("probe present but size/metadata is missing");
    }
  }
  return issues.length ? issues : null;
}

function assessCapabilityMatchingConfidence(
  routing: RoutingDecision,
): { confidence: Confidence; reasons: string[] } {
  const reasons: string[] = [];
  const eligible = routing.capabilityRoute?.eligibleModels ?? [];

  if (routing.capableTier === null) {
    return { confidence: "low", reasons: ["no model in catalog satisfies mandatory requirements"] };
  }

  if (!routing.recommendedModelId) {
    reasons.push("no eligible model for the requested switch direction");
    return { confidence: "low", reasons };
  }

  if (eligible.length === 1) {
    return { confidence: "high", reasons };
  }

  if (eligible.length >= 2) {
    reasons.push("multiple models satisfy requirements; selection depends on cost policy");
    return { confidence: "medium", reasons };
  }

  return { confidence: "medium", reasons };
}

function deriveRoutingState(
  task: ReturnType<typeof assessTaskUnderstanding>,
  dimensions: ConfidenceDimensions,
): RoutingState {
  if (task.underspecified) return "insufficient_information";
  if (task.ambiguous) return "ambiguous";
  if (rank(dimensions.routing) === 0) return "uncertain";
  if (rank(dimensions.routing) >= 2 && rank(dimensions.taskUnderstanding) >= 2) return "confident";
  if (rank(dimensions.routing) >= 1) return "uncertain";
  return "uncertain";
}

function buildClarification(
  userMessage: string,
  task: ReturnType<typeof assessTaskUnderstanding>,
  state: RoutingState,
): ClarificationRequest {
  if (state !== "ambiguous" && state !== "insufficient_information") {
    return { needed: false, summary: "", questions: [] };
  }

  const analyzeLike = /analy[sz]e/i.test(userMessage);
  const questions: string[] = [];

  if (analyzeLike || task.underspecified) {
    questions.push("What should be analyzed (CI log, PR diff, metrics, architecture, code)?");
    questions.push("Is the goal summarization, root-cause debugging, quantitative analysis, or design review?");
  } else if (task.ambiguous) {
    questions.push("What is the primary deliverable you need in this turn?");
    questions.push("Should the agent prioritize speed/cost or maximum reasoning depth?");
  }

  const summary =
    state === "insufficient_information"
      ? "Task intent is underspecified; the router cannot confidently map requirements to model capabilities."
      : "Task intent is ambiguous; the router will not aggressively recommend a model switch.";

  return {
    needed: true,
    summary,
    questions,
  };
}

function aggregateRoutingConfidence(dimensions: ConfidenceDimensions): Confidence {
  const min = Math.min(
    rank(dimensions.taskUnderstanding),
    rank(dimensions.context),
    rank(dimensions.capabilityMatching),
  );
  const blended = (rank(dimensions.taskUnderstanding) + rank(dimensions.capabilityMatching)) / 2;
  const capped = Math.min(blended, min + 0.5);
  return scoreToConfidence(capped / 2);
}

function capabilityClearlyInsufficient(
  routing: RoutingDecision,
  task: ReturnType<typeof assessTaskUnderstanding>,
): boolean {
  if (task.underspecified || task.ambiguous) return false;
  if (routing.currentMeetsTask) return false;
  const route = routing.capabilityRoute;
  if (!route?.requirements) return false;

  const failed = route.requirements.task;
  const peak = Math.max(
    failed.reasoning,
    failed.coding,
    failed.architecture,
    failed.domainKnowledge,
    failed.quantitativeReasoning,
  );
  return peak >= 3 && routing.capableTier != null;
}

export function assessRoutingUncertainty(
  input: RoutingUncertaintyInput,
): RoutingUncertaintyAssessment {
  const config = input.config ?? DEFAULT_ROUTING_UNCERTAINTY_CONFIG;
  const task = assessTaskUnderstanding(input.userMessage, input.taskAnalysis);
  const context = assessContextConfidence(
    input.probes,
    input.contextBand,
    input.userMessage,
    task.confidence,
  );
  const capability = assessCapabilityMatchingConfidence(input.routing);

  const lowConfidenceReasons = [
    ...task.reasons,
    ...context.reasons,
    ...capability.reasons,
  ];

  const dimensions: ConfidenceDimensions = {
    taskUnderstanding: task.confidence,
    context: context.confidence,
    capabilityMatching: capability.confidence,
    routing: "low",
  };
  dimensions.routing = aggregateRoutingConfidence(dimensions);

  const state = deriveRoutingState(task, dimensions);
  const clarification = buildClarification(input.userMessage, task, state);
  const capabilityInsufficient = capabilityClearlyInsufficient(input.routing, task);

  const current = input.resolved.tier;
  const recommended = input.routing.recommendedTier;
  let suggestSwitch = true;
  let noOpReason: string | undefined;

  const qualityAbstain =
    input.routing.qualityAssurance?.guarantee.level === "abstain" ||
    input.routing.qualityAssurance?.result.preserveCurrentModel ||
    input.routing.effectiveRecommendation?.basis === "abstain_preserve_current";

  if (qualityAbstain) {
    suggestSwitch = false;
    noOpReason =
      input.routing.qualityAssurance?.result.noOpReason ??
      input.routing.qualityAssurance?.guarantee.statement ??
      "quality assurance abstained — preserve current model";
  } else if (!input.routing.recommendedModelId || recommended === current) {
    suggestSwitch = false;
    noOpReason = input.routing.recommendedModelId
      ? "already on recommended model"
      : "no capable model satisfies requirements for this switch direction";
  } else if (input.routing.capableTier === null) {
    suggestSwitch = false;
    noOpReason = "no capable model in profile catalog";
  } else if (state === "ambiguous" || state === "insufficient_information") {
    suggestSwitch = false;
    noOpReason = clarification.summary;
    if (capabilityInsufficient && input.switchDirection === "upgrade") {
      suggestSwitch = true;
      noOpReason = undefined;
    }
  } else if (rank(dimensions.routing) < rank(config.minRoutingConfidenceToSwitch)) {
    if (capabilityInsufficient && input.switchDirection === "upgrade") {
      suggestSwitch = true;
    } else {
      suggestSwitch = false;
      noOpReason = `routing confidence below threshold (${dimensions.routing} < ${config.minRoutingConfidenceToSwitch})`;
    }
  }

  if (suggestSwitch && task.ambiguous && input.switchDirection === "downgrade") {
    suggestSwitch = false;
    noOpReason = "ambiguous task intent — conservative no-op on downgrade";
  }

  const confidence = minConfidence(dimensions.routing, dimensions.taskUnderstanding);

  return {
    state,
    dimensions,
    lowConfidenceReasons: [...new Set(lowConfidenceReasons)],
    clarification,
    capabilityInsufficient,
    confidence,
    suggestSwitch,
    noOpReason,
  };
}
