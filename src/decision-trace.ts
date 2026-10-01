import { tierDisplayName } from "./catalog.js";
import { classifyRoutingDecision } from "./router-benchmark.js";
import type { CapabilityTier, GateDecision, Provider } from "./types.js";

export type TraceDecisionLabel =
  | "DOWNGRADE"
  | "UPGRADE"
  | "KEEP_CURRENT_MODEL"
  | "ABSTAIN"
  | "OPT_OUT"
  | "SKIP_UNKNOWN_MODEL";

export interface DecisionTraceModel {
  modelId: string;
  tier: CapabilityTier;
  displayName: string;
}

export interface DecisionTraceQualityEvidence {
  status: "available" | "insufficient" | "not_applicable" | "unknown";
  guaranteeLevel?: string;
  effectiveBasis?: string;
  summary: string;
}

export interface DecisionTraceCost {
  currentUsd: number;
  recommendedUsd: number;
  savingsUsd?: number;
  savingsPercent?: number;
}

export interface DecisionTrace {
  label: TraceDecisionLabel;
  /** Single-line headline, e.g. `DOWNGRADE → Claude Haiku (claude-haiku-4-5)`. */
  headline: string;
  currentModel: DecisionTraceModel;
  recommendedModel?: DecisionTraceModel;
  task: {
    category: string;
    taskClass: GateDecision["taskClass"];
    intent?: string;
  };
  context: {
    estimatedInputTokens: number;
    effectiveInputTokens: number;
    band: GateDecision["contextBand"];
    primarySource: GateDecision["primarySource"];
  };
  requiredCapabilities: string[];
  qualityEvidence: DecisionTraceQualityEvidence;
  cost?: DecisionTraceCost;
  why: string[];
  /** Mirrors gate `reason` for auditability. */
  gateReason: string;
  routingOutcome: ReturnType<typeof classifyRoutingDecision>;
}

function humanCategory(decision: GateDecision): string {
  const cat = decision.taskAnalysis?.category ?? decision.taskContract?.taskType;
  if (cat) return String(cat).replace(/_/g, " ");
  return decision.taskClass === "complex" ? "complex task" : "straightforward task";
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `~${(n / 1_000_000).toFixed(1)}M tokens`;
  if (n >= 1000) return `~${Math.round(n / 1000)}k tokens`;
  return `~${n} tokens`;
}

function modelTrace(modelId: string, tier: CapabilityTier, provider: Provider): DecisionTraceModel {
  return {
    modelId,
    tier,
    displayName: tierDisplayName(tier, provider),
  };
}

function currentModelFromDecision(decision: GateDecision): DecisionTraceModel {
  if (decision.suggestSwitch) {
    const sw = decision.suggestSwitch;
    return modelTrace(sw.current_model, sw.current_capability_tier, sw.provider);
  }
  const profile = decision.capabilityProfile;
  if (profile) {
    return modelTrace(profile.modelId, profile.tier, profile.provider);
  }
  const resolved = decision.resolvedModel;
  return modelTrace(
    "unknown",
    resolved?.tier ?? "premium",
    resolved?.provider ?? "anthropic",
  );
}

function requiredCapabilityLabels(decision: GateDecision): string[] {
  const out = new Set<string>();
  const cat = decision.taskAnalysis?.category;
  if (cat) out.add(String(cat).replace(/_/g, " "));
  if (decision.taskClass === "complex") out.add("complex reasoning");
  if (decision.contextBand === "large" || decision.estimatedInputTokens >= 80_000) {
    out.add("long-context");
  }
  const req = decision.taskContract?.requirements;
  if (req) {
    for (const [axis, level] of Object.entries(req)) {
      if (typeof level === "number" && level >= 3) out.add(axis.replace(/_/g, " "));
    }
  }
  const intents = decision.taskAnalysis?.intents;
  const primaryIntent = intents?.[0];
  if (primaryIntent && primaryIntent !== "other") out.add(primaryIntent);
  return [...out];
}

function qualityEvidenceBlock(decision: GateDecision): DecisionTraceQualityEvidence {
  const qa = decision.routing?.qualityAssurance;
  if (!qa) {
    return { status: "not_applicable", summary: "not evaluated (no routing layer on this path)" };
  }
  const level = qa.guarantee.level;
  const basis = decision.routing?.effectiveRecommendation?.basis;
  if (level === "abstain") {
    return {
      status: "insufficient",
      guaranteeLevel: level,
      effectiveBasis: basis,
      summary: "insufficient — safe downgrade/upgrade not established",
    };
  }
  if (level === "probabilistic") {
    return {
      status: "available",
      guaranteeLevel: level,
      effectiveBasis: basis,
      summary: "available — configured quality floor satisfied (probabilistic, not deterministic)",
    };
  }
  return {
    status: "unknown",
    guaranteeLevel: level,
    effectiveBasis: basis,
    summary: qa.guarantee.statement.slice(0, 120),
  };
}

