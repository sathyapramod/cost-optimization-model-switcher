export { evaluateGate } from "./gate.js";
export {
  analyzeTask,
  hasDeepSignals,
  minimumCapabilityForAnalysis,
  scoreTaskDifficultyFromMessage,
} from "./task-analyzer.js";
export type {
  TaskAnalysis,
  TaskAnalyzerInput,
  TaskCategory,
  TaskFeatureVector,
  TaskIntent,
} from "./task-analyzer.js";
export {
  assertBenchmarkExpectations,
  benchmarkFixture,
  formatBenchmarkMarkdown,
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
