import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultModelForTier, loadDefaultCatalog, resolveModel } from "../catalog.js";
import { evaluateGate } from "../gate.js";
import { assessRoutingUncertainty } from "../routing-uncertainty.js";
import { evaluateRoutingConfidence } from "../routing-confidence.js";
import { routeForTask } from "../router.js";
import { analyzeTask } from "../task-analyzer.js";

const catalog = loadDefaultCatalog();
const provider = "anthropic";

describe("routing uncertainty", () => {
  it('"Analyze this." is insufficient_information and does not recommend premium switch', () => {
    const userMessage = "Analyze this.";
    const analysis = analyzeTask({ userMessage });
    const modelId = defaultModelForTier(provider, "fast", catalog);
    const resolved = resolveModel(modelId, catalog, provider);
    const routing = routeForTask({
      resolved,
      taskAnalysis: analysis,
      contextBand: analysis.contextBand,
      primarySource: analysis.primarySource,
      userMessage,
      taskDifficulty: analysis.taskDifficulty,
      switchDirection: "upgrade",
    });
    const assessment = assessRoutingUncertainty({
      resolved,
      routing,
      taskAnalysis: analysis,
      userMessage,
      contextBand: analysis.contextBand,
      estimatedInputTokens: 0,
      effectiveInputTokens: 0,
      probes: [],
      switchDirection: "upgrade",
    });

    assert.equal(assessment.state, "insufficient_information");
    assert.equal(assessment.suggestSwitch, false);
    assert.ok(assessment.clarification.needed);
    assert.match(assessment.clarification.summary, /underspecified|ambiguous/i);
    assert.ok(
      assessment.clarification.questions.some((q) => /summarization|root-cause|quantitative|architecture/i.test(q)),
    );
    assert.ok(
      assessment.suggestSwitch === false,
      "must not suggest switch on underspecified analyze",
    );
  });

  it("ambiguous analyze on opus with large log does not aggressively downgrade", () => {
    const userMessage = "Analyze this.";
    const probes = [{ source: "log_file" as const, bytes: 2_000_000 }];
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage,
      probes,
    });

    assert.equal(decision.action, "proceed");
    assert.ok(decision.routingConfidence);
    assert.equal(decision.routingConfidence!.state, "insufficient_information");
    assert.equal(decision.routingConfidence!.suggestSwitch, false);
    assert.ok(decision.routingConfidence!.clarification.needed);
    assert.match(decision.reason, /underspecified|ambiguous/i);
    assert.notEqual(decision.suggestSwitch?.recommended_capability_tier, "premium");
  });

  it("underspecified analytical prompt exposes structured clarification for UI", () => {
    const userMessage = "Analyze this.";
    const analysis = analyzeTask({ userMessage });
    const resolved = resolveModel("claude-sonnet-4-6", catalog, provider);
    const routing = routeForTask({
      resolved,
      taskAnalysis: analysis,
      contextBand: analysis.contextBand,
      primarySource: analysis.primarySource,
      userMessage,
      taskDifficulty: analysis.taskDifficulty,
      switchDirection: "upgrade",
    });
    const result = evaluateRoutingConfidence({
      resolved,
      routing,
      taskAnalysis: analysis,
      userMessage,
      contextBand: analysis.contextBand,
      estimatedInputTokens: 0,
      probes: [],
      switchDirection: "upgrade",
    });

    assert.ok(result.dimensions.taskUnderstanding);
    assert.ok(result.dimensions.context);
    assert.ok(result.dimensions.capabilityMatching);
    assert.ok(result.dimensions.routing);
    assert.ok(result.lowConfidenceReasons.length > 0);
    assert.equal(result.clarification.questions.length >= 2, true);
  });

  it("well-understood summarize fixture remains confident and suggests switch", () => {
    const userMessage = "Summarize this 2MB CI log and list errors only";
    const probes = [{ source: "log_file" as const, bytes: 2_000_000 }];
    const analysis = analyzeTask({ userMessage, probes });
    const resolved = resolveModel("claude-opus-4-6", catalog, provider);
    const routing = routeForTask({
      resolved,
      taskAnalysis: analysis,
      contextBand: analysis.contextBand,
      primarySource: analysis.primarySource,
      userMessage,
      taskDifficulty: analysis.taskDifficulty,
      switchDirection: "downgrade",
      effectiveInputTokens: analysis.estimatedInputTokens,
    });
    const result = evaluateRoutingConfidence({
      resolved,
      routing,
      taskAnalysis: analysis,
      userMessage,
      contextBand: analysis.contextBand,
      estimatedInputTokens: analysis.estimatedInputTokens,
      probes,
      switchDirection: "downgrade",
    });

    assert.equal(result.state, "confident");
    assert.equal(result.suggestSwitch, true);
    assert.equal(result.clarification.needed, false);
  });
});
