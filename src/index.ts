export { evaluateGate } from "./gate.js";
export {
  currentModelMeetsTask,
  higherTier,
  limitsForTier,
  loadDefaultCapabilities,
  mergeCapabilities,
  profileMeetsFeatures,
  resolveCapabilityProfile,
  selectCapableTier,
  tierMeetsMinimum,
} from "./capabilities.js";
export { loadRoutingCapabilities, routeForTask } from "./router.js";
export type { RouteInput, RoutingDecision } from "./router.js";
export { routeByCapabilities } from "./capability-router.js";
export type { CapabilityRouteInput, CapabilityRouteResult, RoutingPolicy } from "./capability-router.js";
export {
  filterCapableModels,
  modelMeetsRequirements,
  requirementAxes,
} from "./capability-matching.js";
export type { CapabilityMatchResult, RequirementAxisSpec } from "./capability-matching.js";
export {
  extractContextRequirements,
  extractRoutingRequirements,
  extractTaskRoutingRequirements,
} from "./routing-requirements.js";
export type { ContextRequirements, RoutingRequirements } from "./routing-requirements.js";
export {
  findModelProfile,
  listProviderModels,
  loadDefaultModelProfiles,
  mergeModelProfiles,
} from "./model-profiles.js";
export type {
  CatalogModelProfile,
  ModelCapabilityVector,
  ModelProfileCatalog,
} from "./model-profiles.js";
export { evaluateRoutingConfidence } from "./routing-confidence.js";
export type {
  RoutingConfidenceInput,
  RoutingConfidenceResult,
} from "./routing-confidence.js";
export {
  assessRoutingUncertainty,
  DEFAULT_ROUTING_UNCERTAINTY_CONFIG,
} from "./routing-uncertainty.js";
export type {
  ClarificationRequest,
  ConfidenceDimensions,
  RoutingState,
  RoutingUncertaintyAssessment,
  RoutingUncertaintyConfig,
  RoutingUncertaintyInput,
} from "./routing-uncertainty.js";
export type {
  CapabilityCatalog,
  CapabilityLimits,
  CapabilityOverride,
  ModelCapabilityProfile,
} from "./capabilities.js";
export {
  analyzeTask,
  hasDeepSignals,
  minimumCapabilityForAnalysis,
  scoreTaskDifficultyFromMessage,
} from "./task-analyzer.js";
export type {
  TaskAnalysis,
  TaskAnalysisCore,
  TaskAnalyzerInput,
  TaskCategory,
  TaskFeatureVector,
  TaskIntent,
} from "./task-analyzer.js";
export {
  buildTaskContract,
  defaultSuccessCriteria,
  deriveObjective,
  deriveRequirements,
  deriveUnderstandingConfidence,
  extractConstraints,
  inferRiskLevel,
  isAnalyticalTask,
  isUnderspecifiedUserMessage,
  resolveContractTaskType,
  resolveSuccessSpecId,
} from "./task-contract.js";
export type {
  RiskLevel,
  TaskContract,
  TaskContractInput,
  TaskRequirements,
  TaskType,
  TaskUnderstandingConfidence,
} from "./task-contract.js";
export type { SuccessCriterion, SuccessCriterionType, TaskSuccessSpecification } from "./success-criteria.js";
export {
  buildTaskSuccessSpecification,
  criteriaForSpec,
  loadDefaultSuccessCriteriaCatalog,
  mergeSuccessCriteriaCatalog,
  optionalCriteria,
  parseSuccessSpecification,
  parseSuccessSpecificationJson,
  requiredCriteria,
  serializeSuccessSpecification,
  serializeSuccessSpecificationJson,
} from "./success-criteria.js";
export type {
  SerializedTaskSuccessSpecification,
  SuccessCriteriaCatalog,
  SuccessSpecId,
} from "./success-criteria.js";
export {
  assertAdversarialSuite,
  formatAdversarialMarkdown,
  loadAdversarialSuite,
  runAdversarialCase,
  runAdversarialSuite,
} from "./adversarial.js";
export type {
  AdversarialCase,
  AdversarialCaseResult,
  AdversarialKind,
  AdversarialReport,
  AdversarialSuite,
} from "./adversarial.js";
export {
  assertEvaluation,
  formatEvaluationMarkdown,
  runEvaluation,
} from "./evaluation.js";
export type { EvaluationReport, RunEvaluationOptions } from "./evaluation.js";
export {
  assertBenchmarkExpectations,
  benchmarkFixture,
  formatBenchmarkMarkdown,
  gateExpectationMet,
  loadFixtureSuite,
  loadSuccessRates,
  runBenchmarkSuite,
} from "./benchmark.js";
export type {
  BenchmarkFixture,
  BenchmarkReport,
  FixtureBenchmarkResult,
  TierBenchmarkCell,
} from "./benchmark.js";
export {
  contextReductionPercent,
  estimateEffectiveInputTokens,
  formatScopedIngestHint,
  requiresScopedIngest,
  scopedRetentionFraction,
} from "./ingest-scope.js";
export {
  buildSwitchCostEstimate,
  estimateOutputTokens,
  estimateTurnCostUsd,
  formatSavingsLine,
  loadDefaultPricing,
  mergePricing,
  resolveTokenRates,
} from "./cost.js";
export type { PricingCatalog, SwitchCostEstimate, TokenRates } from "./cost.js";
export {
  defaultModelForTier,
  loadDefaultCatalog,
  mergeCatalog,
  resolveModel,
  tierDisplayName,
  tierToLegacyAnthropicTier,
} from "./catalog.js";
export type { CatalogEntry, ModelCatalog, ResolvedModel } from "./catalog.js";
export {
  bandFromTokens,
  bytesToTokens,
  estimateProbeTokens,
  estimateTotalTokens,
  jiraIssuesToTokens,
  linesToTokens,
  prStatsToTokens,
  resolveContextBand,
} from "./estimate.js";
export {
  buildDowngradeRationale,
  buildScopedIngestPlan,
  buildUpgradeRationale,
  classifyTask,
  needsPremiumUpgrade,
  pickDowngradeTier,
  pickUpgradeTier,
  scoreIngestComplexity,
  scoreTaskDifficulty,
  summarizeTask,
  taskClassFromDifficulty,
} from "./classify.js";
export { SUGGEST_MODEL_SWITCH_TOOL, handleSuggestModelSwitch } from "./tool-schema.js";
export type {
  CapabilityTier,
  Confidence,
  ContextBand,
  ContextProbe,
  ContextSource,
  GateAction,
  GateDecision,
  ContextOptimization,
  GateInput,
  GateScores,
  ModelTier,
  Provider,
  SwitchDirection,
  SuggestModelSwitchInput,
  SuggestModelSwitchResult,
  TaskClass,
} from "./types.js";
