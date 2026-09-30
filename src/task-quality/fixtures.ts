import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDomainBenchmarkSuites,
  mergeTaskQualitySuites,
} from "./domain-benchmark-loader.js";
import type { TaskQualityFixtureSuite } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPath = join(__dirname, "..", "..", "benchmarks", "task-quality", "fixtures.json");

let cached: TaskQualityFixtureSuite | null = null;

export function loadTaskQualityFixtures(
  path = defaultPath,
): TaskQualityFixtureSuite {
  if (path === defaultPath && cached) return cached;

  let suite: TaskQualityFixtureSuite;
  if (path === defaultPath) {
    const legacy = JSON.parse(readFileSync(defaultPath, "utf8")) as TaskQualityFixtureSuite;
    const { cases: domainCases } = loadDomainBenchmarkSuites();
    suite = mergeTaskQualitySuites(legacy, domainCases);
  } else {
    suite = JSON.parse(readFileSync(path, "utf8")) as TaskQualityFixtureSuite;
  }

  if (path === defaultPath) cached = suite;
  return suite;
}

/** Clear merged fixture cache (tests). */
export function resetTaskQualityFixturesCache(): void {
  cached = null;
}
