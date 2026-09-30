import type { Confidence, ContextBand, ContextProbe, ContextSource } from "./types.js";
import type { TaskAnalysisCore, TaskCategory, TaskIntent } from "./task-types.js";

/** Task shape for contracts; aligns with benchmark categories. */
export type TaskType = TaskCategory;

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type SuccessCriterionKind = "deterministic" | "structural" | "heuristic_check";

export interface SuccessCriterion {
  id: string;
  description: string;
  kind: SuccessCriterionKind;
  spec?: Record<string, unknown>;
}

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
  const text = userMessage;
  const { features, intents, flags, ingestComplexity } = analysis;

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

export function defaultSuccessCriteria(
  taskType: TaskType,
  analysis: TaskAnalysisCore,
): SuccessCriterion[] {
  const base: SuccessCriterion[] = [
    {
      id: "addresses_objective",
      description: "Response addresses the stated objective without ignoring key parts of the prompt",
      kind: "heuristic_check",
    },
  ];

  switch (taskType) {
    case "summarization":
      return [
        ...base,
        {
          id: "summary_coverage",
          description: "Summary reflects material in the provided context (not generic filler)",
          kind: "structural",
          spec: { expectsBulletsOrSections: true },
        },
        {
          id: "length_appropriate",
          description: "Length is appropriate for the requested format (TL;DR vs detailed)",
          kind: "heuristic_check",
        },
      ];
    case "pr_review":
      return [
        ...base,
        {
          id: "findings_actionable",
          description: "Findings are specific (file/area or behavior), not vague platitudes",
          kind: "structural",
        },
        {
          id: "severity_or_priority",
          description: "Issues are prioritized or labeled by severity when multiple findings exist",
          kind: "heuristic_check",
        },
      ];
    case "debugging":
      return [
        ...base,
        {
          id: "root_cause_or_hypothesis",
          description: "Explains likely root cause or ranked hypotheses tied to symptoms",
          kind: "structural",
        },
        {
          id: "fix_or_next_steps",
          description: "Proposes fix, workaround, or concrete next diagnostic steps",
          kind: "structural",
        },
      ];
    case "architecture":
      return [
        ...base,
        {
          id: "options_and_tradeoffs",
          description: "Describes options, constraints, and tradeoffs (not a single unexplained choice)",
          kind: "structural",
        },
        {
          id: "migration_or_rollout",
          description: "Addresses rollout, migration, or operational risk when migration/design requested",
          kind: "heuristic_check",
        },
      ];
    case "security":
      return [
        ...base,
        {
          id: "threat_model",
          description: "Identifies assets, threats, or attack paths relevant to the surface",
          kind: "structural",
        },
        {
          id: "actionable_remediation",
          description: "Remediation or verification steps are actionable",
          kind: "structural",
        },
      ];
    case "crud_implementation":
    case "refactor":
      return [
        ...base,
        {
          id: "code_correctness",
          description: "Proposed code changes are coherent with the codebase context provided",
          kind: "heuristic_check",
        },
        {
          id: "tests_or_verification",
          description: "Includes tests or explicit verification steps when implementation was requested",
          kind: "structural",
          spec: { testsMentioned: analysis.intents.includes("implement") },
        },
      ];
    default:
      if (ANALYTICAL_PATTERN.test(analysis.intents.join(" "))) {
        return analyticalSuccessCriteria();
      }
      return [
        ...base,
        {
          id: "structured_reasoning",
          description: "Uses structured reasoning (claims supported by steps or evidence)",
          kind: "structural",
        },
      ];
  }
}

function analyticalSuccessCriteria(): SuccessCriterion[] {
  return [
    {
      id: "addresses_objective",
      description: "Response addresses the analytical question directly",
      kind: "heuristic_check",
    },
    {
      id: "framework_or_criteria",
      description: "Applies an explicit framework or evaluation criteria (not hand-waving)",
      kind: "structural",
    },
    {
      id: "tradeoffs",
      description: "States tradeoffs, assumptions, and limits of the analysis",
      kind: "structural",
    },
    {
      id: "conclusion_supported",
      description: "Conclusion follows from the analysis presented",
      kind: "heuristic_check",
    },
  ];
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
  let successCriteria = defaultSuccessCriteria(taskType, analysis);
  if (isAnalyticalTask(userMessage, analysis)) {
    successCriteria = analyticalSuccessCriteria();
  }

  return {
    objective: deriveObjective(userMessage),
    taskType,
    requirements: deriveRequirements(analysis, userMessage, contextBand),
    successCriteria,
    constraints: extractConstraints(userMessage),
    riskLevel: inferRiskLevel(analysis.intents, analysis.flags, userMessage),
    confidence: deriveUnderstandingConfidence(analysis, userMessage),
    heuristicTaskDifficulty,
  };
}
