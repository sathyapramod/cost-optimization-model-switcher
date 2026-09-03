export { evaluateGate } from "./gate.js";
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
  summarizeTask,
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
  GateInput,
  ModelTier,
  Provider,
  SwitchDirection,
  SuggestModelSwitchInput,
  SuggestModelSwitchResult,
  TaskClass,
} from "./types.js";
