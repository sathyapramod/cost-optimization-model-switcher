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

export function classifyTask(userMessage: string): TaskClass {
  const text = userMessage.trim();
  if (!text) return "complex";

  const straightforward = STRAIGHTFORWARD_PATTERNS.some((re) => re.test(text));
  const complex = COMPLEX_PATTERNS.some((re) => re.test(text));

  if (straightforward && complex) return "complex";
  if (straightforward) return "straightforward";
  return "complex";
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

export function needsPremiumUpgrade(userMessage: string, band: ContextBand): boolean {
  const text = userMessage.toLowerCase();
  const deep =
    /\barchitect(ure)?\b|\bmigrat(e|ion)\b|\bsecurity audit\b|\bexploit\b|\bmulti[- ]service\b/.test(
      text,
    );
  return deep || band !== "small";
}

/** Upgrade target from fast/balanced when task is complex. */
export function pickUpgradeTier(
  currentTier: Exclude<CapabilityTier, "premium">,
  userMessage: string,
  band: ContextBand,
): CapabilityTier {
  if (needsPremiumUpgrade(userMessage, band)) return "premium";
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
      return "Fetch PR file list and diff stat first; load only changed files relevant to the review scope.";
    case "jira":
      return refs.length
        ? `Filter to issues: ${refs.slice(0, 5).join(", ")}${refs.length > 5 ? ", …" : ""}.`
        : "Apply JQL filter to sprint or label before full board export.";
    case "log_file":
      return "grep error/fatal patterns or tail last 500 lines before full-file summarize.";
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
