import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityTier, Provider, TaskClass } from "./types.js";

const PROVIDERS: Provider[] = ["anthropic", "openai", "cursor"];
const TIERS: CapabilityTier[] = ["premium", "balanced", "fast"];

/** ponytail: fixed calendar-day threshold until automated vendor price checks exist. */
export const PRICING_STALE_AFTER_DAYS = 90;

export interface PricingCatalogMetadata {
  currency: string;
  source: string;
  /** ISO date (YYYY-MM-DD) when rates were last verified; null if not recorded. */
  retrievedAt?: string | null;
  maintainerNote?: string;
}

export interface TokenRates {
  input: number;
  output: number;
}

export interface PricingCatalog {
  version: string;
  unit: "usd_per_million_tokens";
  note?: string;
  metadata?: PricingCatalogMetadata;
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
    metadata: override.metadata
      ? { ...base.metadata, ...override.metadata }
      : base.metadata,
    models: { ...base.models, ...override.models },
    tierDefaults: {
      anthropic: { ...base.tierDefaults.anthropic, ...override.tierDefaults?.anthropic },
      openai: { ...base.tierDefaults.openai, ...override.tierDefaults?.openai },
      cursor: { ...base.tierDefaults.cursor, ...override.tierDefaults?.cursor },
    },
  };
}

export function resetPricingCache(): void {
  cachedPricing = null;
}

function isValidRate(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function validateRates(rates: unknown, label: string, errors: string[]): rates is TokenRates {
  if (rates == null || typeof rates !== "object") {
    errors.push(`${label}: expected { input, output }`);
    return false;
  }
  const r = rates as Record<string, unknown>;
  let ok = true;
  if (!isValidRate(r.input)) {
    errors.push(`${label}: invalid input rate`);
    ok = false;
  }
  if (!isValidRate(r.output)) {
    errors.push(`${label}: invalid output rate`);
    ok = false;
  }
  return ok;
}

export function validatePricingCatalog(catalog: PricingCatalog): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!catalog.version?.trim()) errors.push("missing version");
  if (catalog.unit !== "usd_per_million_tokens") {
    errors.push(`unexpected unit: ${String(catalog.unit)}`);
  }
  if (!catalog.models || typeof catalog.models !== "object") {
    errors.push("missing models map");
  } else {
    for (const [id, rates] of Object.entries(catalog.models)) {
      validateRates(rates, `models.${id}`, errors);
    }
  }
  for (const provider of PROVIDERS) {
    const byTier = catalog.tierDefaults?.[provider];
    if (!byTier) {
      errors.push(`missing tierDefaults.${provider}`);
      continue;
    }
    for (const tier of TIERS) {
      validateRates(byTier[tier], `tierDefaults.${provider}.${tier}`, errors);
    }
  }
  if (catalog.metadata) {
    if (!catalog.metadata.currency?.trim()) errors.push("metadata.currency required when metadata present");
    if (!catalog.metadata.source?.trim()) errors.push("metadata.source required when metadata present");
    const at = catalog.metadata.retrievedAt;
    if (at != null && at !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(at)) {
      errors.push("metadata.retrievedAt must be YYYY-MM-DD or null");
    }
  }
  return { ok: errors.length === 0, errors };
}

export interface PricingFreshnessAssessment {
  currency: string;
  source: string;
  updatedDisplay: string;
  retrievedAt: string | null;
  ageDays: number | null;
  stale: boolean;
  staleReason?: "missing_date" | "age";
}

export interface PricingCatalogAuditSummary {
  currency: string;
  source: string;
  updatedDisplay: string;
  retrievedAt: string | null;
  stale: boolean;
  staleWarning?: string;
  unit: PricingCatalog["unit"];
  version: string;
}

export function assessPricingFreshness(
  catalog: PricingCatalog,
  options?: { staleAfterDays?: number; now?: Date },
): PricingFreshnessAssessment {
  const staleAfterDays = options?.staleAfterDays ?? PRICING_STALE_AFTER_DAYS;
  const now = options?.now ?? new Date();
  const meta = catalog.metadata;
  const currency = meta?.currency ?? "USD";
  const source =
    meta?.source ??
    "Source not recorded in catalog metadata (see catalogs/pricing.json note).";
  const retrievedAt =
    meta?.retrievedAt != null && String(meta.retrievedAt).trim() !== ""
      ? String(meta.retrievedAt).trim()
      : null;

  if (!retrievedAt) {
    return {
      currency,
      source,
      updatedDisplay: "not recorded",
      retrievedAt: null,
      ageDays: null,
      stale: true,
      staleReason: "missing_date",
    };
  }

  const parsed = Date.parse(`${retrievedAt}T12:00:00Z`);
  if (!Number.isFinite(parsed)) {
    return {
      currency,
      source,
      updatedDisplay: retrievedAt,
      retrievedAt,
      ageDays: null,
      stale: true,
      staleReason: "missing_date",
    };
  }
  const ageDays = Math.floor((now.getTime() - parsed) / (24 * 60 * 60 * 1000));
  const stale = ageDays > staleAfterDays;
  return {
    currency,
    source,
    updatedDisplay: retrievedAt,
    retrievedAt,
    ageDays,
    stale,
    staleReason: stale ? "age" : undefined,
  };
}

export function summarizePricingCatalogAudit(catalog: PricingCatalog): PricingCatalogAuditSummary {
  const freshness = assessPricingFreshness(catalog);
  const summary: PricingCatalogAuditSummary = {
    currency: freshness.currency,
    source: freshness.source,
    updatedDisplay: freshness.updatedDisplay,
    retrievedAt: freshness.retrievedAt,
    stale: freshness.stale,
    unit: catalog.unit,
    version: catalog.version,
  };
  if (freshness.stale) {
    summary.staleWarning =
      freshness.staleReason === "age"
        ? `Pricing catalog may be stale (last verified ${freshness.updatedDisplay}; threshold ${PRICING_STALE_AFTER_DAYS} days).`
        : "Pricing catalog freshness is unknown (retrievedAt not recorded).";
  }
  return summary;
}

export function formatPricingAuditText(catalog: PricingCatalog): string {
  const f = assessPricingFreshness(catalog);
  const lines = [
    "Pricing data:",
    `  Source: ${f.source}`,
    `  Updated: ${f.updatedDisplay}`,
    `  Currency: ${f.currency}`,
  ];
  if (f.stale) {
    lines.push(
      "",
      "WARNING:",
      f.staleReason === "age"
        ? "Pricing catalog may be stale."
        : "Pricing catalog freshness is unknown (no verification date recorded).",
    );
  }
  return lines.join("\n");
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
