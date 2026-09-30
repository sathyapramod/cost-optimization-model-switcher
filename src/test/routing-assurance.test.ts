import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadDefaultCatalog, resolveModel } from "../catalog.js";
import { analyzeTask } from "../task-analyzer.js";
import { routeForTask } from "../router.js";

const catalog = loadDefaultCatalog();

describe("routing recommendation vs quality assurance", () => {
  it("exposes separate capability recommendation and quality assurance", () => {
    const routing = routeForTask({
      resolved: resolveModel("claude-opus-4-6", catalog, "anthropic"),
      taskAnalysis: analyzeTask({
        userMessage: "Summarize this 2MB CI log and list errors only",
        probes: [{ source: "log_file", bytes: 2_000_000 }],
      }),
      contextBand: "large",
      primarySource: "log_file",
      userMessage: "Summarize this 2MB CI log and list errors only",
      taskDifficulty: 0.2,
      switchDirection: "downgrade",
    });

    assert.equal(routing.routingRecommendation.kind, "capability_routing");
    assert.equal(routing.qualityAssurance.kind, "quality_assurance");
    assert.ok(routing.routingRecommendation.disclaimer.includes("not verified"));
    assert.ok(
      routing.qualityAssurance.guarantee.statement.length > 0,
    );
    assert.ok(routing.effectiveRecommendation.basis);
    assert.equal(routing.qualityAssurance.evidenceSource, "fixture_train");
  });

  it("effective recommendation uses quality_assured when guarantee is probabilistic", () => {
    const routing = routeForTask({
      resolved: resolveModel("claude-opus-4-6", catalog, "anthropic"),
      taskAnalysis: analyzeTask({
        userMessage: "Summarize this 2MB CI log and list errors only",
        probes: [{ source: "log_file", bytes: 2_000_000 }],
      }),
      contextBand: "large",
      primarySource: "log_file",
      userMessage: "Summarize this 2MB CI log and list errors only",
      taskDifficulty: 0.2,
      switchDirection: "downgrade",
    });
    if (routing.qualityAssurance.guarantee.level === "probabilistic") {
      assert.equal(routing.effectiveRecommendation.basis, "quality_assured");
    }
  });
});
