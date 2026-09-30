import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveEvidenceStatusForSpec } from "../routing-assurance.js";
import type { QualityEvidenceIndex } from "../quality-evidence.js";

describe("evidence source isolation across specs", () => {
  it("does not report 'live' for a spec whose own rows are fixture-only, even when another spec in the same index has live evidence", () => {
    const index: QualityEvidenceIndex = {
      version: "2",
      evaluatorId: "task-contract-evaluator-v1",
      evaluatorVersion: "1.0.0",
      evidenceSource: "live", // whole-index rollup — must NOT leak into unrelated specs
      note: "test",
      records: [
        {
          provider: "openai",
          modelId: "gpt-4o-mini",
          modelVersion: "gpt-4o-mini@tier=fast",
          specId: "code_generation",
          evaluatorId: "task-contract-evaluator-v1",
          evaluatorVersion: "1.0.0",
          evidenceSource: "live",
          runs: [],
          passCount: 1,
          failCount: 1,
          sampleCount: 2,
          passRate: 0.5,
          meanQuality: 0.9,
          expectedQuality: 0.9,
          evidenceConfidence: "low",
          fixtureTaskIds: [],
        },
        {
          provider: "anthropic",
          modelId: "claude-haiku-4-5",
          modelVersion: "claude-haiku-4-5@tier=fast",
          specId: "summarization",
          evaluatorId: "task-contract-evaluator-v1",
          evaluatorVersion: "1.0.0",
          evidenceSource: "fixture_train",
          runs: [],
          passCount: 2,
          failCount: 0,
          sampleCount: 2,
          passRate: 1,
          meanQuality: 1,
          expectedQuality: 1,
          evidenceConfidence: "medium",
          fixtureTaskIds: [],
        },
      ],
    };

    const summarizationStatus = resolveEvidenceStatusForSpec(index, "summarization", 1);
    assert.equal(
      summarizationStatus.source,
      "fixture_train",
      "unrelated spec must report its own evidence source, not the index-wide rollup",
    );

    const codeGenStatus = resolveEvidenceStatusForSpec(index, "code_generation", 1);
    assert.equal(codeGenStatus.source, "live");
  });
});
