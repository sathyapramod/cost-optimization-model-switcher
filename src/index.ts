export { evaluateGate } from "./gate.js";
export {
  bandFromTokens,
  bytesToTokens,
  estimateProbeTokens,
  estimateTotalTokens,
  jiraIssuesToTokens,
  linesToTokens,
  normalizeModelTier,
  prStatsToTokens,
  resolveContextBand,
} from "./estimate.js";
export {
  buildDowngradeRationale,
  buildScopedIngestPlan,
  buildUpgradeRationale,
  classifyTask,
  defaultModelId,
  inferPrimarySource,
  needsOpusUpgrade,
  pickDowngradeModel,
  summarizeTask,
} from "./classify.js";
export { SUGGEST_MODEL_SWITCH_TOOL, handleSuggestModelSwitch } from "./tool-schema.js";
export type {
  Confidence,
  ContextBand,
  ContextProbe,
  ContextSource,
  GateAction,
  GateDecision,
  GateInput,
  ModelTier,
  SwitchDirection,
  SuggestModelSwitchInput,
  SuggestModelSwitchResult,
  TaskClass,
} from "./types.js";
