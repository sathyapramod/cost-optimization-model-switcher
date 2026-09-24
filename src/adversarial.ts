import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateExpectationMet, type FixtureExpectation } from "./benchmark.js";
import { evaluateGate } from "./gate.js";
import type { ContextProbe, GateDecision, Provider } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

export type AdversarialKind = "false_positive" | "false_negative";

export interface AdversarialCase {
  id: string;
  kind: AdversarialKind;
  description: string;
  currentModel: string;
  provider?: Provider;
  userMessage: string;
  probes?: ContextProbe[];
  userOptedOut?: boolean;
  expect: FixtureExpectation;
}

export interface AdversarialSuite {
  version: string;
  provider: Provider;
  note?: string;
  cases: AdversarialCase[];
}

export interface AdversarialCaseResult {
  id: string;
  kind: AdversarialKind;
  description: string;
  passed: boolean;
  decision: GateDecision;
}

export interface AdversarialReport {
  generatedAt: string;
  provider: Provider;
  results: AdversarialCaseResult[];
  summary: {
    caseCount: number;
    failed: number;
    falsePositiveFailures: number;
    falseNegativeFailures: number;
  };
}

export function loadAdversarialSuite(
  path = join(repoRoot, "benchmarks", "adversarial.json"),
): AdversarialSuite {
  return JSON.parse(readFileSync(path, "utf8")) as AdversarialSuite;
}

export function runAdversarialCase(
  case_: AdversarialCase,
  defaultProvider: Provider,
): AdversarialCaseResult {
  const decision = evaluateGate({
    currentModel: case_.currentModel,
    provider: case_.provider ?? defaultProvider,
    userMessage: case_.userMessage,
    probes: case_.probes,
    userOptedOut: case_.userOptedOut,
  });
  const passed = gateExpectationMet(decision, case_.expect) === true;
  return {
    id: case_.id,
    kind: case_.kind,
    description: case_.description,
    passed,
    decision,
  };
}

export function runAdversarialSuite(
  path?: string,
): AdversarialReport {
  const suite = loadAdversarialSuite(path);
  const results = suite.cases.map((c) => runAdversarialCase(c, suite.provider));

  let failed = 0;
  let falsePositiveFailures = 0;
  let falseNegativeFailures = 0;
  for (const r of results) {
    if (r.passed) continue;
    failed++;
    if (r.kind === "false_positive") falsePositiveFailures++;
    else falseNegativeFailures++;
  }

  return {
    generatedAt: new Date().toISOString(),
    provider: suite.provider,
    results,
    summary: {
      caseCount: results.length,
      failed,
      falsePositiveFailures,
      falseNegativeFailures,
    },
  };
}

export function assertAdversarialSuite(report: AdversarialReport): void {
  if (report.summary.failed > 0) {
    const ids = report.results.filter((r) => !r.passed).map((r) => r.id);
    throw new Error(
      `Adversarial suite failed: ${report.summary.failed} case(s) [${ids.join(", ")}]`,
    );
  }
}

export function formatAdversarialMarkdown(report: AdversarialReport): string {
  const lines = [
    "## Adversarial router checks",
    "",
    `Generated: ${report.generatedAt}`,
    `Cases: ${report.summary.caseCount} | Failed: ${report.summary.failed}`,
    `False-positive failures: ${report.summary.falsePositiveFailures} | False-negative failures: ${report.summary.falseNegativeFailures}`,
    "",
    "| Id | Kind | Pass | Gate action |",
    "|----|------|------|-------------|",
  ];
  for (const r of report.results) {
    const tier =
      r.decision.action === "suggest_switch"
        ? r.decision.suggestSwitch?.recommended_capability_tier
        : "—";
    lines.push(
      `| ${r.id} | ${r.kind} | ${r.passed ? "yes" : "**no**"} | ${r.decision.action}${tier ? ` → ${tier}` : ""} |`,
    );
  }
  return lines.join("\n");
}
