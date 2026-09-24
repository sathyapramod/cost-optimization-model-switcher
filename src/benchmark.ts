import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultModelForTier, loadDefaultCatalog } from "./catalog.js";
import { buildSwitchCostEstimate } from "./cost.js";
import { evaluateGate } from "./gate.js";
import type {
  CapabilityTier,
  ContextProbe,
  GateAction,
  GateDecision,
  Provider,
  TaskClass,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

export interface FixtureExpectation {
  action: GateAction;
  recommendedTier?: CapabilityTier;
}

export interface BenchmarkFixture {
  id: string;
  category: string;
  description: string;
  userMessage: string;
  probes?: ContextProbe[];
  expectByTier?: Partial<Record<CapabilityTier, FixtureExpectation>>;
}

export interface FixtureSuite {
  version: string;
  provider: Provider;
  fixtures: BenchmarkFixture[];
}

export interface SuccessRateTable {
  version: string;
  note?: string;
  rates: Record<string, Partial<Record<CapabilityTier, number>>>;
}

export interface TierBenchmarkCell {
  startingTier: CapabilityTier;
  modelId: string;
  gateAction: GateAction;
  routedTier: CapabilityTier;
  turnCostUsd: number;
  inputTokensUsed: number;
  assumedSuccessRate: number;
  costPerSuccessfulTaskUsd: number;
  expectationMet: boolean | null;
}

export interface FixtureBenchmarkResult {
  id: string;
  category: string;
  description: string;
  cells: TierBenchmarkCell[];
  cheapestTierByCostPerSuccess: CapabilityTier;
  gateRecommendedTierWhenPremium: CapabilityTier | null;
}

export interface BenchmarkReport {
  generatedAt: string;
  routerVersion: string;
  provider: Provider;
  fixtures: FixtureBenchmarkResult[];
  summary: {
    fixtureCount: number;
    expectationFailures: number;
  };
}

const TIERS: CapabilityTier[] = ["fast", "balanced", "premium"];

export function loadFixtureSuite(
  path = join(repoRoot, "benchmarks", "fixtures.json"),
): FixtureSuite {
  return JSON.parse(readFileSync(path, "utf8")) as FixtureSuite;
}

export function loadSuccessRates(
  path = join(repoRoot, "benchmarks", "success-rates.json"),
): SuccessRateTable {
  return JSON.parse(readFileSync(path, "utf8")) as SuccessRateTable;
}

function inputTokensForCost(decision: GateDecision): number {
  const opt = decision.contextOptimization;
  if (opt.required && decision.taskClass === "straightforward" && opt.effectiveInputTokens > 0) {
    return opt.effectiveInputTokens;
  }
  return decision.estimatedInputTokens;
}

function routedTier(decision: GateDecision, startingTier: CapabilityTier): CapabilityTier {
  if (decision.action === "suggest_switch" && decision.suggestSwitch) {
    return decision.suggestSwitch.recommended_capability_tier;
  }
  return startingTier;
}

function turnCostUsd(
  modelId: string,
  provider: Provider,
  tier: CapabilityTier,
  inputTokens: number,
  taskClass: TaskClass,
): number {
  const est = buildSwitchCostEstimate({
    currentModelId: modelId,
    recommendedModelId: modelId,
    provider,
    currentTier: tier,
    recommendedTier: tier,
    inputTokens,
    taskClass,
  });
  return est.estimated_cost_current_usd;
}

function successRateFor(
  table: SuccessRateTable,
  category: string,
  tier: CapabilityTier,
): number {
  const row = table.rates[category];
  const rate = row?.[tier];
  if (rate == null || rate <= 0) return 0.5;
  return rate;
}

export function gateExpectationMet(
  decision: GateDecision,
  expect: FixtureExpectation | undefined,
): boolean | null {
  if (!expect) return null;
  if (decision.action !== expect.action) return false;
  if (expect.action === "suggest_switch") {
    return decision.suggestSwitch?.recommended_capability_tier === expect.recommendedTier;
  }
  return true;
}

export function benchmarkFixture(
  fixture: BenchmarkFixture,
  provider: Provider,
  successRates: SuccessRateTable,
): FixtureBenchmarkResult {
  const catalog = loadDefaultCatalog();
  const cells: TierBenchmarkCell[] = [];

  for (const startingTier of TIERS) {
    const modelId = defaultModelForTier(provider, startingTier, catalog);
    const decision = evaluateGate({
      currentModel: modelId,
      provider,
      userMessage: fixture.userMessage,
      probes: fixture.probes,
    });
    const routed = routedTier(decision, startingTier);
    const routedModelId = defaultModelForTier(provider, routed, catalog);
    const tokens = inputTokensForCost(decision);
    const cost = turnCostUsd(
      routedModelId,
      provider,
      routed,
      tokens,
      decision.taskClass,
    );
    const rate = successRateFor(successRates, fixture.category, routed);
    const expect = fixture.expectByTier?.[startingTier];

    cells.push({
      startingTier,
      modelId,
      gateAction: decision.action,
      routedTier: routed,
      turnCostUsd: cost,
      inputTokensUsed: tokens,
      assumedSuccessRate: rate,
      costPerSuccessfulTaskUsd: cost / rate,
      expectationMet: gateExpectationMet(decision, expect),
    });
  }

  const cheapest = cells.reduce((best, cell) =>
    cell.costPerSuccessfulTaskUsd < best.costPerSuccessfulTaskUsd ? cell : best,
  );

  const premiumCell = cells.find((c) => c.startingTier === "premium");

  return {
    id: fixture.id,
    category: fixture.category,
    description: fixture.description,
    cells,
    cheapestTierByCostPerSuccess: cheapest.routedTier,
    gateRecommendedTierWhenPremium:
      premiumCell?.gateAction === "suggest_switch" ? premiumCell.routedTier : null,
  };
}

export function runBenchmarkSuite(options?: {
  fixturesPath?: string;
  successRatesPath?: string;
}): BenchmarkReport {
  const suite = loadFixtureSuite(options?.fixturesPath);
  const rates = loadSuccessRates(options?.successRatesPath);
  const provider = suite.provider;

  const fixtures = suite.fixtures.map((f) => benchmarkFixture(f, provider, rates));

  let expectationFailures = 0;
  for (const f of suite.fixtures) {
    const result = fixtures.find((r) => r.id === f.id)!;
    for (const cell of result.cells) {
      if (cell.expectationMet === false) expectationFailures++;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    routerVersion: "1.1.0",
    provider,
    fixtures,
    summary: {
      fixtureCount: fixtures.length,
      expectationFailures,
    },
  };
}

export function formatBenchmarkMarkdown(report: BenchmarkReport): string {
  const lines: string[] = [
    "## Latest benchmark run",
    "",
    `Generated: ${report.generatedAt}`,
    `Provider: ${report.provider} | Router: ${report.routerVersion}`,
    `Fixtures: ${report.summary.fixtureCount} | Gate expectation failures: ${report.summary.expectationFailures}`,
    "",
    "| Fixture | Category | Best tier (cost/success) | Premium gate routes to |",
    "|---------|----------|--------------------------|-------------------------|",
  ];

  for (const f of report.fixtures) {
    lines.push(
      `| ${f.id} | ${f.category} | ${f.cheapestTierByCostPerSuccess} | ${f.gateRecommendedTierWhenPremium ?? "—"} |`,
    );
  }

  lines.push("", "### Cost per successful task (USD, heuristic)", "");
  for (const f of report.fixtures) {
    lines.push(`**${f.id}** — ${f.description}`);
    lines.push("");
    lines.push("| Start tier | Gate | Routed | Turn $ | Success rate | $/success |");
    lines.push("|------------|------|--------|--------|--------------|-----------|");
    for (const c of f.cells) {
      lines.push(
        `| ${c.startingTier} | ${c.gateAction} | ${c.routedTier} | ${c.turnCostUsd.toFixed(4)} | ${(c.assumedSuccessRate * 100).toFixed(0)}% | ${c.costPerSuccessfulTaskUsd.toFixed(4)} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function assertBenchmarkExpectations(report: BenchmarkReport): void {
  if (report.summary.expectationFailures > 0) {
    throw new Error(
      `Benchmark gate expectations failed: ${report.summary.expectationFailures} cell(s)`,
    );
  }
}
