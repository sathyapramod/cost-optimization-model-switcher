import type { ContextBand, ContextProbe, ContextSource, TaskClass } from "./types.js";
import { isLargeProbe } from "./estimate.js";

/** Fraction of raw tokens expected to remain after scoped ingest (ponytail: fixed heuristics; tune via #6 benchmarks). */
export function scopedRetentionFraction(
  source: ContextSource,
  taskClass: TaskClass,
): number {
  switch (source) {
    case "log_file":
      return taskClass === "straightforward" ? 0.1 : 0.25;
    case "database_dump":
    case "csv_export":
    case "json_export":
      return taskClass === "straightforward" ? 0.12 : 0.35;
    case "github_pr":
      return taskClass === "straightforward" ? 0.35 : 0.55;
    case "jira":
      return 0.2;
    case "paste":
      return 0.4;
    default:
      return 0.5;
  }
}

export function estimateEffectiveInputTokens(
  rawTokens: number,
  source: ContextSource,
  taskClass: TaskClass,
): number {
  if (rawTokens <= 0) return 0;
  const fraction = scopedRetentionFraction(source, taskClass);
  const scoped = Math.ceil(rawTokens * fraction);
  const floor = taskClass === "straightforward" ? 1_500 : 4_000;
  return Math.min(rawTokens, Math.max(scoped, floor));
}

export function contextReductionPercent(rawTokens: number, effectiveTokens: number): number {
  if (rawTokens <= 0) return 0;
  return Math.round((1 - effectiveTokens / rawTokens) * 100);
}

export function requiresScopedIngest(
  probes: ContextProbe[],
  band: ContextBand,
  rawTokens: number,
): boolean {
  if (probes.some(isLargeProbe)) return true;
  if (band === "medium" || band === "large") return true;
  return rawTokens >= 30_000;
}

export function formatScopedIngestHint(
  rawTokens: number,
  effectiveTokens: number,
  reductionPercent: number,
): string {
  if (rawTokens <= 0 || reductionPercent < 10) return "";
  return (
    ` After scoped ingest: ~${Math.round(effectiveTokens / 1000)}k input tokens` +
    ` (~${reductionPercent}% reduction vs full ingest).`
  );
}
