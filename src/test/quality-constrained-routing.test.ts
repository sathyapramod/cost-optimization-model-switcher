import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadDefaultCatalog, resolveModel } from "../catalog.js";
import {
  DEFAULT_QUALITY_CONSTRAINED_POLICY,
  deriveRequiredQuality,
  executeQualityConstrainedRouting,
} from "../quality-constrained-policy.js";
import type { QualityEvidenceIndex, QualityEvidenceRecord } from "../quality-evidence.js";
import { routeByCapabilities } from "../capability-router.js";
import { analyzeTask } from "../task-analyzer.js";
import { routeForTask } from "../router.js";

const catalog = loadDefaultCatalog();

function mockEvidence(
  rows: Array<{
    modelId: string;
    specId: QualityEvidenceRecord["specId"];
    expectedQuality: number;
  }>,
): QualityEvidenceIndex {
  return {
    version: "test",
    note: "test-only evidence",
    records: rows.map((r) => ({
      provider: "anthropic",
      modelId: r.modelId,
      specId: r.specId,
      expectedQuality: r.expectedQuality,
      sampleCount: 1,
      fixtureTaskIds: ["test-fixture"],
    })),
  };
}

describe("quality-constrained routing policy", () => {
  it("minimizes cost among models meeting required quality (example thresholds in test only)", () => {
    const analysis = analyzeTask({
      userMessage: "Summarize this CI log and list errors only",
      probes: [{ source: "log_file", bytes: 500_000 }],
    });
    const resolved = resolveModel("claude-opus-4-6", catalog, "anthropic");
    const cap = routeByCapabilities({
      resolved,
      taskAnalysis: analysis,
      contextBand: analysis.contextBand,
      primarySource: analysis.primarySource,
      userMessage: analysis.contract.objective,
      taskDifficulty: analysis.taskDifficulty,
      switchDirection: "downgrade",
      effectiveInputTokens: analysis.estimatedInputTokens,
    });

    const evidence = mockEvidence([
      { modelId: "claude-haiku-4-5", specId: "summarization", expectedQuality: 0.62 },
      { modelId: "claude-sonnet-4-6", specId: "summarization", expectedQuality: 0.86 },
      { modelId: "claude-opus-4-6", specId: "summarization", expectedQuality: 0.91 },
    ]);

    const result = executeQualityConstrainedRouting({
      resolved,
      taskAnalysis: analysis,
      capabilityResult: cap,
      switchDirection: "downgrade",
      effectiveInputTokens: analysis.estimatedInputTokens,
      evidence,
      policy: { defaultRequiredQuality: 0.85 },
    });

    assert.equal(result.requiredQuality, 0.85);
    assert.equal(result.selectedModelId, "claude-sonnet-4-6");
    assert.ok(
      result.rejectedModels.some(
        (r) => r.modelId === "claude-haiku-4-5" && r.reason.includes("0.62"),
      ),
    );
    assert.ok(result.explanation.includes("required quality"));
    assert.ok(result.explanation.includes("Rejected"));
    assert.equal(result.preserveCurrentModel, false);
  });

  it("preserves current model when no candidate has quality evidence", () => {
    const analysis = analyzeTask({
      userMessage: "Summarize this CI log and list errors only",
      probes: [{ source: "log_file", bytes: 500_000 }],
    });
    const resolved = resolveModel("claude-opus-4-6", catalog, "anthropic");
    const cap = routeByCapabilities({
      resolved,
      taskAnalysis: analysis,
      contextBand: analysis.contextBand,
      primarySource: analysis.primarySource,
      userMessage: analysis.contract.objective,
      taskDifficulty: analysis.taskDifficulty,
      switchDirection: "downgrade",
      effectiveInputTokens: analysis.estimatedInputTokens,
    });

    const result = executeQualityConstrainedRouting({
      resolved,
      taskAnalysis: analysis,
      capabilityResult: cap,
      switchDirection: "downgrade",
      effectiveInputTokens: analysis.estimatedInputTokens,
      evidence: { version: "empty", note: "none", records: [] },
    });

    assert.equal(result.preserveCurrentModel, true);
    assert.equal(result.selectedModelId, null);
    assert.ok(result.noOpReason?.includes("evidence"));
  });

  it("uses fixture-backed evidence for real summarization downgrade", () => {
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
    assert.equal(routing.recommendedModelId, "claude-haiku-4-5");
    assert.ok(routing.qualityConstrained);
    assert.equal(routing.qualityConstrained!.preserveCurrentModel, false);
    const haiku = routing.qualityConstrained!.candidates.find(
      (c) => c.modelId === "claude-haiku-4-5",
    );
    assert.equal(haiku?.status, "eligible");
    assert.ok((haiku?.expectedQuality ?? 0) >= 0.85);
  });

  it("deriveRequiredQuality raises floor for architecture specs", () => {
    assert.equal(
      deriveRequiredQuality("architecture", DEFAULT_QUALITY_CONSTRAINED_POLICY),
      0.9,
    );
    assert.equal(
      deriveRequiredQuality("underspecified", DEFAULT_QUALITY_CONSTRAINED_POLICY),
      null,
    );
  });
});
