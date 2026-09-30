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

/** Domain folder under `benchmarks/` (task-quality suites). */
/** Training fixtures feed evidence index v2; holdout is excluded from routing evidence. */
export type BenchmarkSplit = "train" | "holdout";

export type BenchmarkDomain =
  | "summarization"
  | "extraction"
  | "coding"
  | "code-review"
  | "debugging"
  | "architecture"
  | "security"
  | "analytical";

export interface TaskCaseContext {
  description?: string;
  probes?: ContextProbe[];
  /** Analytical / planning tasks: explicit assumptions the model must state or use. */
  assumptions?: string[];
}

export interface TaskCase {
  id: string;
  category: TaskCategory;
  /** Defaults to train (included in quality evidence for routing). */
  benchmarkSplit?: BenchmarkSplit;
  userMessage: string;
  /** Source domain suite (when loaded from `benchmarks/<domain>/suite.json`). */
  domain?: BenchmarkDomain;
  taskType?: string;
  context?: TaskCaseContext;
  /** Inspectable capability needs for this benchmark (not router ground truth). */
  requirements?: Record<string, number>;
  expectedBehavior?: {
    summary?: string;
    notes?: string;
  };
  /** Primary offline evaluator id for this case. */
  evaluator?: string;
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
  /** For `structured_json` check: keys that must exist on parsed root object. */
  requiredKeys?: string[];
  /** For `structured_json`: each array item must include these keys (first array found). */
  itemKeys?: string[];
  /** For `exports_named_function`: symbol that must appear in a code fence. */
  functionName?: string;
  /** For `embedded_test_assertions`: regex patterns that must match (executable-style tests in output). */
  testPatterns?: string[];
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
  domain?: BenchmarkDomain;
  benchmarkSplit?: BenchmarkSplit;
  results: EvaluationResult[];
}

export interface ModelDomainBenchmarkStats {
  modelId: string;
  provider: Provider;
  domain: BenchmarkDomain;
  caseCount: number;
  passCount: number;
  failureRate: number;
  meanQuality: number;
  meanCostUsd: number;
  meanLatencyMs: number;
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
    byModelDomain: ModelDomainBenchmarkStats[];
  };
}

export interface TaskQualityFixtureSuite {
  version: string;
  note?: string;
  cases: TaskCase[];
}
