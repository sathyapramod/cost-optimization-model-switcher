import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadAdversarialSuite } from "../adversarial.js";
import {
  ABSTAIN_QUALITY_FLOOR_REASON,
  deriveEvidenceDisposition,
  isUnsafeDowngrade,
} from "../evidence-disposition.js";
import { buildDecisionTrace, formatDecisionTraceText } from "../decision-trace.js";
import { evaluateGate } from "../gate.js";
import type { GateDecision } from "../types.js";

function assertNoUnsafeDowngrade(decision: GateDecision, context: string): void {
  assert.equal(isUnsafeDowngrade(decision), false, context);
  if (decision.suggestSwitch?.switch_direction === "downgrade") {
    assert.fail(`${context}: unexpected downgrade recommendation`);
  }
}

describe("insufficient and unknown evidence (no unsafe downgrades)", () => {
  it("missing quality evidence abstains and blocks downgrade", () => {
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Parse this JSON export into a table of field names only",
      probes: [{ source: "json_export", bytes: 200_000 }],
    });
    assertNoUnsafeDowngrade(decision, "missing quality evidence");
    assert.equal(decision.routing?.qualityAssurance?.guarantee.level, "abstain");
    assert.equal(deriveEvidenceDisposition(decision), "insufficient");
    const trace = buildDecisionTrace(decision);
    assert.equal(trace.label, "ABSTAIN");
    assert.equal(trace.abstainReason, ABSTAIN_QUALITY_FLOOR_REASON);
    assert.match(formatDecisionTraceText(trace), /Reason:\n  Insufficient quality evidence/);
  });

  it("unknown model skips switching with unknown disposition", () => {
    const decision = evaluateGate({
      currentModel: "totally-unknown-model-xyz",
      userMessage: "Summarize this 2MB CI log and list errors only",
      probes: [{ source: "log_file", bytes: 2_000_000 }],
    });
    assertNoUnsafeDowngrade(decision, "unknown model");
    assert.match(decision.reason, /unknown model/);
    assert.equal(decision.suggestSwitch, undefined);
    assert.equal(deriveEvidenceDisposition(decision), "unknown");
    const trace = buildDecisionTrace(decision);
    assert.equal(trace.label, "SKIP_UNKNOWN_MODEL");
    assert.equal(trace.evidenceDisposition, "unknown");
  });

  it("unknown capability (no capable tier) does not downgrade from premium", () => {
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Count how many lines mention ERROR in this dump",
      probes: [{ source: "log_file", bytes: 4_000_000 }],
    });
    assertNoUnsafeDowngrade(decision, "quality floor / capability mismatch");
    assert.equal(decision.routing?.effectiveRecommendation?.basis, "abstain_preserve_current");
    assert.notEqual(decision.suggestSwitch?.switch_direction, "downgrade");
  });

  it("incomplete task description abstains on large-context downgrade path", () => {
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Analyze this.",
      probes: [{ source: "log_file", bytes: 2_000_000 }],
    });
    assertNoUnsafeDowngrade(decision, "underspecified analyze");
    assert.equal(decision.routingConfidence?.state, "insufficient_information");
    assert.equal(buildDecisionTrace(decision).label, "ABSTAIN");
  });

  it("unsupported / low-evidence task type does not claim quality-safe downgrade", () => {
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Parse this JSON export into a table of field names only",
      probes: [{ source: "json_export", bytes: 200_000 }],
    });
    assertNoUnsafeDowngrade(decision, "unsupported task type for evidence");
    assert.equal(decision.routing?.qualityAssurance?.guarantee.level, "abstain");
    assert.equal(decision.routing?.effectiveRecommendation?.basis, "abstain_preserve_current");
  });

  it("insufficient context metadata blocks aggressive downgrade", () => {
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Summarize this log",
      probes: [{ source: "other", refs: ["attached log"] }],
    });
    assertNoUnsafeDowngrade(decision, "insufficient context probe metadata");
    assert.notEqual(decision.action, "suggest_switch");
  });

  it("adversarial false-positive traps never emit unsafe downgrades", () => {
    const suite = loadAdversarialSuite();
    const traps = new Set([
      "missing_quality_evidence",
      "unknown_model",
      "underspecified",
      "quality_floor",
      "false_downgrade",
    ]);
    for (const c of suite.cases) {
      if (c.kind !== "false_positive" || !traps.has(c.trap)) continue;
      const decision = evaluateGate({
        currentModel: c.currentModel,
        provider: c.provider,
        userMessage: c.userMessage,
        probes: c.probes,
        userOptedOut: c.userOptedOut,
      });
      assertNoUnsafeDowngrade(decision, `adversarial:${c.id}`);
    }
  });

  it("sufficient-evidence downgrade still allowed when fixtures back quality", () => {
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Summarize this 2MB CI log and list errors only",
      probes: [{ source: "log_file", bytes: 2_000_000 }],
    });
    assert.equal(decision.action, "suggest_switch");
    assert.equal(decision.suggestSwitch?.switch_direction, "downgrade");
    assert.equal(deriveEvidenceDisposition(decision), "sufficient");
    assert.equal(isUnsafeDowngrade(decision), false);
  });
});
