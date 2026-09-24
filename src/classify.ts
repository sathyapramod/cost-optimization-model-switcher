import {
  inferPrimarySource,
  scoreIngestComplexity,
  taskClassFromDifficulty,
} from "./classify-core.js";
import {
  analyzeTask,
  hasDeepSignals,
  scoreTaskDifficultyFromMessage,
} from "./task-analyzer.js";
import type { CapabilityTier, ContextBand, ContextSource, Provider, TaskClass } from "./types.js";
import { tierDisplayName } from "./catalog.js";

export { inferPrimarySource, scoreIngestComplexity, taskClassFromDifficulty } from "./classify-core.js";
export { hasDeepSignals } from "./task-analyzer.js";

/** Reasoning / code-change difficulty from the user message only (not context size). */
export function scoreTaskDifficulty(userMessage: string): number {
  return scoreTaskDifficultyFromMessage(userMessage);
}

export function classifyTask(userMessage: string): TaskClass {
  return analyzeTask({ userMessage }).taskClass;
}

export function needsPremiumUpgrade(
  userMessage: string,
  band: ContextBand,
  taskDifficulty?: number,
): boolean {
  const taskScore = taskDifficulty ?? scoreTaskDifficulty(userMessage);
  const ingestScore = scoreIngestComplexity(band, 0);
  if (hasDeepSignals(userMessage)) return true;
  if (taskScore >= 4) return true;
  if (taskScore >= 2 && ingestScore >= 3) return true;
  return false;
}

/** Upgrade target from fast/balanced when task is complex. */
export function pickUpgradeTier(
  currentTier: Exclude<CapabilityTier, "premium">,
  userMessage: string,
  band: ContextBand,
  taskDifficulty?: number,
): CapabilityTier {
  if (needsPremiumUpgrade(userMessage, band, taskDifficulty)) return "premium";
  if (currentTier === "fast") return "balanced";
  return "premium";
}

export function pickDowngradeTier(
  userMessage: string,
  source: ContextSource,
): Exclude<CapabilityTier, "premium"> {
  const analysis = analyzeTask({ userMessage, probes: [{ source }] });
  const text = userMessage.toLowerCase();

  const diffHeavy =
    source === "github_pr" &&
    (analysis.intents.includes("review") ||
      /\bbugs?\b|\bfindings?\b|\bregressions?\b/.test(text) ||
      analysis.flags.wantsThoroughReview);

  if (diffHeavy) return "balanced";
  return "fast";
}

/** @deprecated Use needsPremiumUpgrade */
export const needsOpusUpgrade = needsPremiumUpgrade;

/** @deprecated Use pickDowngradeTier */
export function pickDowngradeModel(
  userMessage: string,
  source: ContextSource,
): "sonnet" | "haiku" {
  const tier = pickDowngradeTier(userMessage, source);
  return tier === "balanced" ? "sonnet" : "haiku";
}

export function summarizeTask(userMessage: string, maxLen = 500): string {
  const oneLine = userMessage.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen - 1)}…`;
}

export function buildScopedIngestPlan(source: ContextSource, refs: string[] = []): string {
  switch (source) {
    case "github_pr":
      return (
        "Run `gh pr view` + diff stat / `--name-only` first; fetch per-file diffs for relevant paths only."
      );
    case "jira":
      return refs.length
        ? `Filter to issues: ${refs.slice(0, 5).join(", ")}${refs.length > 5 ? ", …" : ""}.`
        : "Apply JQL filter to sprint or label before full board export.";
    case "log_file":
      return (
        "Do not read the full file first: run `grep -Ei 'error|fatal|exception|fail' <path>` " +
        "or `tail -n 500 <path>`; expand only if gaps remain."
      );
    case "database_dump":
    case "csv_export":
    case "json_export":
      return "Sample schema and first rows; expand only columns or tables needed for extraction.";
    default:
      return "Scope ingestion to sections needed for the deliverable.";
  }
}

export function buildDowngradeRationale(
  provider: Provider,
  recommended: Exclude<CapabilityTier, "premium">,
  tokens: number,
  taskClass: TaskClass,
): string {
  const savings = recommended === "fast" ? "5–15×" : "3–8×";
  const name = tierDisplayName(recommended, provider);
  const premium = tierDisplayName("premium", provider);
  return (
    `${taskClass} task over ~${Math.round(tokens / 1000)}k input tokens; ${name} typically ` +
    `handles this at ~${savings} lower input cost than ${premium}.`
  );
}

export function buildUpgradeRationale(
  provider: Provider,
  current: Exclude<CapabilityTier, "premium">,
  target: CapabilityTier,
  tokens: number,
): string {
  const targetName = tierDisplayName(target, provider);
  const currentName = tierDisplayName(current, provider);
  const tokenNote =
    tokens > 0 ? ` over ~${Math.round(tokens / 1000)}k input tokens` : "";
  if (target === "balanced") {
    return (
      `Complex task on ${currentName}${tokenNote}; ${targetName} handles implementation ` +
      `and tests with solid reasoning at lower cost than premium tier.`
    );
  }
  return (
    `Complex task on ${currentName}${tokenNote}; ${targetName} provides deeper ` +
    `multi-step reasoning for architecture, migration, and large-context work.`
  );
}
