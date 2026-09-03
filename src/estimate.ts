import type { ContextBand, ContextProbe, ContextSource } from "./types.js";

const BAND_SMALL_MAX = 30_000;
const BAND_MEDIUM_MAX = 80_000;

export function normalizeModelTier(model: string): "opus" | "sonnet" | "haiku" | "unknown" {
  const m = model.toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return "unknown";
}

export function bytesToTokens(bytes: number, source: ContextSource = "other"): number {
  const divisor =
    source === "log_file" || source === "database_dump" || source === "csv_export"
      ? 4
      : source === "json_export"
        ? 3.5
        : 4;
  return Math.ceil(bytes / divisor);
}

export function linesToTokens(lines: number): number {
  return lines * 40;
}

export function prStatsToTokens(
  additions: number,
  deletions: number,
  changedFiles: number,
): number {
  return (additions + deletions) * 15 + changedFiles * 500;
}

export function jiraIssuesToTokens(issueCount: number): number {
  return issueCount * 400;
}

export function estimateProbeTokens(probe: ContextProbe): number {
  const estimates: number[] = [];

  if (probe.bytes != null && probe.bytes > 0) {
    estimates.push(bytesToTokens(probe.bytes, probe.source));
  }
  if (probe.lines != null && probe.lines > 0) {
    estimates.push(linesToTokens(probe.lines));
  }
  if (probe.additions != null || probe.deletions != null || probe.changedFiles != null) {
    estimates.push(
      prStatsToTokens(probe.additions ?? 0, probe.deletions ?? 0, probe.changedFiles ?? 0),
    );
  }
  if (probe.issueCount != null && probe.issueCount > 0) {
    estimates.push(jiraIssuesToTokens(probe.issueCount));
  }

  return estimates.length > 0 ? Math.max(...estimates) : 0;
}

export function estimateTotalTokens(probes: ContextProbe[]): number {
  if (probes.length === 0) return 0;
  return probes.reduce((sum, probe) => sum + estimateProbeTokens(probe), 0);
}

export function bandFromTokens(tokens: number): ContextBand {
  if (tokens < BAND_SMALL_MAX) return "small";
  if (tokens <= BAND_MEDIUM_MAX) return "medium";
  return "large";
}

export function isLargeProbe(probe: ContextProbe): boolean {
  if (probe.changedFiles != null && probe.changedFiles > 20) return true;
  if (probe.additions != null && probe.deletions != null) {
    if (probe.additions + probe.deletions > 2000) return true;
  }
  if (probe.bytes != null && probe.bytes > 500_000) return true;
  if (probe.lines != null && probe.lines > 10_000) return true;
  if (probe.issueCount != null && probe.issueCount > 30) return true;
  return false;
}

export function bumpBand(band: ContextBand): ContextBand {
  if (band === "small") return "medium";
  if (band === "medium") return "large";
  return "large";
}

export function resolveContextBand(probes: ContextProbe[], totalTokens: number): ContextBand {
  let band = bandFromTokens(totalTokens);
  if (probes.some(isLargeProbe)) {
    band = bumpBand(band);
  }
  return band;
}
