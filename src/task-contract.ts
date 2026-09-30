import {
  buildTaskSuccessSpecification,
  type SuccessCriterion,
  type SuccessSpecId,
  type TaskSuccessSpecification,
} from "./success-criteria.js";
import type { Confidence, ContextBand, ContextProbe, ContextSource } from "./types.js";
import type { TaskAnalysisCore, TaskCategory, TaskIntent } from "./task-types.js";

/** Task shape for contracts; aligns with benchmark categories. */
export type TaskType = TaskCategory;

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type {
  SuccessCriterion,
  SuccessCriterionType,
  TaskSuccessSpecification,
} from "./success-criteria.js";

/** Multi-axis capability needs (0–5). Heuristic — not objective complexity. */
export interface TaskRequirements {
  reasoning: number;
  coding: number;
  architecture: number;
  domainKnowledge: number;
  quantitativeReasoning: number;
  contextUnderstanding: number;
  toolUse: number;
  outputComplexity: number;
}

export interface TaskUnderstandingConfidence {
  overall: Confidence;
  /** False when the prompt is too vague to attach meaningful criteria. */
  canDefineSuccessCriteria: boolean;
  ambiguities: string[];
}

export interface TaskContract {
  objective: string;
  taskType: TaskType;
  requirements: TaskRequirements;
  /** Phase 4 task success specification (inspectable; not used by router). */
  successSpecification: TaskSuccessSpecification;
  /** Mirror of `successSpecification.criteria` for backward compatibility. */
  successCriteria: SuccessCriterion[];
  constraints: string[];
  riskLevel: RiskLevel;
  confidence: TaskUnderstandingConfidence;
  /**
   * Legacy heuristic from regex classifier (same as `TaskAnalysis.taskDifficulty`).
   * Signal only — not ground-truth task complexity.
   */
  heuristicTaskDifficulty: number;
}

export interface TaskContractInput {
  userMessage: string;
  probes?: ContextProbe[];
  contextBand?: ContextBand;
  primarySource?: ContextSource;
  analysis: TaskAnalysisCore;
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(5, n));
}

const ANALYTICAL_PATTERN =
  /\b(compare|contrast|trade[- ]?off|framework|analy[sz]e|evaluate|assess|implications?|why does|how does)\b/i;

const QUANTITATIVE_PATTERN =
  /\b(percent|probability|statistics?|metric|p-?value|regression|correlation|calculate|quantify)\b/i;

const DOMAIN_PATTERN =
  /\b(compliance|hipaa|pci|gdpr|kubernetes|distributed|consensus|cap theorem|event[- ]sourced)\b/i;

const TOOL_PATTERN =
  /\b(gh |grep |kubectl |docker |npm run|mcp\b|curl )\b/i;

const CONSTRAINT_PATTERN =
  /\b(must not|must|without|only|do not|never|at most|at least|by EOD|deadline)\b[^.!?]*/gi;

const VAGUE_ANALYZE_RE = /^\s*analy[sz]e\b[\s!.?]*$/i;

/** Prompt too vague for reliable requirement inference (Phase 3 routing). */
export function isUnderspecifiedUserMessage(
  userMessage: string,
  analysis?: Pick<TaskAnalysisCore, "intents">,
): boolean {
  const text = userMessage.trim();
  if (!text) return true;
  if (VAGUE_ANALYZE_RE.test(text)) return true;
  if (/^\s*analy[sz]e\s+(this|it)\s*\.?$/i.test(text)) return true;
  if (
    text.length < 12 &&
    analysis &&
    analysis.intents.length === 1 &&
    analysis.intents[0] === "other"
  ) {
    return true;
  }
  return false;
}

export function deriveObjective(userMessage: string, maxLen = 280): string {
  const oneLine = userMessage.replace(/\s+/g, " ").trim();
  if (!oneLine) return "(empty prompt)";
  const sentence = oneLine.split(/(?<=[.!?])\s+/)[0] ?? oneLine;
  const base = sentence.length > 0 ? sentence : oneLine;
  if (base.length <= maxLen) return base;
  return `${base.slice(0, maxLen - 1)}…`;
}

export function extractConstraints(userMessage: string): string[] {
  const matches = userMessage.match(CONSTRAINT_PATTERN);
  if (!matches) return [];
  const normalized = matches.map((m) => m.replace(/\s+/g, " ").trim()).filter(Boolean);
  return [...new Set(normalized)].slice(0, 8);
}

export function inferRiskLevel(
  intents: TaskIntent[],
  flags: TaskAnalysisCore["flags"],
  text: string,
): RiskLevel {
  if (intents.includes("security") || /\bprod(uction)?\b|\bdata loss\b|\bexploit\b/i.test(text)) {
    return flags.deepSignals ? "critical" : "high";
  }
  if (flags.deepSignals || intents.includes("architect")) return "high";
  if (intents.includes("implement") || intents.includes("refactor") || intents.includes("debug")) {
    return "medium";
  }
  return "low";
}

export function deriveUnderstandingConfidence(
  analysis: TaskAnalysisCore,
  userMessage: string,
): TaskUnderstandingConfidence {
  const ambiguities: string[] = [];
  const text = userMessage.trim();

  if (!text) {
    return {
      overall: "low",
      canDefineSuccessCriteria: false,
      ambiguities: ["empty user prompt"],
    };
  }

  if (analysis.flags.mixedIntent) {
    ambiguities.push("mixed straightforward and complex intent signals");
  }
  if (analysis.intents.length === 1 && analysis.intents[0] === "other") {
    ambiguities.push("no strong intent keywords detected");
  }
  if (analysis.taskDifficulty === 2) {
    ambiguities.push("borderline heuristic task difficulty (score 2)");
  }
  if (analysis.flags.wantsThoroughReview && analysis.taskClass === "straightforward") {
    ambiguities.push("thorough output requested on otherwise simple task class");
  }

  let overall: Confidence = "high";
  if (ambiguities.length >= 2) overall = "low";
  else if (ambiguities.length === 1) overall = "medium";

  const canDefineSuccessCriteria =
    overall !== "low" || analysis.category !== "other" || analysis.intents[0] !== "other";

  return { overall, canDefineSuccessCriteria, ambiguities };
}

