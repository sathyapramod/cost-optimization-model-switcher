#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatTaskQualityMarkdown,
  runTaskQualityEvaluation,
} from "../dist/task-quality/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "benchmarks", "results");
mkdirSync(outDir, { recursive: true });

const report = runTaskQualityEvaluation();
const jsonPath = join(outDir, "task-quality-latest.json");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

const md = formatTaskQualityMarkdown(report);
const mdPath = join(outDir, "task-quality-latest.md");
writeFileSync(mdPath, `${md}\n`);

console.log(md);
console.log(`\nWrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
