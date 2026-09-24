import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadDefaultCatalog, resolveModel } from "../catalog.js";
import { evaluateGate } from "../gate.js";
import { loadFixtureSuite } from "../benchmark.js";
import { evaluateRoutingConfidence } from "../routing-confidence.js";
import { routeForTask } from "../router.js";
import { analyzeTask } from "../task-analyzer.js";
import { defaultModelForTier } from "../catalog.js";

describe("evaluateRoutingConfidence", () => {
  const catalog = loadDefaultCatalog();
  const suite = loadFixtureSuite();

  it("blocks switch when capableTier is null", () => {
    const routing = {
      capableTier: null,
      legacyTier: "fast" as const,
      recommendedTier: "fast" as const,
      currentMeetsTask: true,
    };
    const analysis = analyzeTask({ userMessage: "Summarize this log" });
    const resolved = resolveModel("claude-opus-4-6", catalog);
    const result = evaluateRoutingConfidence({
      resolved,
      routing,
      taskAnalysis: analysis,
      contextBand: "large",
      estimatedInputTokens: 500_000,
      switchDirection: "downgrade",
    });
    assert.equal(result.suggestSwitch, false);
    assert.equal(result.confidence, "low");
  });

  it("blocks switch on mixed intent", () => {
    const analysis = analyzeTask({
      userMessage: "Review PR diff and implement the fix for the race",
    });
    const resolved = resolveModel("claude-opus-4-6", catalog);
    const routing = routeForTask({
      resolved,
      taskAnalysis: analysis,
      contextBand: analysis.contextBand,
      primarySource: analysis.primarySource,
      userMessage: "Review PR diff and implement the fix for the race",
      taskDifficulty: analysis.taskDifficulty,
      switchDirection: "downgrade",
    });
    const result = evaluateRoutingConfidence({
      resolved,
      routing,
      taskAnalysis: analysis,
      contextBand: "large",
      estimatedInputTokens: 400_000,
      switchDirection: "downgrade",
    });
    assert.equal(result.suggestSwitch, false);
    assert.match(result.noOpReason ?? "", /mixed/i);
  });

  it("allows premium downgrade for benchmark summarize fixture", () => {
    const fixture = suite.fixtures.find((f) => f.id === "summarize-large-log")!;
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
    const result = evaluateRoutingConfidence({
      resolved,
      routing,
      taskAnalysis: analysis,
      contextBand: analysis.contextBand,
      estimatedInputTokens: analysis.estimatedInputTokens,
      switchDirection: "downgrade",
    });
    assert.equal(result.suggestSwitch, true);
    assert.equal(result.confidence, "high");
  });

  it("evaluateGate attaches routingConfidence on suggest_switch", () => {
    const fixture = suite.fixtures.find((f) => f.id === "summarize-large-log")!;
    const modelId = defaultModelForTier(suite.provider, "premium", catalog);
    const decision = evaluateGate({
      currentModel: modelId,
      userMessage: fixture.userMessage,
      probes: fixture.probes,
    });
    assert.equal(decision.action, "suggest_switch");
    assert.ok(decision.routingConfidence?.suggestSwitch);
    assert.equal(decision.suggestSwitch?.confidence, decision.routingConfidence?.confidence);
  });

  it("mixed intent on premium stays complex (no downgrade path)", () => {
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Review PR diff and implement the fix for the race",
      probes: [{ source: "github_pr", additions: 2000, deletions: 800, changedFiles: 25 }],
    });
    assert.equal(decision.action, "proceed");
    assert.match(decision.reason, /stayed-premium \(complex\)/);
    assert.equal(decision.taskAnalysis?.flags.mixedIntent, true);
  });
});