function resolveLabel(decision: GateDecision): TraceDecisionLabel {
  if (decision.reason.includes("opted out")) return "OPT_OUT";
  if (decision.reason.includes("unknown model")) return "SKIP_UNKNOWN_MODEL";
  if (decision.action === "suggest_switch" && decision.suggestSwitch) {
    return decision.suggestSwitch.switch_direction === "upgrade" ? "UPGRADE" : "DOWNGRADE";
  }
  if (classifyRoutingDecision(decision) === "abstain") return "ABSTAIN";
  return "KEEP_CURRENT_MODEL";
}

function buildWhy(decision: GateDecision, label: TraceDecisionLabel): string[] {
  const bullets: string[] = [];
  const routing = decision.routing;
  const rc = decision.routingConfidence;

  if (label === "OPT_OUT") {
    bullets.push("User opted out of model switching for this session");
    return bullets;
  }
  if (label === "SKIP_UNKNOWN_MODEL") {
    bullets.push("Current model is not in the catalog — gate skips switching");
    return bullets;
  }

  if (label === "DOWNGRADE" || label === "UPGRADE") {
    if (routing?.currentMeetsTask === false) {
      bullets.push("Current tier does not fully meet inferred task capability needs");
    } else if (routing?.currentMeetsTask) {
      bullets.push("Required capabilities are supported on the recommended tier");
    }
    if (decision.contextOptimization.effectiveInputTokens > 0) {
      bullets.push(
        `Context (${formatTokenCount(decision.contextOptimization.effectiveInputTokens)}) fits the routing band (${decision.contextBand})`,
      );
    }
    const q = qualityEvidenceBlock(decision);
    if (q.status === "available") {
      bullets.push("Quality evidence satisfies configured floor for this success spec");
    } else if (q.status === "insufficient") {
      bullets.push("Quality assurance did not certify the switch — see ABSTAIN path");
    }
    if (label === "DOWNGRADE") {
      bullets.push("Lower-cost capable model selected under quality-constrained policy");
    } else {
      bullets.push("Higher capability tier required for task class and requirements");
    }
    if (rc?.suggestSwitch && rc.confidence) {
      bullets.push(`Routing confidence: ${rc.confidence}`);
    }
    return bullets;
  }

  if (label === "ABSTAIN") {
    if (decision.routing?.qualityAssurance?.guarantee.level === "abstain") {
      bullets.push("Insufficient evidence to safely change model");
    }
    if (rc?.noOpReason) bullets.push(rc.noOpReason);
    else if (decision.reason.includes("no-op")) {
      const inner = decision.reason.match(/no-op \(([^)]+)\)/)?.[1];
      if (inner) bullets.push(inner);
    }
    if (rc?.clarification.needed && rc.clarification.summary) {
      bullets.push(rc.clarification.summary);
    }
    if (bullets.length === 0) bullets.push("Insufficient evidence to safely downgrade");
    return bullets;
  }

  // KEEP_CURRENT_MODEL
  if (decision.taskClass === "complex") {
    bullets.push("Task classified as complex — premium/high tier appropriate");
  }
  if (decision.reason.includes("small context")) {
    bullets.push("Context band is small — downgrade path not taken");
  }
  if (decision.reason.includes("straightforward on")) {
    bullets.push("Already on an appropriate tier for a straightforward task");
  }
  if (routing?.qualityAssurance?.guarantee.level === "abstain") {
    bullets.push("Quality evidence is insufficient for a cheaper switch");
    bullets.push("Safe downgrade cannot be established");
  }
  if (decision.reason.includes("stayed-premium")) {
    bullets.push("Router preserves premium for this task profile");
  }
  if (bullets.length === 0) {
    bullets.push(decision.reason.replace(/^cost-gate:\s*/, ""));
  }
  return bullets;
}

