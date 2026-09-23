import {
  buildDowngradeRationale,
  buildScopedIngestPlan,
  buildUpgradeRationale,
  classifyTask,
  inferPrimarySource,
  needsPremiumUpgrade,
  pickDowngradeTier,
  pickUpgradeTier,
  scoreIngestComplexity,
  scoreTaskDifficulty,
  summarizeTask,
} from "./classify.js";
import {
  defaultModelForTier,
  loadDefaultCatalog,
  mergeCatalog,
  resolveModel,
  tierToLegacyAnthropicTier,
} from "./catalog.js";
import { buildSwitchCostEstimate, formatSavingsLine } from "./cost.js";
import { estimateTotalTokens, resolveContextBand } from "./estimate.js";
import {
  contextReductionPercent,
  estimateEffectiveInputTokens,
  formatScopedIngestHint,
  requiresScopedIngest,
} from "./ingest-scope.js";
import type {
  CapabilityTier,
  Confidence,
  ContextOptimization,
  ContextBand,
  GateDecision,
  GateInput,
  SuggestModelSwitchInput,
  TaskClass,
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
  taskDifficulty: number,
): boolean {
  if (taskClass !== "complex") return false;
  if (tier === "premium") return false;
  if (tier === "fast") return true;
  return needsPremiumUpgrade(userMessage, band, taskDifficulty);
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
  const recommendedModelId = defaultModelForTier(
    resolved.provider,
    recommendedTier,
    catalog,
  );

  const opt = base.contextOptimization;
  const cost = buildSwitchCostEstimate({
    currentModelId: input.currentModel,
    recommendedModelId,
    provider: resolved.provider,
    currentTier: resolved.tier,
    recommendedTier,
    inputTokens: base.estimatedInputTokens,
    taskClass: base.taskClass,
  });

  let scopedCostFields: Partial<SuggestModelSwitchInput> = {};
  if (opt.required && opt.effectiveInputTokens < base.estimatedInputTokens) {
    const scopedCurrent = buildSwitchCostEstimate({
      currentModelId: input.currentModel,
      recommendedModelId: input.currentModel,
      provider: resolved.provider,
      currentTier: resolved.tier,
      recommendedTier: resolved.tier,
      inputTokens: opt.effectiveInputTokens,
      taskClass: base.taskClass,
    });
    const scopedRecommended = buildSwitchCostEstimate({
      currentModelId: input.currentModel,
      recommendedModelId,
      provider: resolved.provider,
      currentTier: resolved.tier,
      recommendedTier,
      inputTokens: opt.effectiveInputTokens,
      taskClass: base.taskClass,
    });
    scopedCostFields = {
      estimated_effective_input_tokens: opt.effectiveInputTokens,
      estimated_cost_current_if_scoped_usd: scopedCurrent.estimated_cost_current_usd,
      estimated_cost_recommended_if_scoped_usd:
        scopedRecommended.estimated_cost_recommended_usd,
    };
  }

  return {
    current_model: input.currentModel,
    provider: resolved.provider,
    current_capability_tier: resolved.tier,
    recommended_capability_tier: recommendedTier,
    recommended_model_id: recommendedModelId,
    recommended_model: tierToLegacyAnthropicTier(recommendedTier),
    switch_direction: direction,
    task_summary: summarizeTask(input.userMessage),
    task_class: base.taskClass,
    context_source: base.primarySource,
    context_refs: refs.length ? refs : undefined,
    estimated_input_tokens: base.estimatedInputTokens,
    context_band: base.contextBand,
    confidence,
    rationale:
      rationale +
      formatSavingsLine(cost) +
      formatScopedIngestHint(
        opt.rawInputTokens,
        opt.effectiveInputTokens,
        opt.reductionPercent,
      ),
    scoped_ingest_plan: opt.plan,
    auto_switch: input.autoSwitchEnabled ?? false,
    preserve_context: true,
    ...cost,
    ...scopedCostFields,
  };
}

function buildContextOptimization(
  probes: GateInput["probes"],
  primarySource: GateDecision["primarySource"],
  taskClass: TaskClass,
  contextBand: ContextBand,
  rawTokens: number,
): ContextOptimization {
  const refs = (probes ?? []).flatMap((p) => p.refs ?? []);
  const plan = buildScopedIngestPlan(primarySource, refs);
  const required = requiresScopedIngest(probes ?? [], contextBand, rawTokens);
  const effectiveInputTokens = estimateEffectiveInputTokens(
    rawTokens,
    primarySource,
    taskClass,
  );
  return {
    required,
    plan,
    rawInputTokens: rawTokens,
    effectiveInputTokens,
    reductionPercent: contextReductionPercent(rawTokens, effectiveInputTokens),
  };
}

export function evaluateGate(input: GateInput): GateDecision {
  const catalog = mergeCatalog(loadDefaultCatalog(), input.catalog);
  const resolved = resolveModel(input.currentModel, catalog, input.provider);
  const probes = input.probes ?? [];
  const taskDifficulty = scoreTaskDifficulty(input.userMessage);
  const taskClass = classifyTask(input.userMessage);
  const estimatedInputTokens = estimateTotalTokens(probes);
  const contextBand = resolveContextBand(probes, estimatedInputTokens);
  const ingestComplexity = scoreIngestComplexity(contextBand, estimatedInputTokens);
  const primarySource = inferPrimarySource(probes);
  const contextOptimization = buildContextOptimization(
    probes,
    primarySource,
    taskClass,
    contextBand,
    estimatedInputTokens,
  );

  const base = {
    estimatedInputTokens,
    contextBand,
    taskClass,
    scores: { taskDifficulty, ingestComplexity },
    contextOptimization,
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
    if (
      !shouldUpgrade(
        resolved.tier,
        taskClass,
        contextBand,
        input.userMessage,
        taskDifficulty,
      )
    ) {
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
      taskDifficulty,
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
