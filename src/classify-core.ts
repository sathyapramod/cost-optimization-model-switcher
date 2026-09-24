import type { ContextBand, ContextSource, TaskClass } from "./types.js";

export function clampScore(n: number): number {
  return Math.max(0, Math.min(5, n));
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
