import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSwitchCostEstimate,
  estimateOutputTokens,
  estimateTurnCostUsd,
  loadDefaultPricing,
} from "../cost.js";

describe("estimateOutputTokens", () => {
  it("uses higher band for complex tasks", () => {
    const straight = estimateOutputTokens("straightforward", 500_000);
    const complex = estimateOutputTokens("complex", 500_000);
    assert.ok(complex > straight);
  });
});

describe("estimateTurnCostUsd", () => {
  it("scales with input and output", () => {
    const rates = { input: 15, output: 75 };
    const small = estimateTurnCostUsd(10_000, 2_000, rates);
    const large = estimateTurnCostUsd(500_000, 8_000, rates);
    assert.ok(large > small);
  });
});

describe("buildSwitchCostEstimate", () => {
  it("shows savings on opus → sonnet downgrade scenario", () => {
    const est = buildSwitchCostEstimate({
      currentModelId: "claude-opus-4-6",
      recommendedModelId: "claude-sonnet-4-6",
      provider: "anthropic",
      currentTier: "premium",
      recommendedTier: "balanced",
      inputTokens: 500_000,
      taskClass: "straightforward",
      pricing: loadDefaultPricing(),
    });

    assert.ok(est.estimated_cost_current_usd > est.estimated_cost_recommended_usd);
    assert.ok(est.estimated_savings_usd > 0);
    assert.ok(est.savings_percent > 50);
    assert.ok(est.estimated_output_tokens > 0);
  });

  it("shows higher cost when upgrading to premium", () => {
    const est = buildSwitchCostEstimate({
      currentModelId: "claude-haiku-4-5",
      recommendedModelId: "claude-opus-4-6",
      provider: "anthropic",
      currentTier: "fast",
      recommendedTier: "premium",
      inputTokens: 100_000,
      taskClass: "complex",
      pricing: loadDefaultPricing(),
    });

    assert.ok(est.estimated_cost_recommended_usd > est.estimated_cost_current_usd);
    assert.ok(est.estimated_savings_usd < 0);
  });
});
