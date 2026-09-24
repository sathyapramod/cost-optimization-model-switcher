#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertEvaluation,
  formatEvaluationMarkdown,
  runEvaluation,
} from "../dist/evaluation.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "benchmarks", "results");
mkdirSync(outDir, { recursive: true });

const report = runEvaluation();

try {
  assertEvaluation(report);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const jsonPath = join(outDir, "evaluation-latest.json");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

const md = formatEvaluationMarkdown(report);
writeFileSync(join(outDir, "evaluation-latest.md"), `${md}\n`);
console.log(md);
console.log(`\nWrote ${jsonPath}`);
