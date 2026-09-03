import type { ContextSource, ModelTier, TaskClass } from "./types.js";

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

export function pickRecommendedModel(
  userMessage: string,
  source: ContextSource,
): Exclude<ModelTier, "opus"> {
  const text = userMessage.toLowerCase();
  const wantsThorough = /\bthorough\b|\bdetailed\b|\bnuanced\b/.test(text);

  const diffHeavy =
    source === "github_pr" &&
    (/\breview\b|\bbugs?\b|\bfindings?\b|\bregressions?\b/.test(text) || wantsThorough);

  if (diffHeavy) return "sonnet";
  return "haiku";
}

export function defaultModelId(tier: Exclude<ModelTier, "opus">): string {
  if (tier === "sonnet") return "claude-sonnet-4-6";
  return "claude-haiku-4-5";
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

export function buildRationale(
  recommended: Exclude<ModelTier, "opus">,
  tokens: number,
  taskClass: TaskClass,
): string {
  const savings = recommended === "haiku" ? "5–15×" : "3–8×";
  return (
    `${taskClass} task over ~${Math.round(tokens / 1000)}k input tokens; ${recommended} typically ` +
    `handles this at ~${savings} lower input cost than Opus.`
  );
}
