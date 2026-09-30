import type { ResolvedModel } from "./catalog.js";
import { buildSwitchCostEstimate } from "./cost.js";
import type { CapabilityRouteResult } from "./capability-router.js";
import { routeByCapabilities } from "./capability-router.js";
import type { CatalogModelProfile } from "./model-profiles.js";
import { buildTaskSuccessSpecification } from "./success-criteria.js";
import { resolveSuccessSpecId } from "./task-contract.js";
import type { TaskAnalysis } from "./task-analyzer.js";
import {
  TASK_CONTRACT_EVALUATOR_ID,
  aggregateQualityScore,
  evaluateOutputAgainstCriteria,
} from "./task-quality/evaluators.js";
import { mergeCriteriaForCase } from "./task-quality/runner.js";
import type {
  CriterionEvaluationResult,
  EvaluableCriterion,
} from "./task-quality/types.js";
import type { CapabilityTier, Provider } from "./types.js";

const TIER_RANK: Record<CapabilityTier, number> = {
  fast: 0,
  balanced: 1,
  premium: 2,
};

/** Experimental policy — off unless callers pass `enabled: true`. */
export const EXPERIMENTAL_PROGRESSIVE_ROUTING_ENABLED = false;

export interface ProgressiveRoutingConfig {
  enabled: boolean;
  /** Max model attempts (defaults to ladder length). */
  maxAttempts?: number;
  /** Each model id may be tried at most once; escalations must increase tier rank. */
  antiThrashing?: boolean;
}

export const DEFAULT_PROGRESSIVE_ROUTING_CONFIG: ProgressiveRoutingConfig = {
  enabled: EXPERIMENTAL_PROGRESSIVE_ROUTING_ENABLED,
  antiThrashing: true,
};

