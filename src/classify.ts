import type { CapabilityTier, ContextBand, ContextSource, Provider, TaskClass } from "./types.js";
import { tierDisplayName } from "./catalog.js";

const STRAIGHTFORWARD_PATTERNS = [
  /\bsummari[sz]e\b/i,
  /\btl;?dr\b/i,
  /\bexecutive summary\b/i,
  /\bformat\b/i,
  /\bre-?structure\b/i,
  /\bconvert to\b/i,
  /\breview (the )?(pr|diff|changes)\b/i,
  /\blist (all )?(bugs?|issues?|findings?|blockers?)\b/i,
  /\bextract\b/i,
  /\btriage\b/i,
  /\bclassif(y|ication)\b/i,
  /\bcategoriz(e|ation)\b/i,
  /\bwhat changed\b/i,
  /\bhighlight regressions?\b/i,
  /\baction items?\b/i,
  /\btag\b/i,
  /\bany blockers?\b/i,
];

const DEEP_SIGNAL_PATTERN =
  /\barchitect(ure)?\b|\bmigrat(e|ion)\b|\bsecurity audit\b|\bexploit\b|\bmulti[- ]service\b/i;

const COMPLEX_PATTERNS = [
  /\barchitect(ure)?\b/i,
  /\bdesign\b/i,
  /\bmigrat(e|ion)\b/i,
  /\broot[- ]cause\b/i,
  /\bdebug\b/i,
  /\bfix\b/i,
  /\bimplement\b/i,
  /\brefactor\b/i,
  /\bwrite (the )?code\b/i,
  /\bsecurity audit\b/i,
  /\bexploit\b/i,
  /\bnovel\b/i,
  /\bmulti[- ]step\b/i,
  /\bplan the\b/i,
];

function clampScore(n: number): number {
  return Math.max(0, Math.min(5, n));
}

export function hasDeepSignals(userMessage: string): boolean {
  return DEEP_SIGNAL_PATTERN.test(userMessage);
}

/** Reasoning / code-change difficulty from the user message only (not context size). */
export function scoreTaskDifficulty(userMessage: string): number {
  const text = userMessage.trim();
  if (!text) return 5;

  let score = 1;
  const straightHits = STRAIGHTFORWARD_PATTERNS.filter((re) => re.test(text)).length;
  const complexHits = COMPLEX_PATTERNS.filter((re) => re.test(text)).length;

  score += complexHits;
  score -= Math.min(straightHits, 2);
  if (hasDeepSignals(text)) score += 2;
  if (straightHits > 0 && complexHits > 0) score = Math.max(score, 3);

  return clampScore(score);
}

/** Ingest size / external context heaviness (from probes, not task verbs). */
export function scoreIngestComplexity(
  band: ContextBand,
  estimatedInputTokens: number,
): number {
  if (band === "large") return 5;
  if (band === "medium") return 3;
  if (estimatedInputTokens > 0) return 1;
  return 0;
}

export function taskClassFromDifficulty(taskDifficulty: number): TaskClass {
  return taskDifficulty <= 1 ? "straightforward" : "complex";
}

export function classifyTask(userMessage: string): TaskClass {
  return taskClassFromDifficulty(scoreTaskDifficulty(userMessage));
}

export function inferPrimarySource(probes: { source: ContextSource }[]): ContextSource {
  if (probes.length === 0) return "other";
  const priority: ContextSource[] = [
    "github_pr",
    "jira",
    "log_file",
    "database_dump",
    "csv_export",
    "json_export",
    "paste",
    "other",
  ];
  for (const source of priority) {
    if (probes.some((p) => p.source === source)) return source;
  }
  return probes[0]!.source;
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
  const text = userMessage.toLowerCase();
  const wantsThorough = /\bthorough\b|\bdetailed\b|\bnuanced\b/.test(text);

  const diffHeavy =
    source === "github_pr" &&
    (/\breview\b|\bbugs?\b|\bfindings?\b|\bregressions?\b/.test(text) || wantsThorough);

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
