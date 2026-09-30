import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskQualityFixtureSuite } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPath = join(__dirname, "..", "..", "benchmarks", "task-quality", "fixtures.json");

let cached: TaskQualityFixtureSuite | null = null;

export function loadTaskQualityFixtures(
  path = defaultPath,
): TaskQualityFixtureSuite {
  if (path === defaultPath && cached) return cached;
  const suite = JSON.parse(readFileSync(path, "utf8")) as TaskQualityFixtureSuite;
  if (path === defaultPath) cached = suite;
  return suite;
}
