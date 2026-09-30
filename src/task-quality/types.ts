import type { ContextProbe, Provider } from "../types.js";
import type { SuccessCriterion, SuccessCriterionType } from "../success-criteria.js";
import type { TaskCategory } from "../task-types.js";

/** Recorded model output for offline evaluation (no live API in Phase 5). */
export interface TaskCaseCandidate {
  modelId: string;
  provider: Provider;
  output: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface TaskCase {
  id: string;
  category: TaskCategory;
  userMessage: string;
  probes?: ContextProbe[];
  /** `fixture_only` uses only `evaluationCriteria` (explicit task checks). */
  criteriaSource?: "merged" | "fixture_only" | "contract_only";
  candidates: TaskCaseCandidate[];
  /**
   * Explicit checks for this case. Merged with contract criteria by `id`
   * (fixture entry wins on conflict). Use for task-specific assertions.
   */
  evaluationCriteria?: EvaluableCriterion[];
}

/** Criterion plus machine-readable check spec for evaluators. */
export interface EvaluableCriterion extends Omit<SuccessCriterion, "spec"> {
  spec?: CriterionCheckSpec;
}

export interface CriterionCheckSpec {
  /** All strings must appear in output (case-insensitive). */
  mustInclude?: string[];
  /** None of these may appear (false-positive guards). */
  mustNotInclude?: string[];
  /** At least one pattern (regex string) must match. */
  patternsAny?: string[];
  /** All patterns must match. */
  patternsAll?: string[];
  /** Minimum count of markdown bullet lines. */
  minBulletLines?: number;
  /** Rubric: fraction of keywords present for score. */
  rubricKeywords?: string[];
  /** Deterministic: run named check (built-in registry). */
  check?: string;
}

export interface CriterionEvaluationResult {
  criterionId: string;
  type: SuccessCriterionType;
  evaluator: string;
  passed: boolean;
  score: number;
  details?: string;
}

export interface EvaluationResult {
  taskId: string;
  model: string;
  provider: Provider;
  /** Primary evaluation engine id. */
  evaluator: string;
  qualityScore: number;
  passed: boolean;
  criterionResults: CriterionEvaluationResult[];
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  errors: string[];
  specId: string;
}

export interface TaskCaseEvaluation {
  caseId: string;
  category: TaskCategory;
  results: EvaluationResult[];
}

export interface TaskQualityReport {
  generatedAt: string;
  frameworkVersion: string;
  note: string;
  cases: TaskCaseEvaluation[];
  summary: {
    caseCount: number;
    resultCount: number;
    passed: number;
    failed: number;
  };
}

export interface TaskQualityFixtureSuite {
  version: string;
  note?: string;
  cases: TaskCase[];
}
