import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadDefaultCatalog } from "../catalog.js";
import {
  assessPricingFreshness,
  buildSwitchCostEstimate,
  loadDefaultPricing,
  mergePricing,
  summarizePricingCatalogAudit,
  validatePricingCatalog,
} from "../cost.js";
import type { PricingCatalog } from "../cost.js";

describe("pricing catalog", () => {
  it("default catalog passes validation", () => {
    const catalog = loadDefaultPricing();
    const result = validatePricingCatalog(catalog);
    assert.equal(result.ok, true, result.errors.join("; "));
  });

  it("every default tier model has explicit pricing rates", () => {
    const catalog = loadDefaultCatalog();
    const pricing = loadDefaultPricing();
    for (const provider of ["anthropic", "openai", "cursor"] as const) {
      for (const tier of ["premium", "balanced", "fast"] as const) {
        const modelId = catalog.defaults[provider][tier];
        const rates = pricing.models[modelId];
        assert.ok(rates, `missing models.${modelId}`);
        assert.ok(typeof rates.input === "number" && rates.input >= 0);
        assert.ok(typeof rates.output === "number" && rates.output >= 0);
      }
    }
  });

  it("detects malformed pricing entries", () => {
    const base = loadDefaultPricing();
    const bad: PricingCatalog = {
      ...base,
      models: { ...base.models, "bad-model": { input: -1, output: 5 } },
    };
    const result = validatePricingCatalog(bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("bad-model")));
  });

  it("detects missing tier defaults", () => {
    const base = loadDefaultPricing();
    const bad = structuredClone(base) as PricingCatalog;
    delete (bad.tierDefaults.anthropic as Partial<typeof bad.tierDefaults.anthropic>).fast;
    const result = validatePricingCatalog(bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("tierDefaults.anthropic.fast")));
  });

  it("mergePricing preserves and overrides metadata", () => {
    const base = loadDefaultPricing();
    const merged = mergePricing(base, {
      metadata: {
        currency: "USD",
        source: "override source",
        retrievedAt: "2026-01-15",
      },
    });
    assert.equal(merged.metadata?.source, "override source");
    assert.equal(merged.metadata?.retrievedAt, "2026-01-15");
    assert.equal(merged.metadata?.currency, "USD");
    assert.equal(merged.models["claude-opus-4-6"].input, base.models["claude-opus-4-6"].input);
  });

  it("cost calculation unchanged when metadata is present", () => {
    const pricing = loadDefaultPricing();
    const params = {
      currentModelId: "claude-opus-4-6",
      recommendedModelId: "claude-sonnet-4-6",
      provider: "anthropic" as const,
      currentTier: "premium" as const,
      recommendedTier: "balanced" as const,
      inputTokens: 500_000,
      taskClass: "straightforward" as const,
      pricing,
    };
    const withMeta = buildSwitchCostEstimate(params);
    const withoutMeta = buildSwitchCostEstimate({
      ...params,
      pricing: { ...pricing, metadata: undefined },
    });
    assert.deepEqual(
      {
        current: withMeta.estimated_cost_current_usd,
        recommended: withMeta.estimated_cost_recommended_usd,
        savings: withMeta.estimated_savings_usd,
        percent: withMeta.savings_percent,
        output: withMeta.estimated_output_tokens,
      },
      {
        current: withoutMeta.estimated_cost_current_usd,
        recommended: withoutMeta.estimated_cost_recommended_usd,
        savings: withoutMeta.estimated_savings_usd,
        percent: withoutMeta.savings_percent,
        output: withoutMeta.estimated_output_tokens,
      },
    );
  });

  it("flags stale catalog when retrievedAt is missing", () => {
    const catalog = loadDefaultPricing();
    const f = assessPricingFreshness(catalog);
    assert.equal(f.stale, true);
    assert.equal(f.staleReason, "missing_date");
    const audit = summarizePricingCatalogAudit(catalog);
    assert.ok(audit.staleWarning);
  });

  it("does not flag fresh catalog when retrievedAt is recent", () => {
    const base = loadDefaultPricing();
    const catalog = mergePricing(base, {
      metadata: { ...base.metadata!, retrievedAt: "2026-09-15" },
    });
    const f = assessPricingFreshness(catalog, { now: new Date("2026-10-01T12:00:00Z") });
    assert.equal(f.stale, false);
    assert.equal(f.updatedDisplay, "2026-09-15");
  });
});