export interface ProgressiveExecutionResult {
  output: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export type ProgressiveModelExecutor = (
  model: CatalogModelProfile,
) => ProgressiveExecutionResult | Promise<ProgressiveExecutionResult>;

export interface ProgressiveRoutingEvaluation {
  passed: boolean;
  qualityScore: number;
  criterionResults: CriterionEvaluationResult[];
  errors: string[];
  evaluator: string;
  specId: string;
  estimatedCostUsd: number;
}

export interface ProgressiveRoutingAttempt {
  modelId: string;
  tier: CapabilityTier;
  evaluationResult: ProgressiveRoutingEvaluation;
  passed: boolean;
  escalationReason?: string;
}

export type ProgressiveRoutingStopReason =
  | "disabled"
  | "passed"
  | "exhausted_models"
  | "thrashing_prevented"
  | "no_capable_models";

export interface ProgressiveRoutingResult {
  policy: "experimental_progressive_routing";
  enabled: boolean;
  initialModel: { modelId: string; tier: CapabilityTier } | null;
  finalModel: { modelId: string; tier: CapabilityTier } | null;
  evaluationResult: ProgressiveRoutingEvaluation | null;
  escalatedFrom: string | null;
  escalatedTo: string | null;
  escalationReason: string | null;
  attempts: ProgressiveRoutingAttempt[];
  stoppedReason: ProgressiveRoutingStopReason;
  explanation: string;
}

export interface ProgressiveRoutingInput {
  resolved: ResolvedModel;
  taskAnalysis: TaskAnalysis;
  userMessage: string;
  effectiveInputTokens: number;
  execute: ProgressiveModelExecutor;
  config?: Partial<ProgressiveRoutingConfig>;
  capabilityResult?: CapabilityRouteResult;
  /** Override success checks (tests / pinned task benchmarks). */
  evaluationCriteria?: EvaluableCriterion[];
  criteriaSource?: "merged" | "fixture_only" | "contract_only";
  contextBand?: import("./types.js").ContextBand;
  primarySource?: import("./types.js").ContextSource;
  taskDifficulty?: number;
}

function sortLadderCheapestFirst(
  models: CatalogModelProfile[],
  provider: Provider,
  inputTokens: number,
  taskClass: TaskAnalysis["taskClass"],
): CatalogModelProfile[] {
  return [...models].sort((a, b) => {
    const costA = buildSwitchCostEstimate({
      currentModelId: a.modelId,
      recommendedModelId: a.modelId,
      provider,
      currentTier: a.tier,
      recommendedTier: a.tier,
      inputTokens,
      taskClass,
    }).estimated_cost_current_usd;
    const costB = buildSwitchCostEstimate({
      currentModelId: b.modelId,
      recommendedModelId: b.modelId,
      provider,
      currentTier: b.tier,
      recommendedTier: b.tier,
      inputTokens,
      taskClass,
    }).estimated_cost_current_usd;
    if (costA !== costB) return costA - costB;
    return TIER_RANK[a.tier] - TIER_RANK[b.tier];
  });
}

function evaluateOutputForTask(
  input: ProgressiveRoutingInput,
  model: CatalogModelProfile,
  execution: ProgressiveExecutionResult,
): ProgressiveRoutingEvaluation {
  const specId = resolveSuccessSpecId(input.taskAnalysis, input.userMessage);
  const spec = buildTaskSuccessSpecification(specId, input.taskAnalysis);
  const criteria = mergeCriteriaForCase(
    spec.criteria,
    input.evaluationCriteria,
    input.criteriaSource ?? "fixture_only",
  );

  const criterionResults = evaluateOutputAgainstCriteria({
    output: execution.output,
    criteria,
  });
  const { qualityScore, passed, errors } = aggregateQualityScore(criterionResults, criteria);

  const inputTokens = execution.inputTokens ?? input.effectiveInputTokens;
  const cost = buildSwitchCostEstimate({
    currentModelId: model.modelId,
    recommendedModelId: model.modelId,
    provider: input.resolved.provider,
    currentTier: model.tier,
    recommendedTier: model.tier,
    inputTokens,
    taskClass: input.taskAnalysis.taskClass,
  });

  return {
    passed,
    qualityScore,
    criterionResults,
    errors,
    evaluator: TASK_CONTRACT_EVALUATOR_ID,
    specId: spec.specId,
    estimatedCostUsd: cost.estimated_cost_current_usd,
  };
}

function buildCapabilityResult(input: ProgressiveRoutingInput): CapabilityRouteResult {
  if (input.capabilityResult) return input.capabilityResult;
  return routeByCapabilities({
    resolved: input.resolved,
    taskAnalysis: input.taskAnalysis,
    contextBand: input.contextBand ?? input.taskAnalysis.contextBand,
    primarySource: input.primarySource ?? input.taskAnalysis.primarySource,
    userMessage: input.userMessage,
    taskDifficulty: input.taskDifficulty ?? input.taskAnalysis.taskDifficulty,
    switchDirection: "downgrade",
    effectiveInputTokens: input.effectiveInputTokens,
  });
}

/**
 * Try models from cheapest capable → stronger until success criteria pass or ladder ends.
 * Not used by the gate unless explicitly enabled by the caller.
 */
export async function executeExperimentalProgressiveRouting(
  input: ProgressiveRoutingInput,
): Promise<ProgressiveRoutingResult> {
  const config = { ...DEFAULT_PROGRESSIVE_ROUTING_CONFIG, ...input.config };

  if (!config.enabled) {
    return {
      policy: "experimental_progressive_routing",
      enabled: false,
      initialModel: null,
      finalModel: null,
      evaluationResult: null,
      escalatedFrom: null,
      escalatedTo: null,
      escalationReason: null,
      attempts: [],
      stoppedReason: "disabled",
      explanation: "Experimental progressive routing is disabled.",
    };
  }

  const cap = buildCapabilityResult(input);
  const ladder = sortLadderCheapestFirst(
    cap.capableModels,
    input.resolved.provider,
    input.effectiveInputTokens,
    input.taskAnalysis.taskClass,
  );

  if (ladder.length === 0) {
    return {
      policy: "experimental_progressive_routing",
      enabled: true,
      initialModel: null,
      finalModel: null,
      evaluationResult: null,
      escalatedFrom: null,
      escalatedTo: null,
      escalationReason: null,
      attempts: [],
      stoppedReason: "no_capable_models",
      explanation: "No models in catalog satisfy mandatory capability requirements.",
    };
  }

  const maxAttempts = Math.min(config.maxAttempts ?? ladder.length, ladder.length);
  const tried = new Set<string>();
  const attempts: ProgressiveRoutingAttempt[] = [];
  let lastTierRank = -1;
  let escalatedFrom: string | null = null;
  let escalatedTo: string | null = null;
  let escalationReason: string | null = null;

  const initial = ladder[0]!;
  let finalModel: { modelId: string; tier: CapabilityTier } | null = null;
  let evaluationResult: ProgressiveRoutingEvaluation | null = null;
  let stoppedReason: ProgressiveRoutingStopReason = "exhausted_models";

  for (let i = 0; i < maxAttempts; i++) {
    const model = ladder[i];
    if (!model) break;

    if (config.antiThrashing) {
      if (tried.has(model.modelId)) {
        stoppedReason = "thrashing_prevented";
        break;
      }
      if (TIER_RANK[model.tier] < lastTierRank) {
        stoppedReason = "thrashing_prevented";
        escalationReason = "non-monotonic tier escalation blocked";
        break;
      }
      tried.add(model.modelId);
      lastTierRank = TIER_RANK[model.tier];
    }

    const execution = await input.execute(model);
    const evalResult = evaluateOutputForTask(input, model, execution);

    const attempt: ProgressiveRoutingAttempt = {
      modelId: model.modelId,
      tier: model.tier,
      evaluationResult: evalResult,
      passed: evalResult.passed,
    };

    if (evalResult.passed) {
      attempt.escalationReason = undefined;
      attempts.push(attempt);
      finalModel = { modelId: model.modelId, tier: model.tier };
      evaluationResult = evalResult;
      stoppedReason = "passed";
      break;
    }

    const next = ladder[i + 1];
    if (next) {
      const reason =
        evalResult.errors.length > 0
          ? evalResult.errors.join("; ")
          : "task success criteria not met";
      attempt.escalationReason = reason;
      escalatedFrom = model.modelId;
      escalatedTo = next.modelId;
      escalationReason = reason;
    }

    attempts.push(attempt);
    evaluationResult = evalResult;
    finalModel = { modelId: model.modelId, tier: model.tier };
  }

  const initialModel = { modelId: initial.modelId, tier: initial.tier };
  if (stoppedReason === "passed" && attempts.length === 1) {
    escalatedFrom = null;
    escalatedTo = null;
    escalationReason = null;
  }

  if (stoppedReason === "passed") {
    finalModel = finalModel!;
    evaluationResult = evaluationResult!;
  } else if (attempts.length > 0) {
    const last = attempts[attempts.length - 1]!;
    finalModel = { modelId: last.modelId, tier: last.tier };
    evaluationResult = last.evaluationResult;
  }

  const explanation =
    stoppedReason === "passed"
      ? `Progressive routing: ${initialModel.modelId} → success on ${finalModel?.modelId} (${attempts.length} attempt(s)).`
      : stoppedReason === "thrashing_prevented"
        ? `Progressive routing stopped: ${escalationReason ?? "thrashing guard"}.`
        : `Progressive routing: all ${attempts.length} attempt(s) failed success criteria.`;

  return {
    policy: "experimental_progressive_routing",
    enabled: true,
    initialModel,
    finalModel,
    evaluationResult,
    escalatedFrom: stoppedReason === "passed" && attempts.length === 1 ? null : escalatedFrom,
    escalatedTo: stoppedReason === "passed" && attempts.length === 1 ? null : escalatedTo,
    escalationReason: stoppedReason === "passed" && attempts.length === 1 ? null : escalationReason,
    attempts,
    stoppedReason,
    explanation,
  };
}
