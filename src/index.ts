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
export {
  buildQualityAssurance,
  buildRoutingRecommendation,
  deriveQualityGuarantee,
  resolveEffectiveRecommendation,
  resolveEvidenceStatusForSpec,
} from "./routing-assurance.js";
export type {
  EffectiveRecommendationBasis,
  EffectiveRoutingRecommendation,
  QualityAssurance,
  QualityGuarantee,
  QualityGuaranteeLevel,
  RoutingRecommendation,
} from "./routing-assurance.js";
export {
  DEFAULT_QUALITY_CONSTRAINED_POLICY,
  deriveRequiredQuality,
  executeQualityConstrainedRouting,
} from "./quality-constrained-policy.js";
export {
  DEFAULT_PROGRESSIVE_ROUTING_CONFIG,
  EXPERIMENTAL_PROGRESSIVE_ROUTING_ENABLED,
  executeExperimentalProgressiveRouting,
} from "./progressive-routing.js";
export type {
  ProgressiveRoutingAttempt,
  ProgressiveRoutingConfig,
  ProgressiveRoutingEvaluation,
  ProgressiveRoutingInput,
  ProgressiveRoutingResult,
  ProgressiveRoutingStopReason,
  ProgressiveModelExecutor,
} from "./progressive-routing.js";
export type {
  QualityConstrainedPolicyConfig,
  QualityConstrainedRoutingInput,
  QualityConstrainedRoutingResult,
  QualityConstrainedCandidate,
} from "./quality-constrained-policy.js";
export {
  buildQualityEvidenceFromFixtures,
  buildQualityEvidenceIndex,
  buildRoutingQualityEvidence,
  loadDefaultQualityEvidence,
  lookupQualityEvidence,
  mergeLiveRunsIntoEvidenceIndex,
  resetQualityEvidenceCache,
} from "./quality-evidence.js";
export type {
  EvidenceSource,
  EvidenceStatus,
  QualityEvidenceIndex,
  QualityEvidenceRecord,
  QualityEvidenceRun,
} from "./quality-evidence.js";
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
  ADVERSARIAL_TRAPS,
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
  AdversarialTrap,
} from "./adversarial.js";
export {
  assertEvaluation,
  formatEvaluationMarkdown,
  runEvaluation,
} from "./evaluation.js";
export type { EvaluationReport, RunEvaluationOptions } from "./evaluation.js";
export {
  formatTaskQualityMarkdown,
  loadDomainBenchmarkSuites,
  loadTaskQualityFixtures,
  resetTaskQualityFixturesCache,
  BENCHMARK_DOMAIN_DIRS,
  runTaskQualityEvaluation,
  runHeldOutBenchmarkEvaluation,
  evaluateTaskCandidate,
  evaluateTaskCase,
  evaluateOutputAgainstCriteria,
  TASK_QUALITY_FRAMEWORK_VERSION,
} from "./task-quality/index.js";
export type {
  EvaluationResult,
  TaskCase,
  TaskQualityReport,
  CriterionEvaluationResult,
} from "./task-quality/index.js";
export {
  assertBenchmarkExpectations,
  benchmarkFixture,
  formatBenchmarkMarkdown,
  gateExpectationMet,
  inputTokensForCost,
  loadFixtureSuite,
  loadSuccessRates,
  runBenchmarkSuite,
  turnCostUsd,
  hasAssumedSuccessRateCategory,
  assumedSuccessRateForCategory,
} from "./benchmark.js";
export type {
  BenchmarkFixture,
  BenchmarkReport,
  FixtureBenchmarkResult,
  TierBenchmarkCell,
} from "./benchmark.js";
export {
  formatRouterBenchmarkMarkdown,
  loadRouterBenchmarkManifest,
  loadRouterBenchmarkWorkload,
  premiumBaselineModelId,
  runRouterBenchmark,
  classifyRoutingDecision,
  evaluateRouterBenchmarkTask,
  aggregateStrategyQualityMetrics,
  resolveTaskQualityOutcome,
} from "./router-benchmark.js";
export type {
  RouterBenchmarkReport,
  RouterBenchmarkTask,
  RouterBenchmarkTaskResult,
  RoutingDecisionKind,
  RunRouterBenchmarkOptions,
  StrategyQualityMetrics,
  TaskQualityBasis,
  TaskQualityOutcome,
} from "./router-benchmark.js";
export {
  compareLiveHoldoutBaselineVsRouter,
  formatLiveHoldoutComparisonMarkdown,
  MIN_PAIRED_HOLDOUT_SAMPLES,
} from "./live-holdout-benchmark.js";
export type {
  CompareLiveHoldoutOptions,
  LiveHoldoutComparisonReport,
  LiveHoldoutPairedComparison,
  LiveHoldoutStrategyMetrics,
  LiveHoldoutTaskComparison,
  LiveRunSummary,
} from "./live-holdout-benchmark.js";
export {
  contextReductionPercent,
  estimateEffectiveInputTokens,
  formatScopedIngestHint,
  requiresScopedIngest,
  scopedRetentionFraction,
} from "./ingest-scope.js";
export {
  assessPricingFreshness,
  buildSwitchCostEstimate,
  estimateOutputTokens,
  estimateTurnCostUsd,
  formatPricingAuditText,
  formatSavingsLine,
  loadDefaultPricing,
  mergePricing,
  PRICING_STALE_AFTER_DAYS,
  resetPricingCache,
  resolveTokenRates,
  summarizePricingCatalogAudit,
  validatePricingCatalog,
} from "./cost.js";
export type {
  PricingCatalog,
  PricingCatalogAuditSummary,
  PricingCatalogMetadata,
  PricingFreshnessAssessment,
  SwitchCostEstimate,
  TokenRates,
} from "./cost.js";
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
export {
  buildDecisionTrace,
  formatDecisionTraceText,
  gateDecisionWithTrace,
} from "./decision-trace.js";
export type {
  DecisionTrace,
  DecisionTraceCost,
  DecisionTraceModel,
  DecisionTraceQualityEvidence,
  TraceDecisionLabel,
} from "./decision-trace.js";
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
