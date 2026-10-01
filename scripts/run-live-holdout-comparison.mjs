#!/usr/bin/env node
/**
 * Offline report: compares premium baseline vs router-selected model on HOLDOUT tasks
 * using already-recorded live runs (benchmarks/results/live-runs.json).
 *
 * Reads recorded data only — never calls a provider API — so no API key is required.
 * Populate live-runs.json first with:
 *   npm run evaluate:live -- --split holdout --model <premium-model-id>
 *   npm run evaluate:live -- --split holdout --model <router-selected-model-id>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareLiveHoldoutBaselineVsRouter,
  formatLiveHoldoutComparisonMarkdown,
} from "../dist/live-holdout-benchmark.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "benchmarks", "results");
mkdirSync(outDir, { recursive: true });

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i === process.argv.length - 1) return undefined;
  return process.argv[i + 1];
}

const provider = argValue("--provider") ?? "anthropic";

const report = compareLiveHoldoutBaselineVsRouter({ provider });

const jsonPath = join(outDir, "live-holdout-comparison.json");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

const md = formatLiveHoldoutComparisonMarkdown(report);
const mdPath = join(outDir, "live-holdout-comparison.md");
writeFileSync(mdPath, `${md}\n`);

console.log(md);
console.log(`\nWrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
