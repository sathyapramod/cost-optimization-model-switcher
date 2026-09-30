import type { TaskRequirements } from "./task-contract.js";
import type { TaskAnalysis } from "./task-analyzer.js";
import type { ContextBand } from "./types.js";

export interface ContextRequirements {
  contextUnderstanding: number;
  estimatedInputTokens: number;
  effectiveInputTokens: number;
  contextBand: ContextBand;
  /** Minimum `context` capability on candidate models (0–5). */
  contextCapability: number;
}

export interface RoutingRequirements {
  task: TaskRequirements;
  context: ContextRequirements;
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(5, n));
}

function contextCapabilityFromBand(band: ContextBand, effectiveTokens: number): number {
  if (effectiveTokens > 200_000 || band === "large") return 4;
  if (band === "medium") return 3;
  if (effectiveTokens > 0) return 2;
  return 1;
}

/**
 * Task requirements for routing: contract axes enriched with analysis signals
 * (not tier-based floors).
 */
export function extractTaskRoutingRequirements(analysis: TaskAnalysis): TaskRequirements {
  const base = { ...analysis.contract.requirements };

  base.reasoning = Math.max(base.reasoning, analysis.features.reasoningDepth);
  base.coding = Math.max(base.coding, analysis.features.codeChange);
  base.contextUnderstanding = Math.max(
    base.contextUnderstanding,
    analysis.features.contextDependence,
  );
  base.outputComplexity = Math.max(
    base.outputComplexity,
    analysis.flags.wantsThoroughReview ? 3 : 0,
  );

  if (analysis.category === "pr_review") {
    base.reasoning = Math.max(base.reasoning, 3);
    base.outputComplexity = Math.max(base.outputComplexity, 3);
  }

  if (analysis.features.securityDepth >= 4) {
    base.architecture = Math.max(base.architecture, 4);
    base.domainKnowledge = Math.max(base.domainKnowledge, 4);
    base.reasoning = Math.max(base.reasoning, 4);
  }

  if (analysis.flags.deepSignals) {
    base.architecture = Math.max(base.architecture, 4);
    base.reasoning = Math.max(base.reasoning, 4);
  }

  return {
    reasoning: clampScore(base.reasoning),
    coding: clampScore(base.coding),
    architecture: clampScore(base.architecture),
    domainKnowledge: clampScore(base.domainKnowledge),
    quantitativeReasoning: clampScore(base.quantitativeReasoning),
    contextUnderstanding: clampScore(base.contextUnderstanding),
    toolUse: clampScore(base.toolUse),
    outputComplexity: clampScore(base.outputComplexity),
  };
}

export function extractContextRequirements(
  analysis: TaskAnalysis,
  effectiveInputTokens: number,
): ContextRequirements {
  // Window/ingest band uses raw probe size; scoped effective tokens inform cost, not mandatory context≥5.
  const contextCapability = contextCapabilityFromBand(
    analysis.contextBand,
    analysis.estimatedInputTokens,
  );

  return {
    contextUnderstanding: clampScore(analysis.contract.requirements.contextUnderstanding),
    estimatedInputTokens: analysis.estimatedInputTokens,
    effectiveInputTokens,
    contextBand: analysis.contextBand,
    contextCapability: clampScore(contextCapability),
  };
}

export function extractRoutingRequirements(
  analysis: TaskAnalysis,
  effectiveInputTokens: number,
): RoutingRequirements {
  return {
    task: extractTaskRoutingRequirements(analysis),
    context: extractContextRequirements(analysis, effectiveInputTokens),
  };
}
