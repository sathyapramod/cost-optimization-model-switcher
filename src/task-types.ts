import type {
  CapabilityTier,
  ContextBand,
  ContextSource,
  TaskClass,
} from "./types.js";

/** Aligns with `benchmarks/fixtures.json` categories for evaluation (#15–#16). */
export type TaskCategory =
  | "summarization"
  | "pr_review"
  | "crud_implementation"
  | "architecture"
  | "debugging"
  | "security"
  | "refactor"
  | "other";

export type TaskIntent =
  | "summarize"
  | "extract"
  | "format"
  | "review"
  | "implement"
  | "debug"
  | "refactor"
  | "architect"
  | "security"
  | "other";

/** 0–5 capability needs used by the V2 router (#13); independent of current model tier. */
export interface TaskFeatureVector {
  reasoningDepth: number;
  codeChange: number;
  securityDepth: number;
  bulkTextProcessing: number;
  contextDependence: number;
}

export interface TaskAnalysisFlags {
  deepSignals: boolean;
  mixedIntent: boolean;
  wantsThoroughReview: boolean;
}

export interface TaskAnalysisCore {
  intents: TaskIntent[];
  category: TaskCategory;
  taskClass: TaskClass;
  /** Heuristic regex score — not ground-truth complexity. */
  taskDifficulty: number;
  ingestComplexity: number;
  contextBand: ContextBand;
  estimatedInputTokens: number;
  primarySource: ContextSource;
  features: TaskFeatureVector;
  flags: TaskAnalysisFlags;
  minimumCapability: CapabilityTier;
}
