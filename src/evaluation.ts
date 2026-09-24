import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAdversarialSuite,
  formatAdversarialMarkdown,
  runAdversarialSuite,
  type AdversarialReport,
} from "./adversarial.js";
import {
  assertBenchmarkExpectations,
  formatBenchmarkMarkdown,
  runBenchmarkSuite,
  type BenchmarkReport,
} from "./benchmark.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

export interface EvaluationReport {
  generatedAt: string;
  routerVersion: string;
  benchmark: BenchmarkReport;
  adversarial: AdversarialReport;
  summary: {
    passed: boolean;
    benchmarkFailures: number;
    adversarialFailures: number;
    totalChecks: number;
  };
}

function readRouterVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ) as { version: string };
    return pkg.version;
  } catch {
    return "unknown";
  }
}

export interface RunEvaluationOptions {
  fixturesPath?: string;
  successRatesPath?: string;
  adversarialPath?: string;
}

/** V2 evaluation framework (#15): regression benchmarks + adversarial suite (#16). */
export function runEvaluation(options?: RunEvaluationOptions): EvaluationReport {
  const benchmark = runBenchmarkSuite({
    fixturesPath: options?.fixturesPath,
    successRatesPath: options?.successRatesPath,
  });
  const adversarial = runAdversarialSuite(options?.adversarialPath);

  const benchmarkFailures = benchmark.summary.expectationFailures;
  const adversarialFailures = adversarial.summary.failed;

  return {
    generatedAt: new Date().toISOString(),
    routerVersion: readRouterVersion(),
    benchmark,
    adversarial,
    summary: {
      passed: benchmarkFailures === 0 && adversarialFailures === 0,
      benchmarkFailures,
      adversarialFailures,
      totalChecks:
        benchmark.summary.fixtureCount * 3 +
        adversarial.summary.caseCount,
    },
  };
}

export function assertEvaluation(report: EvaluationReport): void {
  assertBenchmarkExpectations(report.benchmark);
  assertAdversarialSuite(report.adversarial);
}

export function formatEvaluationMarkdown(report: EvaluationReport): string {
  const header = [
    "# Router evaluation report",
    "",
    `Generated: ${report.generatedAt}`,
    `Router version: ${report.routerVersion}`,
    `Overall: ${report.summary.passed ? "PASS" : "FAIL"}`,
    `Benchmark failures: ${report.summary.benchmarkFailures} | Adversarial failures: ${report.summary.adversarialFailures}`,
    "",
  ].join("\n");

  return `${header}${formatBenchmarkMarkdown(report.benchmark)}\n\n${formatAdversarialMarkdown(report.adversarial)}`;
}
