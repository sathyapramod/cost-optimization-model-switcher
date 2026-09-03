import {
  buildRationale,
  buildScopedIngestPlan,
  classifyTask,
  defaultModelId,
  inferPrimarySource,
  pickRecommendedModel,
  summarizeTask,
} from "./classify.js";
import {
  estimateTotalTokens,
  normalizeModelTier,
  resolveContextBand,
} from "./estimate.js";
import type { Confidence, GateDecision, GateInput } from "./types.js";

function confidenceFor(band: GateDecision["contextBand"], tokens: number): Confidence {
  if (band === "large" && tokens > 0) return "high";
  if (band === "medium" && tokens > 0) return "medium";
  return "low";
}

function shouldGate(
  band: GateDecision["contextBand"],
  taskClass: GateDecision["taskClass"],
): boolean {
  if (taskClass !== "straightforward") return false;
  if (band === "large") return true;
  if (band === "medium") return true;
  return false;
}

export function evaluateGate(input: GateInput): GateDecision {
  const tier = normalizeModelTier(input.currentModel);
  const probes = input.probes ?? [];
  const taskClass = classifyTask(input.userMessage);
  const estimatedInputTokens = estimateTotalTokens(probes);
  const contextBand = resolveContextBand(probes, estimatedInputTokens);
  const primarySource = inferPrimarySource(probes);
  const refs = probes.flatMap((p) => p.refs ?? []);

  if (input.userOptedOut) {
    return {
      action: "proceed",
      reason: "cost-gate: skipped (user opted out)",
      estimatedInputTokens,
      contextBand,
      taskClass,
      primarySource,
    };
  }

  if (input.userChoseOpus) {
    return {
      action: "proceed",
      reason: "cost-gate: stayed-opus (user explicit choice)",
      estimatedInputTokens,
      contextBand,
      taskClass,
      primarySource,
    };
  }

  if (tier !== "opus") {
    return {
      action: "proceed",
      reason: `cost-gate: skipped (already on ${tier})`,
      estimatedInputTokens,
      contextBand,
      taskClass,
      primarySource,
    };
  }

  if (!shouldGate(contextBand, taskClass)) {
    const reason =
      taskClass === "complex"
        ? "cost-gate: stayed-opus (complex)"
        : "cost-gate: skipped (small context)";
    return {
      action: "proceed",
      reason,
      estimatedInputTokens,
      contextBand,
      taskClass,
      primarySource,
    };
  }

  const recommended = pickRecommendedModel(input.userMessage, primarySource);
  const confidence = confidenceFor(contextBand, estimatedInputTokens);

  return {
    action: "suggest_switch",
    reason: `cost-gate: switch→${recommended}`,
    estimatedInputTokens,
    contextBand,
    taskClass,
    primarySource,
    suggestSwitch: {
      current_model: input.currentModel,
      recommended_model: recommended,
      recommended_model_id: defaultModelId(recommended),
      task_summary: summarizeTask(input.userMessage),
      task_class: taskClass,
      context_source: primarySource,
      context_refs: refs.length ? refs : undefined,
      estimated_input_tokens: estimatedInputTokens,
      context_band: contextBand,
      confidence,
      rationale: buildRationale(recommended, estimatedInputTokens, taskClass),
      scoped_ingest_plan: buildScopedIngestPlan(primarySource, refs),
      auto_switch: input.autoSwitchEnabled ?? false,
      preserve_context: true,
    },
  };
}
