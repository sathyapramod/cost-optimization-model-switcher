import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadDefaultCatalog, resolveModel } from "../catalog.js";
import {
  DEFAULT_QUALITY_CONSTRAINED_POLICY,
  deriveRequiredQuality,
  executeQualityConstrainedRouting,
} from "../quality-constrained-policy.js";
import type { QualityEvidenceIndex, QualityEvidenceRecord } from "../quality-evidence.js";
import { TASK_CONTRACT_EVALUATOR_ID } from "../task-quality/evaluators.js";
import { routeByCapabilities } from "../capability-router.js";
import { analyzeTask } from "../task-analyzer.js";
import { routeForTask } from "../router.js";

const catalog = loadDefaultCatalog();

function mockEvidence(
  rows: Array<{
    modelId: string;
    specId: QualityEvidenceRecord["specId"];
    meanQuality: number;
    passRate?: number;
    passCount?: number;
    failCount?: number;
  }>,
): QualityEvidenceIndex {
  return {
    version: "2",
    evaluatorId: TASK_CONTRACT_EVALUATOR_ID,
    evaluatorVersion: "1.0.0",
    evidenceSource: "synthetic",
    note: "test-only evidence",
    records: rows.map((r) => {
      const passCount = r.passCount ?? (r.passRate != null ? Math.round(r.passRate * 10) : 10);
      const failCount = r.failCount ?? 10 - passCount;
      const sampleCount = passCount + failCount;
      const passRate = r.passRate ?? passCount / sampleCount;
      return {
        provider: "anthropic",
        modelId: r.modelId,
        modelVersion: `${r.modelId}@tier=test`,
        specId: r.specId,
        evaluatorId: TASK_CONTRACT_EVALUATOR_ID,
        evaluatorVersion: "1.0.0",
        evidenceSource: "synthetic",
        runs: [],
        passCount,
        failCount,
        sampleCount,
        passRate,
        meanQuality: r.meanQuality,
        expectedQuality: r.meanQuality,
        evidenceConfidence: "high",
        fixtureTaskIds: ["test-fixture"],
      };
    }),
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
      { modelId: "claude-haiku-4-5", specId: "summarization", meanQuality: 0.62, passRate: 0.5 },
      { modelId: "claude-sonnet-4-6", specId: "summarization", meanQuality: 0.86, passRate: 1 },
      { modelId: "claude-opus-4-6", specId: "summarization", meanQuality: 0.91, passRate: 1 },
    ]);

    const result = executeQualityConstrainedRouting({
      resolved,
      taskAnalysis: analysis,
      capabilityResult: cap,
      switchDirection: "downgrade",
      effectiveInputTokens: analysis.estimatedInputTokens,
      evidence,
      policy: { defaultRequiredQuality: 0.85, minPassRate: 0.75 },
    });

    assert.equal(result.requiredQuality, 0.85);
    assert.equal(result.selectedModelId, "claude-sonnet-4-6");
    assert.ok(
      result.rejectedModels.some((r) => r.modelId === "claude-haiku-4-5"),
    );
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
      evidence: {
        version: "2",
        evaluatorId: TASK_CONTRACT_EVALUATOR_ID,
        evaluatorVersion: "1.0.0",
        evidenceSource: "synthetic",
        note: "empty",
        records: [],
      },
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
    assert.equal(routing.qualityAssurance.guarantee.level, "probabilistic");
    const haiku = routing.qualityAssurance.result.candidates.find(
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
