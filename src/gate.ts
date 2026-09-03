import {
  buildDowngradeRationale,
  buildScopedIngestPlan,
  buildUpgradeRationale,
  classifyTask,
  inferPrimarySource,
  needsPremiumUpgrade,
  pickDowngradeTier,
  pickUpgradeTier,
  summarizeTask,
} from "./classify.js";
import {
  defaultModelForTier,
  loadDefaultCatalog,
  mergeCatalog,
  resolveModel,
  tierToLegacyAnthropicTier,
} from "./catalog.js";
import { estimateTotalTokens, resolveContextBand } from "./estimate.js";
import type {
  CapabilityTier,
  Confidence,
  GateDecision,
  GateInput,
  SuggestModelSwitchInput,
} from "./types.js";

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
  tier: CapabilityTier,
  taskClass: GateDecision["taskClass"],
  band: GateDecision["contextBand"],
  userMessage: string,
): boolean {
  if (taskClass !== "complex") return false;
  if (tier === "premium") return false;
  if (tier === "fast") return true;
  return needsPremiumUpgrade(userMessage, band);
}

function buildSwitchPayload(
  input: GateInput,
  base: Omit<GateDecision, "action" | "reason" | "suggestSwitch">,
  resolved: ReturnType<typeof resolveModel>,
  direction: "downgrade" | "upgrade",
  recommendedTier: CapabilityTier,
  rationale: string,
  confidence: Confidence,
): SuggestModelSwitchInput {
  const catalog = mergeCatalog(loadDefaultCatalog(), input.catalog);
  const refs = (input.probes ?? []).flatMap((p) => p.refs ?? []);

  return {
    current_model: input.currentModel,
    provider: resolved.provider,
    current_capability_tier: resolved.tier,
    recommended_capability_tier: recommendedTier,
    recommended_model_id: defaultModelForTier(resolved.provider, recommendedTier, catalog),
    recommended_model: tierToLegacyAnthropicTier(recommendedTier),
    switch_direction: direction,
    task_summary: summarizeTask(input.userMessage),
    task_class: base.taskClass,
    context_source: base.primarySource,
    context_refs: refs.length ? refs : undefined,
    estimated_input_tokens: base.estimatedInputTokens,
    context_band: base.contextBand,
    confidence,
    rationale,
    scoped_ingest_plan: buildScopedIngestPlan(base.primarySource, refs),
    auto_switch: input.autoSwitchEnabled ?? false,
    preserve_context: true,
  };
}

export function evaluateGate(input: GateInput): GateDecision {
  const catalog = mergeCatalog(loadDefaultCatalog(), input.catalog);
  const resolved = resolveModel(input.currentModel, catalog, input.provider);
  const probes = input.probes ?? [];
  const taskClass = classifyTask(input.userMessage);
  const estimatedInputTokens = estimateTotalTokens(probes);
  const contextBand = resolveContextBand(probes, estimatedInputTokens);
  const primarySource = inferPrimarySource(probes);

  const base = {
    estimatedInputTokens,
    contextBand,
    taskClass,
    primarySource,
    resolvedModel: {
      provider: resolved.provider,
      tier: resolved.tier,
      matched: resolved.matched,
    },
  };

  if (input.userOptedOut) {
    return { action: "proceed", reason: "cost-gate: skipped (user opted out)", ...base };
  }

  const chosePremium = input.userChosePremium ?? input.userChoseOpus ?? false;
  if (resolved.tier === "premium" && chosePremium) {
    return {
      action: "proceed",
      reason: "cost-gate: stayed-premium (user explicit choice)",
      ...base,
    };
  }

  if (
    (resolved.tier === "fast" || resolved.tier === "balanced") &&
    input.userChoseCheapModel
  ) {
    return {
      action: "proceed",
      reason: `cost-gate: stayed-${resolved.tier} (user explicit choice)`,
      ...base,
    };
  }

  if (!resolved.matched) {
    return {
      action: "proceed",
      reason: "cost-gate: skipped (unknown model; add to catalog)",
      ...base,
    };
  }

  if (resolved.tier === "premium") {
    if (!shouldDowngrade(contextBand, taskClass)) {
      const reason =
        taskClass === "complex"
          ? "cost-gate: stayed-premium (complex)"
          : "cost-gate: skipped (small context)";
      return { action: "proceed", reason, ...base };
    }

    const recommendedTier = pickDowngradeTier(input.userMessage, primarySource);
    const confidence = confidenceFor(contextBand, estimatedInputTokens);

    return {
      action: "suggest_switch",
      reason: `cost-gate: downgrade→${recommendedTier}`,
      ...base,
      suggestSwitch: buildSwitchPayload(
        input,
        base,
        resolved,
        "downgrade",
        recommendedTier,
        buildDowngradeRationale(
          resolved.provider,
          recommendedTier,
          estimatedInputTokens,
          taskClass,
        ),
        confidence,
      ),
    };
  }

  if (resolved.tier === "fast" || resolved.tier === "balanced") {
    if (!shouldUpgrade(resolved.tier, taskClass, contextBand, input.userMessage)) {
      const reason =
        taskClass === "straightforward"
          ? `cost-gate: skipped (straightforward on ${resolved.tier})`
          : `cost-gate: stayed-${resolved.tier} (complex but within tier capacity)`;
      return { action: "proceed", reason, ...base };
    }

    const recommendedTier = pickUpgradeTier(
      resolved.tier,
      input.userMessage,
      contextBand,
    );
    const confidence =
      resolved.tier === "fast" && recommendedTier === "balanced"
        ? "high"
        : confidenceFor(contextBand, estimatedInputTokens);

    return {
      action: "suggest_switch",
      reason: `cost-gate: upgrade→${recommendedTier}`,
      ...base,
      suggestSwitch: buildSwitchPayload(
        input,
        base,
        resolved,
        "upgrade",
        recommendedTier,
        buildUpgradeRationale(
          resolved.provider,
          resolved.tier,
          recommendedTier,
          estimatedInputTokens,
        ),
        confidence,
      ),
    };
  }

  return {
    action: "proceed",
    reason: "cost-gate: skipped (unknown tier)",
    ...base,
  };
}
