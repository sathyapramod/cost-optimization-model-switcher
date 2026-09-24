import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadFixtureSuite } from "../benchmark.js";
import {
  currentModelMeetsTask,
  loadDefaultCapabilities,
  profileMeetsFeatures,
  resolveCapabilityProfile,
  selectCapableTier,
} from "../capabilities.js";
import { loadDefaultCatalog, resolveModel } from "../catalog.js";
import { analyzeTask } from "../task-analyzer.js";

describe("capability profiles", () => {
  const caps = loadDefaultCapabilities();
  const catalog = loadDefaultCatalog();

  it("loads tier limits for every provider", () => {
    for (const provider of ["anthropic", "openai", "cursor"] as const) {
      for (const tier of ["fast", "balanced", "premium"] as const) {
        const limits = caps.tiers[provider][tier];
        assert.ok(limits.reasoningDepth >= 1);
        assert.ok(limits.bulkTextProcessing >= 1);
      }
    }
  });

  it("applies model overrides (o3 bulk ceiling)", () => {
    const profile = resolveCapabilityProfile(
      resolveModel("o3", catalog),
      caps,
    );
    assert.equal(profile.limits.bulkTextProcessing, 3);
    assert.equal(profile.matchedOverride, true);
  });

  it("selectCapableTier picks fast for large log summarize fixtures", () => {
    const suite = loadFixtureSuite();
    const fixture = suite.fixtures.find((f) => f.id === "summarize-large-log")!;
    const analysis = analyzeTask({
      userMessage: fixture.userMessage,
      probes: fixture.probes,
    });
    const tier = selectCapableTier(
      suite.provider,
      analysis.features,
      analysis.minimumCapability,
      caps,
    );
    assert.equal(tier, "fast");
  });

  it("selectCapableTier picks premium for security-audit fixture", () => {
    const suite = loadFixtureSuite();
    const fixture = suite.fixtures.find((f) => f.id === "security-audit")!;
    const analysis = analyzeTask({
      userMessage: fixture.userMessage,
      probes: fixture.probes,
    });
    const tier = selectCapableTier(
      suite.provider,
      analysis.features,
      analysis.minimumCapability,
      caps,
    );
    assert.equal(tier, "premium");
  });

  it("fast tier does not meet premium security requirements", () => {
    const fast = caps.tiers.anthropic.fast;
    assert.equal(
      profileMeetsFeatures(fast, {
        reasoningDepth: 4,
        codeChange: 2,
        securityDepth: 5,
        bulkTextProcessing: 2,
        contextDependence: 3,
      }),
      false,
    );
  });

  it("currentModelMeetsTask for haiku on implement fixture", () => {
    const suite = loadFixtureSuite();
    const fixture = suite.fixtures.find((f) => f.id === "crud-implement-small")!;
    const analysis = analyzeTask({ userMessage: fixture.userMessage });
    const resolved = resolveModel("claude-haiku-4-5", catalog);
    assert.equal(currentModelMeetsTask(resolved, analysis.features, caps), false);
    const sonnet = resolveModel("claude-sonnet-4-6", catalog);
    assert.equal(currentModelMeetsTask(sonnet, analysis.features, caps), true);
  });
});
