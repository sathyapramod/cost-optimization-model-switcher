#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertBenchmarkExpectations,
  formatBenchmarkMarkdown,
  runBenchmarkSuite,
} from "../dist/benchmark.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "benchmarks", "results");
mkdirSync(outDir, { recursive: true });

const report = runBenchmarkSuite();
const jsonPath = join(outDir, "latest.json");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

try {
  assertBenchmarkExpectations(report);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const md = formatBenchmarkMarkdown(report);
writeFileSync(join(outDir, "latest.md"), `${md}\n`);
console.log(md);
console.log(`\nWrote ${jsonPath}`);
