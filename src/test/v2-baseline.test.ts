import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadFixtureSuite } from "../benchmark.js";
import { assertEvaluation, runEvaluation } from "../evaluation.js";
import { defaultModelForTier, loadDefaultCatalog } from "../catalog.js";
import { evaluateGate } from "../gate.js";

/**
 * V2 Day 1 baseline contract: benchmark fixtures + taskAnalysis on gate decisions.
 * Update only with intentional router changes (document in docs/V2_ARCHITECTURE.md).
 */
describe("V2 baseline contract", () => {
  it("evaluation suite passes (benchmark + adversarial)", () => {
    assertEvaluation(runEvaluation());
  });

  it("every evaluateGate decision includes taskAnalysis aligned with scores", () => {
    const suite = loadFixtureSuite();
    const catalog = loadDefaultCatalog();
    const fixture = suite.fixtures[0]!;
    const modelId = defaultModelForTier(suite.provider, "premium", catalog);
    const decision = evaluateGate({
      currentModel: modelId,
      provider: suite.provider,
      userMessage: fixture.userMessage,
      probes: fixture.probes,
    });

    assert.ok(decision.taskAnalysis);
    assert.equal(decision.taskAnalysis!.taskClass, decision.taskClass);
    assert.equal(decision.taskAnalysis!.taskDifficulty, decision.scores.taskDifficulty);
    assert.equal(decision.taskAnalysis!.ingestComplexity, decision.scores.ingestComplexity);
    assert.ok(decision.capabilityProfile);
    assert.equal(decision.capabilityProfile!.tier, "premium");
  });
});