export function deriveRequirements(
  analysis: TaskAnalysisCore,
  userMessage: string,
  _contextBand: ContextBand,
): TaskRequirements {
  const { ingestComplexity } = analysis;
  if (isUnderspecifiedUserMessage(userMessage, analysis)) {
    return {
      reasoning: 0,
      coding: 0,
      architecture: 0,
      domainKnowledge: 0,
      quantitativeReasoning: 0,
      contextUnderstanding: clampScore(ingestComplexity),
      toolUse: 0,
      outputComplexity: 0,
    };
  }

  const text = userMessage;
  const { features, intents, flags } = analysis;

  let architecture = flags.deepSignals || intents.includes("architect") ? 4 : 0;
  if (intents.includes("architect") && flags.deepSignals) architecture = 5;

  let domainKnowledge = DOMAIN_PATTERN.test(text) ? 3 : 1;
  if (ANALYTICAL_PATTERN.test(text)) domainKnowledge = Math.max(domainKnowledge, 4);

  let quantitativeReasoning = QUANTITATIVE_PATTERN.test(text) ? 3 : 0;
  if (ANALYTICAL_PATTERN.test(text) && QUANTITATIVE_PATTERN.test(text)) {
    quantitativeReasoning = 4;
  }

  let toolUse = TOOL_PATTERN.test(text) ? 2 : 0;
  if (/\b(github_pr|gh pr|jira)\b/i.test(text) || analysis.primarySource === "github_pr") {
    toolUse = Math.max(toolUse, 2);
  }
  if (analysis.primarySource === "log_file" || analysis.primarySource === "database_dump") {
    toolUse = Math.max(toolUse, 2);
  }

  let outputComplexity = flags.wantsThoroughReview ? 4 : 2;
  if (intents.includes("format") || intents.includes("summarize")) {
    outputComplexity = analysis.taskClass === "straightforward" ? 2 : 3;
  }
  if (ANALYTICAL_PATTERN.test(text)) outputComplexity = Math.max(outputComplexity, 4);

  return {
    reasoning: clampScore(features.reasoningDepth),
    coding: clampScore(features.codeChange),
    architecture: clampScore(architecture),
    domainKnowledge: clampScore(domainKnowledge),
    quantitativeReasoning: clampScore(quantitativeReasoning),
    contextUnderstanding: clampScore(ingestComplexity),
    toolUse: clampScore(toolUse),
    outputComplexity: clampScore(outputComplexity),
  };
}

export function resolveSuccessSpecId(
  analysis: TaskAnalysisCore,
  userMessage: string,
): SuccessSpecId {
  if (isUnderspecifiedUserMessage(userMessage, analysis)) return "underspecified";
  if (isAnalyticalTask(userMessage, analysis)) return "analytical";
  switch (analysis.category) {
    case "summarization":
      return "summarization";
    case "pr_review":
      return "code_review";
    case "crud_implementation":
    case "refactor":
      return "code_generation";
    case "debugging":
      return "debugging";
    case "architecture":
      return "architecture";
    case "security":
      return "security";
    default:
      return "analytical";
  }
}

/** @deprecated Use `buildTaskSuccessSpecification` / catalog. */
export function defaultSuccessCriteria(
  taskType: TaskType,
  analysis: TaskAnalysisCore,
  userMessage: string,
): SuccessCriterion[] {
  const specId = resolveSuccessSpecId(analysis, userMessage);
  return buildTaskSuccessSpecification(specId, analysis).criteria;
}

export function isAnalyticalTask(userMessage: string, analysis: TaskAnalysisCore): boolean {
  if (!ANALYTICAL_PATTERN.test(userMessage)) return false;
  if (analysis.category === "architecture" || analysis.category === "security") return true;
  if (analysis.taskClass === "complex") return true;
  // Framework-style questions without code-change verbs (routing taskClass unchanged).
  return /\b(trade[- ]?off|theorem|consistency|implications?|framework)\b/i.test(userMessage);
}

export function resolveContractTaskType(
  analysis: TaskAnalysisCore,
  userMessage: string,
): TaskType {
  if (isAnalyticalTask(userMessage, analysis)) return "other";
  return analysis.category;
}

export function buildTaskContract(input: TaskContractInput): TaskContract {
  const { analysis, userMessage } = input;
  const contextBand = input.contextBand ?? analysis.contextBand;
  const heuristicTaskDifficulty = analysis.taskDifficulty;

  const taskType = resolveContractTaskType(analysis, userMessage);
  const specId = resolveSuccessSpecId(analysis, userMessage);
  const successSpecification = buildTaskSuccessSpecification(specId, analysis);
  const successCriteria = successSpecification.criteria;

  return {
    objective: deriveObjective(userMessage),
    taskType,
    requirements: deriveRequirements(analysis, userMessage, contextBand),
    successSpecification,
    successCriteria,
    constraints: extractConstraints(userMessage),
    riskLevel: inferRiskLevel(analysis.intents, analysis.flags, userMessage),
    confidence: deriveUnderstandingConfidence(analysis, userMessage),
    heuristicTaskDifficulty,
  };
}
