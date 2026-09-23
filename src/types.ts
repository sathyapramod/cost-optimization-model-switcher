export type Provider = "anthropic" | "openai" | "cursor";

/** Provider-neutral capability tier: premium > balanced > fast */
export type CapabilityTier = "premium" | "balanced" | "fast";

/** @deprecated Use CapabilityTier. Kept for Anthropic tool backward compatibility. */
export type ModelTier = "opus" | "sonnet" | "haiku";

export type ContextBand = "small" | "medium" | "large";

export type TaskClass = "straightforward" | "complex";

export type ContextSource =
  | "github_pr"
  | "jira"
  | "log_file"
  | "database_dump"
  | "csv_export"
  | "json_export"
  | "paste"
  | "other";

export type Confidence = "low" | "medium" | "high";

export type GateAction = "proceed" | "suggest_switch";

export type SwitchDirection = "downgrade" | "upgrade";

export interface ContextProbe {
  source: ContextSource;
  refs?: string[];
  bytes?: number;
  lines?: number;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  issueCount?: number;
}

export interface GateInput {
  currentModel: string;
  userMessage: string;
  probes?: ContextProbe[];
  /** Override auto-detected provider */
  provider?: Provider;
  /** Custom or merged model catalog */
  catalog?: import("./catalog.js").ModelCatalog;
  /** User opted out of switching for this session */
  userOptedOut?: boolean;
  /** User explicitly chose premium tier in the last few turns */
  userChosePremium?: boolean;
  /** @deprecated Use userChosePremium */
  userChoseOpus?: boolean;
  /** User explicitly chose fast/balanced tier in the last few turns */
  userChoseCheapModel?: boolean;
  /** Host allows auto-switch without confirmation */
  autoSwitchEnabled?: boolean;
}

export interface SuggestModelSwitchInput {
  current_model: string;
  provider: Provider;
  current_capability_tier: CapabilityTier;
  recommended_capability_tier: CapabilityTier;
  recommended_model_id: string;
  switch_direction: SwitchDirection;
  /** @deprecated Anthropic alias; use recommended_capability_tier */
  recommended_model?: ModelTier;
  task_summary: string;
  task_class: TaskClass;
  context_source: ContextSource;
  context_refs?: string[];
  estimated_input_tokens: number;
  context_band: ContextBand;
  confidence: Confidence;
  rationale: string;
  scoped_ingest_plan?: string;
  auto_switch?: boolean;
  preserve_context?: boolean;
  /** Heuristic single-turn cost (see catalogs/pricing.json) */
  estimated_output_tokens?: number;
  estimated_cost_current_usd?: number;
  estimated_cost_recommended_usd?: number;
  estimated_savings_usd?: number;
  savings_percent?: number;
  cost_pricing_note?: string;
  estimated_effective_input_tokens?: number;
  estimated_cost_current_if_scoped_usd?: number;
  estimated_cost_recommended_if_scoped_usd?: number;
}

export interface SuggestModelSwitchResult {
  status: "accepted" | "declined" | "unavailable";
  switched_to: string | null;
  message: string;
}

/** 0–5 heuristic scores (see scoreTaskDifficulty / scoreIngestComplexity). */
export interface GateScores {
  taskDifficulty: number;
  ingestComplexity: number;
}

export interface ContextOptimization {
  required: boolean;
  plan: string;
  rawInputTokens: number;
  effectiveInputTokens: number;
  reductionPercent: number;
}

export interface GateDecision {
  action: GateAction;
  reason: string;
  estimatedInputTokens: number;
  contextBand: ContextBand;
  taskClass: TaskClass;
  scores: GateScores;
  contextOptimization: ContextOptimization;
  primarySource: ContextSource;
  resolvedModel?: {
    provider: Provider;
    tier: CapabilityTier;
    matched: boolean;
  };
  suggestSwitch?: SuggestModelSwitchInput;
}
