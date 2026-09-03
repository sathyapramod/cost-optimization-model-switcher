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
  /** User opted out of switching for this session */
  userOptedOut?: boolean;
  /** User explicitly chose Opus in the last few turns */
  userChoseOpus?: boolean;
  /** Host allows auto-switch without confirmation */
  autoSwitchEnabled?: boolean;
}

export interface SuggestModelSwitchInput {
  current_model: string;
  recommended_model: Exclude<ModelTier, "opus">;
  recommended_model_id?: string;
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
}

export interface SuggestModelSwitchResult {
  status: "accepted" | "declined" | "unavailable";
  switched_to: string | null;
  message: string;
}

export interface GateDecision {
  action: GateAction;
  reason: string;
  estimatedInputTokens: number;
  contextBand: ContextBand;
  taskClass: TaskClass;
  primarySource: ContextSource;
  suggestSwitch?: SuggestModelSwitchInput;
}
