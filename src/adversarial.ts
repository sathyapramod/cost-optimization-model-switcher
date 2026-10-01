import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateExpectationMet, type FixtureExpectation } from "./benchmark.js";
import { evaluateGate } from "./gate.js";
import type { ContextProbe, GateDecision, Provider } from "./types.js";
import type { EffectiveRecommendationBasis, QualityGuaranteeLevel } from "./routing-assurance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

export type AdversarialKind = "false_positive" | "false_negative";

/** Why this case exists — maps to Priority 4 trap classes. */
export type AdversarialTrap =
  | "false_downgrade"
  | "false_upgrade"
  | "context_trap"
  | "complexity_trap"
  | "underspecified"
  | "unknown_model"
  | "missing_quality_evidence"
  | "quality_floor"
  | "upgrade"
  | "boundary";

export const ADVERSARIAL_TRAPS: AdversarialTrap[] = [
  "false_downgrade",
  "false_upgrade",
  "context_trap",
  "complexity_trap",
  "underspecified",
  "unknown_model",
  "missing_quality_evidence",
  "quality_floor",
  "upgrade",
  "boundary",
];

export interface AdversarialCase {
  id: string;
  kind: AdversarialKind;
  trap: AdversarialTrap;
  description: string;
  /** Human-readable why this expectation is the safe/correct gate outcome. */
  reason: string;
  currentModel: string;
  provider?: Provider;
  userMessage: string;
  probes?: ContextProbe[];
  userOptedOut?: boolean;
  expect: FixtureExpectation;
  /** Substrings that must appear in `GateDecision.reason`. */
  expectReasonIncludes?: string[];
  expectQualityGuarantee?: QualityGuaranteeLevel;
  expectEffectiveBasis?: EffectiveRecommendationBasis;
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
  trap: AdversarialTrap;
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

function extraExpectationsMet(case_: AdversarialCase, decision: GateDecision): boolean {
  if (case_.expectReasonIncludes?.length) {
    for (const needle of case_.expectReasonIncludes) {
      if (!decision.reason.includes(needle)) return false;
    }
  }
  if (case_.expectQualityGuarantee) {
    const level = decision.routing?.qualityAssurance?.guarantee.level;
    if (level !== case_.expectQualityGuarantee) return false;
  }
  if (case_.expectEffectiveBasis) {
    const basis = decision.routing?.effectiveRecommendation?.basis;
    if (basis !== case_.expectEffectiveBasis) return false;
  }
  return true;
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
  const passed =
    gateExpectationMet(decision, case_.expect) === true && extraExpectationsMet(case_, decision);
  return {
    id: case_.id,
    kind: case_.kind,
    trap: case_.trap,
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
    "| Id | Trap | Kind | Pass | Gate action |",
    "|----|------|------|------|-------------|",
  ];
  for (const r of report.results) {
    const tier =
      r.decision.action === "suggest_switch"
        ? r.decision.suggestSwitch?.recommended_capability_tier
        : "—";
    lines.push(
      `| ${r.id} | ${r.trap} | ${r.kind} | ${r.passed ? "yes" : "**no**"} | ${r.decision.action}${tier ? ` → ${tier}` : ""} |`,
    );
  }
  return lines.join("\n");
}
