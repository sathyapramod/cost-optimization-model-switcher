#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatRouterBenchmarkMarkdown,
  runRouterBenchmark,
} from "../dist/router-benchmark.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "benchmarks", "results");
mkdirSync(outDir, { recursive: true });

const report = runRouterBenchmark();
const jsonPath = join(outDir, "router-benchmark.json");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

const md = formatRouterBenchmarkMarkdown(report);
const mdPath = join(outDir, "router-benchmark.md");
writeFileSync(mdPath, `${md}\n`);

console.log(md);
console.log(`\nWrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
