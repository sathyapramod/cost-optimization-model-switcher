import { inferPrimarySource, scoreIngestComplexity, taskClassFromDifficulty } from "./classify-core.js";
import { estimateTotalTokens, resolveContextBand } from "./estimate.js";
import type {
  CapabilityTier,
  ContextBand,
  ContextProbe,
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

export interface TaskAnalysis {
  intents: TaskIntent[];
  category: TaskCategory;
  taskClass: TaskClass;
  taskDifficulty: number;
  ingestComplexity: number;
  contextBand: ContextBand;
  estimatedInputTokens: number;
  primarySource: ContextSource;
  features: TaskFeatureVector;
  flags: TaskAnalysisFlags;
  /** Lowest tier likely to succeed; routing engine (#13) may override with policy (#19). */
  minimumCapability: CapabilityTier;
}

export interface TaskAnalyzerInput {
  userMessage: string;
  probes?: ContextProbe[];
  /** Skip probe token math when band/tokens already computed (e.g. from `evaluateGate`). */
  contextBand?: ContextBand;
  estimatedInputTokens?: number;
}

const STRAIGHTFORWARD_PATTERNS: Array<{ intent: TaskIntent; re: RegExp }> = [
  { intent: "summarize", re: /\bsummari[sz]e\b/i },
  { intent: "summarize", re: /\btl;?dr\b/i },
  { intent: "summarize", re: /\bexecutive summary\b/i },
  { intent: "format", re: /\bformat\b/i },
  { intent: "format", re: /\bre-?structure\b/i },
  { intent: "format", re: /\bconvert to\b/i },
  { intent: "review", re: /\breview (the )?(pr|diff|changes)\b/i },
  { intent: "review", re: /\blist (all )?(bugs?|issues?|findings?|blockers?)\b/i },
  { intent: "extract", re: /\bextract\b/i },
  { intent: "extract", re: /\btriage\b/i },
  { intent: "format", re: /\bclassif(y|ication)\b/i },
  { intent: "format", re: /\bcategoriz(e|ation)\b/i },
  { intent: "review", re: /\bwhat changed\b/i },
  { intent: "review", re: /\bhighlight regressions?\b/i },
  { intent: "extract", re: /\baction items?\b/i },
  { intent: "format", re: /\btag\b/i },
  { intent: "extract", re: /\bany blockers?\b/i },
];

const DEEP_SIGNAL_PATTERN =
  /\barchitect(ure)?\b|\bmigrat(e|ion)\b|\bsecurity audit\b|\bexploit\b|\bmulti[- ]service\b/i;

const COMPLEX_PATTERNS: Array<{ intent: TaskIntent; re: RegExp }> = [
  { intent: "architect", re: /\barchitect(ure)?\b/i },
  { intent: "architect", re: /\bdesign\b/i },
  { intent: "architect", re: /\bmigrat(e|ion)\b/i },
  { intent: "debug", re: /\broot[- ]cause\b/i },
  { intent: "debug", re: /\bdebug\b/i },
  { intent: "implement", re: /\bfix\b/i },
  { intent: "implement", re: /\bimplement\b/i },
  { intent: "refactor", re: /\brefactor\b/i },
  { intent: "implement", re: /\bwrite (the )?code\b/i },
  { intent: "security", re: /\bsecurity audit\b/i },
  { intent: "security", re: /\bexploit\b/i },
  { intent: "architect", re: /\bnovel\b/i },
  { intent: "architect", re: /\bmulti[- ]step\b/i },
  { intent: "architect", re: /\bplan the\b/i },
];

function clampScore(n: number): number {
  return Math.max(0, Math.min(5, n));
}

function uniqueIntents(intents: TaskIntent[]): TaskIntent[] {
  return [...new Set(intents)];
}

function detectIntents(text: string): TaskIntent[] {
  const intents: TaskIntent[] = [];
  for (const { intent, re } of STRAIGHTFORWARD_PATTERNS) {
    if (re.test(text)) intents.push(intent);
  }
  for (const { intent, re } of COMPLEX_PATTERNS) {
    if (re.test(text)) intents.push(intent);
  }
  if (intents.length === 0) intents.push("other");
  return uniqueIntents(intents);
}

export function scoreTaskDifficultyFromMessage(userMessage: string): number {
  const text = userMessage.trim();
  if (!text) return 5;

  let score = 1;
  const straightHits = STRAIGHTFORWARD_PATTERNS.filter(({ re }) => re.test(text)).length;
  const complexHits = COMPLEX_PATTERNS.filter(({ re }) => re.test(text)).length;

  score += complexHits;
  score -= Math.min(straightHits, 2);
  if (DEEP_SIGNAL_PATTERN.test(text)) score += 2;
  if (straightHits > 0 && complexHits > 0) score = Math.max(score, 3);

  return clampScore(score);
}

export function hasDeepSignals(userMessage: string): boolean {
  return DEEP_SIGNAL_PATTERN.test(userMessage);
}

function inferCategory(intents: TaskIntent[], text: string): TaskCategory {
  if (intents.includes("security")) return "security";
  if (intents.includes("architect")) return "architecture";
  if (
    intents.includes("debug") ||
    /\b(race condition|deadlock|concurrency bug|root[- ]cause)\b/i.test(text)
  ) {
    return "debugging";
  }
  if (intents.includes("refactor")) return "refactor";
  if (intents.includes("implement")) return "crud_implementation";
  if (intents.includes("review") && /\b(pr|diff)\b/i.test(text)) return "pr_review";
  if (
    intents.includes("summarize") ||
    intents.includes("extract") ||
    /\bjira\b/i.test(text)
  ) {
    return "summarization";
  }
  if (intents.includes("review")) return "pr_review";
  return "other";
}

function buildFeatures(
  intents: TaskIntent[],
  taskDifficulty: number,
  ingestComplexity: number,
  flags: TaskAnalysisFlags,
): TaskFeatureVector {
  const bulk =
    intents.includes("summarize") || intents.includes("extract") || intents.includes("format")
      ? clampScore(4 - Math.max(0, taskDifficulty - 1))
      : clampScore(Math.max(0, 2 - taskDifficulty));

  let codeChange = 0;
  if (intents.includes("implement") || intents.includes("refactor")) codeChange = 4;
  else if (intents.includes("debug")) codeChange = 3;

  let securityDepth = intents.includes("security") ? 5 : 0;
  if (flags.deepSignals && intents.includes("security")) securityDepth = 5;

  let reasoningDepth = clampScore(taskDifficulty);
  if (flags.deepSignals) reasoningDepth = Math.max(reasoningDepth, 4);

  return {
    reasoningDepth,
    codeChange,
    securityDepth,
    bulkTextProcessing: bulk,
    contextDependence: clampScore(ingestComplexity),
  };
}

export function minimumCapabilityForAnalysis(analysis: Pick<
  TaskAnalysis,
  "taskClass" | "taskDifficulty" | "ingestComplexity" | "flags" | "features"
>): CapabilityTier {
  if (analysis.flags.deepSignals || analysis.features.securityDepth >= 4) return "premium";
  if (analysis.taskClass === "straightforward") return "fast";
  if (analysis.taskDifficulty >= 4) return "premium";
  if (analysis.taskDifficulty >= 2 && analysis.ingestComplexity >= 3) return "premium";
  return "balanced";
}

export function analyzeTask(input: TaskAnalyzerInput): TaskAnalysis {
  const text = input.userMessage.trim();
  const probes = input.probes ?? [];
  const estimatedInputTokens =
    input.estimatedInputTokens ?? estimateTotalTokens(probes);
  const contextBand =
    input.contextBand ?? resolveContextBand(probes, estimatedInputTokens);
  const ingestComplexity = scoreIngestComplexity(contextBand, estimatedInputTokens);
  const primarySource = inferPrimarySource(probes);

  const intents = detectIntents(text);
  const straightHits = STRAIGHTFORWARD_PATTERNS.filter(({ re }) => re.test(text)).length;
  const complexHits = COMPLEX_PATTERNS.filter(({ re }) => re.test(text)).length;
  const taskDifficulty = scoreTaskDifficultyFromMessage(input.userMessage);
  const taskClass = taskClassFromDifficulty(taskDifficulty);

  const flags: TaskAnalysisFlags = {
    deepSignals: hasDeepSignals(text),
    mixedIntent: straightHits > 0 && complexHits > 0,
    wantsThoroughReview: /\bthorough\b|\bdetailed\b|\bnuanced\b/i.test(text),
  };

  const features = buildFeatures(intents, taskDifficulty, ingestComplexity, flags);
  const category = inferCategory(intents, text);

  const partial = {
    taskClass,
    taskDifficulty,
    ingestComplexity,
    flags,
    features,
  };

  return {
    intents,
    category,
    taskClass,
    taskDifficulty,
    ingestComplexity,
    contextBand,
    estimatedInputTokens,
    primarySource,
    features,
    flags,
    minimumCapability: minimumCapabilityForAnalysis(partial),
  };
}
