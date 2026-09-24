import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultModelForTier, loadDefaultCatalog } from "../catalog.js";
import { evaluateGate } from "../gate.js";
import { loadFixtureSuite } from "../benchmark.js";
import { routeForTask } from "../router.js";
import { analyzeTask } from "../task-analyzer.js";
import { resolveModel } from "../catalog.js";

describe("routeForTask", () => {
  const catalog = loadDefaultCatalog();
  const suite = loadFixtureSuite();

  for (const fixture of suite.fixtures) {
    if (!fixture.expectByTier?.premium) continue;
    const expect = fixture.expectByTier.premium;
    if (expect.action !== "suggest_switch" || !expect.recommendedTier) continue;

    it(`premium fixture ${fixture.id} routes to ${expect.recommendedTier}`, () => {
      const analysis = analyzeTask({
        userMessage: fixture.userMessage,
        probes: fixture.probes,
      });
      const modelId = defaultModelForTier(suite.provider, "premium", catalog);
      const resolved = resolveModel(modelId, catalog, suite.provider);
      const routing = routeForTask({
        resolved,
        taskAnalysis: analysis,
        contextBand: analysis.contextBand,
        primarySource: analysis.primarySource,
        userMessage: fixture.userMessage,
        taskDifficulty: analysis.taskDifficulty,
        switchDirection: "downgrade",
      });
      assert.equal(routing.recommendedTier, expect.recommendedTier);
    });
  }

  it("evaluateGate routing matches suggest_switch tier for opus downgrade", () => {
    const fixture = suite.fixtures.find((f) => f.id === "summarize-large-log")!;
    const modelId = defaultModelForTier(suite.provider, "premium", catalog);
    const decision = evaluateGate({
      currentModel: modelId,
      userMessage: fixture.userMessage,
      probes: fixture.probes,
    });
    assert.equal(decision.action, "suggest_switch");
    assert.ok(decision.routing);
    assert.equal(
      decision.routing!.recommendedTier,
      decision.suggestSwitch!.recommended_capability_tier,
    );
  });
});