function costBlock(decision: GateDecision): DecisionTraceCost | undefined {
  const sw = decision.suggestSwitch;
  if (sw?.estimated_cost_current_usd != null && sw.estimated_cost_recommended_usd != null) {
    return {
      currentUsd: sw.estimated_cost_current_usd,
      recommendedUsd: sw.estimated_cost_recommended_usd,
      savingsUsd: sw.estimated_savings_usd,
      savingsPercent: sw.savings_percent,
    };
  }
  return undefined;
}

function headlineFor(
  label: TraceDecisionLabel,
  recommended?: DecisionTraceModel,
): string {
  switch (label) {
    case "DOWNGRADE":
      return recommended
        ? `DOWNGRADE → ${recommended.displayName} (${recommended.modelId})`
        : "DOWNGRADE";
    case "UPGRADE":
      return recommended
        ? `UPGRADE → ${recommended.displayName} (${recommended.modelId})`
        : "UPGRADE";
    case "ABSTAIN":
      return "ABSTAIN";
    case "OPT_OUT":
      return "KEEP CURRENT MODEL (user opt-out)";
    case "SKIP_UNKNOWN_MODEL":
      return "SKIP (unknown model)";
    default:
      return "KEEP CURRENT MODEL";
  }
}

/** Deterministic trace derived only from `evaluateGate` output — no LLM. */
export function buildDecisionTrace(decision: GateDecision): DecisionTrace {
  const currentModel = currentModelFromDecision(decision);

  let recommended: DecisionTraceModel | undefined;
  if (decision.suggestSwitch) {
    const sw = decision.suggestSwitch;
    recommended = modelTrace(
      sw.recommended_model_id,
      sw.recommended_capability_tier,
      sw.provider,
    );
  }

  const label = resolveLabel(decision);
  const routingOutcome = classifyRoutingDecision(decision);

  return {
    label,
    headline: headlineFor(label, recommended),
    currentModel,
    recommendedModel: recommended,
    task: {
      category: humanCategory(decision),
      taskClass: decision.taskClass,
      intent: decision.taskAnalysis?.intents?.[0],
    },
    context: {
      estimatedInputTokens: decision.estimatedInputTokens,
      effectiveInputTokens: decision.contextOptimization.effectiveInputTokens,
      band: decision.contextBand,
      primarySource: decision.primarySource,
    },
    requiredCapabilities: requiredCapabilityLabels(decision),
    qualityEvidence: qualityEvidenceBlock(decision),
    cost: costBlock(decision),
    why: buildWhy(decision, label),
    gateReason: decision.reason,
    routingOutcome,
  };
}

export function formatDecisionTraceText(trace: DecisionTrace): string {
  const lines: string[] = [
    "MODEL ROUTING DECISION",
    "────────────────────────────",
    "",
    "Current model:",
    `  ${trace.currentModel.displayName} (${trace.currentModel.modelId})`,
    "",
    "Task:",
    `  ${trace.task.category} (${trace.task.taskClass})`,
    "",
    "Context:",
    `  ${formatTokenCount(trace.context.effectiveInputTokens || trace.context.estimatedInputTokens)} (${trace.context.band} band, source: ${trace.context.primarySource})`,
    "",
    "Required capabilities:",
    ...(trace.requiredCapabilities.length
      ? trace.requiredCapabilities.map((c) => `  ${c}`)
      : ["  (none inferred)"]),
    "",
    "Quality evidence:",
    `  ${trace.qualityEvidence.status}`,
  ];
  if (trace.qualityEvidence.status === "available") {
    lines.push("  quality floor: satisfied");
  } else if (trace.qualityEvidence.status === "insufficient") {
    lines.push("  quality floor: not satisfied");
  }
  lines.push(`  (${trace.qualityEvidence.summary})`, "", "Decision:", `  ${trace.headline}`);

  if (trace.cost) {
    lines.push(
      "",
      "Estimated cost:",
      `  $${trace.cost.currentUsd.toFixed(2)} → $${trace.cost.recommendedUsd.toFixed(2)}`,
    );
    if (trace.cost.savingsPercent != null && (trace.cost.savingsUsd ?? 0) > 0) {
      lines.push("", "Estimated reduction:", `  ${trace.cost.savingsPercent}%`);
    }
  }

  lines.push("", "Why:");
  for (const b of trace.why) {
    lines.push(`  • ${b}`);
  }

  return lines.join("\n");
}

/** JSON payload for CLI/API: original gate decision plus additive `decisionTrace`. */
export function gateDecisionWithTrace(decision: GateDecision): GateDecision & {
  decisionTrace: DecisionTrace;
} {
  return { ...decision, decisionTrace: buildDecisionTrace(decision) };
}
