#!/usr/bin/env node
/**
 * Live benchmark: call a real model API, evaluate with task-contract criteria, append to live-runs.json.
 *
 * Env: ANTHROPIC_API_KEY and/or OPENAI_API_KEY
 *
 * Examples:
 *   npm run evaluate:live -- --provider anthropic --model claude-haiku-4-5
 *   npm run evaluate:live -- --split holdout --domain summarization,coding
 *   npm run evaluate:live -- --dry-run --split holdout
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatLiveBenchmarkMarkdown,
  runLiveBenchmarkEvaluation,
} from "../dist/task-quality/live-evaluation.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "benchmarks", "results");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i === process.argv.length - 1) return undefined;
  return process.argv[i + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

const provider = argValue("--provider") ?? process.env.LIVE_PROVIDER ?? "anthropic";
const modelId =
  argValue("--model") ??
  process.env.LIVE_MODEL ??
  (provider === "anthropic" ? "claude-haiku-4-5" : "gpt-4o-mini");
const split = argValue("--split") ?? "holdout";
const domainsRaw = argValue("--domain");
const caseIdsRaw = argValue("--case");
const maxCases = argValue("--max-cases") ? Number(argValue("--max-cases")) : undefined;
const dryRun = hasFlag("--dry-run");
const replace = hasFlag("--replace");

const domains = domainsRaw ? domainsRaw.split(",").map((s) => s.trim()) : undefined;
const caseIds = caseIdsRaw ? caseIdsRaw.split(",").map((s) => s.trim()) : undefined;

mkdirSync(outDir, { recursive: true });

const report = await runLiveBenchmarkEvaluation({
  target: { provider, modelId },
  benchmarkSplit: split === "all" ? "all" : split,
  domains,
  caseIds,
  maxCases,
  dryRun,
  append: !replace,
});

const md = formatLiveBenchmarkMarkdown(report);
const mdPath = join(outDir, "live-latest.md");
writeFileSync(mdPath, `${md}\n`);
const jsonPath = join(outDir, "live-latest.json");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(md);
console.log(`\nWrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);

if (!dryRun && report.summary.caseCount === 0) {
  console.error("\nNo cases matched — check --split, --domain, or --case filters.");
  process.exit(1);
}

if (!dryRun && report.summary.evaluated === 0 && report.summary.errored > 0) {
  console.error(`\nAll ${report.summary.errored} case(s) errored (e.g. quota/auth) — see table above.`);
  process.exit(1);
}
