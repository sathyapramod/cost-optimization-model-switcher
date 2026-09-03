import {
  buildDowngradeRationale,
  buildScopedIngestPlan,
  buildUpgradeRationale,
  classifyTask,
  defaultModelId,
  inferPrimarySource,
  needsOpusUpgrade,
  pickDowngradeModel,
  summarizeTask,
} from "./classify.js";
import {
  estimateTotalTokens,
  normalizeModelTier,
  resolveContextBand,
} from "./estimate.js";
import type { Confidence, GateDecision, GateInput, ModelTier } from "./types.js";

function confidenceFor(band: GateDecision["contextBand"], tokens: number): Confidence {
  if (band === "large" && tokens > 0) return "high";
  if (band === "medium" && tokens > 0) return "medium";
  return "low";
}

function shouldDowngrade(
  band: GateDecision["contextBand"],
  taskClass: GateDecision["taskClass"],
): boolean {
  if (taskClass !== "straightforward") return false;
  return band === "medium" || band === "large";
}

function shouldUpgrade(
  tier: ModelTier,
  taskClass: GateDecision["taskClass"],
  band: GateDecision["contextBand"],
  userMessage: string,
): boolean {
  if (taskClass !== "complex") return false;
  if (tier === "opus") return false;
  if (tier === "haiku") return true;
  return needsOpusUpgrade(userMessage, band);
}

export function evaluateGate(input: GateInput): GateDecision {
  const tier = normalizeModelTier(input.currentModel);
  const probes = input.probes ?? [];
  const taskClass = classifyTask(input.userMessage);
  const estimatedInputTokens = estimateTotalTokens(probes);
  const contextBand = resolveContextBand(probes, estimatedInputTokens);
  const primarySource = inferPrimarySource(probes);
  const refs = probes.flatMap((p) => p.refs ?? []);

  const base = {
    estimatedInputTokens,
    contextBand,
    taskClass,
    primarySource,
  };

  if (input.userOptedOut) {
    return {
      action: "proceed",
      reason: "cost-gate: skipped (user opted out)",
      ...base,
    };
  }

  if (tier === "opus" && input.userChoseOpus) {
    return {
      action: "proceed",
      reason: "cost-gate: stayed-opus (user explicit choice)",
      ...base,
    };
  }

  if ((tier === "haiku" || tier === "sonnet") && input.userChoseCheapModel) {
    return {
      action: "proceed",
      reason: `cost-gate: stayed-${tier} (user explicit choice)`,
      ...base,
    };
  }

  if (tier === "opus") {
    if (!shouldDowngrade(contextBand, taskClass)) {
      const reason =
        taskClass === "complex"
          ? "cost-gate: stayed-opus (complex)"
          : "cost-gate: skipped (small context)";
      return { action: "proceed", reason, ...base };
    }

    const recommended = pickDowngradeModel(input.userMessage, primarySource);
    return {
      action: "suggest_switch",
      reason: `cost-gate: downgrade→${recommended}`,
      ...base,
      suggestSwitch: {
        current_model: input.currentModel,
        recommended_model: recommended,
        recommended_model_id: defaultModelId(recommended),
        switch_direction: "downgrade",
        task_summary: summarizeTask(input.userMessage),
        task_class: taskClass,
        context_source: primarySource,
        context_refs: refs.length ? refs : undefined,
        estimated_input_tokens: estimatedInputTokens,
        context_band: contextBand,
        confidence: confidenceFor(contextBand, estimatedInputTokens),
        rationale: buildDowngradeRationale(recommended, estimatedInputTokens, taskClass),
        scoped_ingest_plan: buildScopedIngestPlan(primarySource, refs),
        auto_switch: input.autoSwitchEnabled ?? false,
        preserve_context: true,
      },
    };
  }

  if (tier === "haiku" || tier === "sonnet") {
    if (!shouldUpgrade(tier, taskClass, contextBand, input.userMessage)) {
      const reason =
        taskClass === "straightforward"
          ? `cost-gate: skipped (straightforward on ${tier})`
          : `cost-gate: stayed-${tier} (complex but within tier capacity)`;
      return { action: "proceed", reason, ...base };
    }

    return {
      action: "suggest_switch",
      reason: "cost-gate: upgrade→opus",
      ...base,
      suggestSwitch: {
        current_model: input.currentModel,
        recommended_model: "opus",
        recommended_model_id: defaultModelId("opus"),
        switch_direction: "upgrade",
        task_summary: summarizeTask(input.userMessage),
        task_class: taskClass,
        context_source: primarySource,
        context_refs: refs.length ? refs : undefined,
        estimated_input_tokens: estimatedInputTokens,
        context_band: contextBand,
        confidence: tier === "haiku" ? "high" : confidenceFor(contextBand, estimatedInputTokens),
        rationale: buildUpgradeRationale(tier, estimatedInputTokens),
        scoped_ingest_plan: buildScopedIngestPlan(primarySource, refs),
        auto_switch: input.autoSwitchEnabled ?? false,
        preserve_context: true,
      },
    };
  }

  return {
    action: "proceed",
    reason: "cost-gate: skipped (unknown model tier)",
    ...base,
  };
}
