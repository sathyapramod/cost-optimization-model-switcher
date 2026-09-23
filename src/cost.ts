import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityTier, Provider, TaskClass } from "./types.js";

export interface TokenRates {
  input: number;
  output: number;
}

export interface PricingCatalog {
  version: string;
  unit: "usd_per_million_tokens";
  note?: string;
  models: Record<string, TokenRates>;
  tierDefaults: Record<Provider, Record<CapabilityTier, TokenRates>>;
}

export interface SwitchCostEstimate {
  estimated_output_tokens: number;
  estimated_cost_current_usd: number;
  estimated_cost_recommended_usd: number;
  estimated_savings_usd: number;
  savings_percent: number;
  cost_pricing_note: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPricingPath = join(__dirname, "..", "catalogs", "pricing.json");

let cachedPricing: PricingCatalog | null = null;

export function loadDefaultPricing(): PricingCatalog {
  if (!cachedPricing) {
    cachedPricing = JSON.parse(readFileSync(defaultPricingPath, "utf8")) as PricingCatalog;
  }
  return cachedPricing;
}

export function mergePricing(
  base: PricingCatalog,
  override?: Partial<PricingCatalog>,
): PricingCatalog {
  if (!override) return base;
  return {
    version: override.version ?? base.version,
    unit: base.unit,
    note: override.note ?? base.note,
    models: { ...base.models, ...override.models },
    tierDefaults: {
      anthropic: { ...base.tierDefaults.anthropic, ...override.tierDefaults?.anthropic },
      openai: { ...base.tierDefaults.openai, ...override.tierDefaults?.openai },
      cursor: { ...base.tierDefaults.cursor, ...override.tierDefaults?.cursor },
    },
  };
}

function normalizeModelKey(modelId: string): string {
  return modelId.trim().toLowerCase();
}

/** Heuristic output tokens for a single gate turn (not full agent run). */
export function estimateOutputTokens(taskClass: TaskClass, inputTokens: number): number {
  if (taskClass === "straightforward") {
    if (inputTokens <= 0) return 2_000;
    return Math.min(8_000, Math.max(1_500, Math.ceil(inputTokens * 0.05)));
  }
  if (inputTokens <= 0) return 6_000;
  return Math.min(16_000, Math.max(4_000, Math.ceil(inputTokens * 0.1)));
}

export function resolveTokenRates(
  modelId: string,
  provider: Provider,
  tier: CapabilityTier,
  pricing: PricingCatalog = loadDefaultPricing(),
): { rates: TokenRates; source: "model" | "tier_default" } {
  const key = normalizeModelKey(modelId);
  const sorted = Object.entries(pricing.models).sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [match, rates] of sorted) {
    if (key.includes(match.toLowerCase())) {
      return { rates, source: "model" };
    }
  }
  return { rates: pricing.tierDefaults[provider][tier], source: "tier_default" };
}

export function estimateTurnCostUsd(
  inputTokens: number,
  outputTokens: number,
  rates: TokenRates,
): number {
  const inputCost = (inputTokens / 1_000_000) * rates.input;
  const outputCost = (outputTokens / 1_000_000) * rates.output;
  return roundUsd(inputCost + outputCost);
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function buildSwitchCostEstimate(params: {
  currentModelId: string;
  recommendedModelId: string;
  provider: Provider;
  currentTier: CapabilityTier;
  recommendedTier: CapabilityTier;
  inputTokens: number;
  taskClass: TaskClass;
  pricing?: PricingCatalog;
}): SwitchCostEstimate {
  const pricing = params.pricing ?? loadDefaultPricing();
  const outputTokens = estimateOutputTokens(params.taskClass, params.inputTokens);

  const currentRates = resolveTokenRates(
    params.currentModelId,
    params.provider,
    params.currentTier,
    pricing,
  );
  const recommendedRates = resolveTokenRates(
    params.recommendedModelId,
    params.provider,
    params.recommendedTier,
    pricing,
  );

  const estimated_cost_current_usd = estimateTurnCostUsd(
    params.inputTokens,
    outputTokens,
    currentRates.rates,
  );
  const estimated_cost_recommended_usd = estimateTurnCostUsd(
    params.inputTokens,
    outputTokens,
    recommendedRates.rates,
  );
  const estimated_savings_usd = roundUsd(
    estimated_cost_current_usd - estimated_cost_recommended_usd,
  );
  const savings_percent =
    estimated_cost_current_usd > 0
      ? Math.round((estimated_savings_usd / estimated_cost_current_usd) * 1000) / 10
      : 0;

  const cost_pricing_note =
    `${pricing.note ?? "Heuristic pricing."} Output tokens estimated at ${outputTokens} ` +
    `for ${params.taskClass} task (${currentRates.source}/${recommendedRates.source} rates).`;

  return {
    estimated_output_tokens: outputTokens,
    estimated_cost_current_usd,
    estimated_cost_recommended_usd,
    estimated_savings_usd,
    savings_percent,
    cost_pricing_note,
  };
}

export function formatSavingsLine(estimate: SwitchCostEstimate): string {
  const cur = estimate.estimated_cost_current_usd.toFixed(4);
  const rec = estimate.estimated_cost_recommended_usd.toFixed(4);
  if (estimate.estimated_savings_usd > 0) {
    return (
      ` Estimated turn cost ~$${cur} → ~$${rec} ` +
      `(~${estimate.savings_percent}% lower on recommended model).`
    );
  }
  if (estimate.estimated_savings_usd < 0) {
    const extra = Math.abs(estimate.estimated_savings_usd).toFixed(4);
    return (
      ` Estimated turn cost ~$${cur} → ~$${rec} ` +
      `(~$${extra} higher on recommended model for capability).`
    );
  }
  return ` Estimated turn cost ~$${cur} on both models.`;
}
