import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDecisionTrace,
  formatDecisionTraceText,
  gateDecisionWithTrace,
} from "../decision-trace.js";
import { evaluateGate } from "../gate.js";
import { classifyRoutingDecision } from "../router-benchmark.js";
import type { GateDecision } from "../types.js";

function assertTraceAlignsWithDecision(decision: GateDecision): void {
  const trace = buildDecisionTrace(decision);
  assert.equal(trace.gateReason, decision.reason);
  assert.equal(trace.routingOutcome, classifyRoutingDecision(decision));

  if (decision.action === "suggest_switch" && decision.suggestSwitch) {
    const dir = decision.suggestSwitch.switch_direction;
    assert.equal(trace.label, dir === "upgrade" ? "UPGRADE" : "DOWNGRADE");
    assert.equal(trace.recommendedModel?.modelId, decision.suggestSwitch.recommended_model_id);
    assert.ok(trace.cost);
    assert.equal(trace.cost!.currentUsd, decision.suggestSwitch.estimated_cost_current_usd);
  } else if (classifyRoutingDecision(decision) === "abstain") {
    if (decision.reason.includes("opted out")) {
      assert.equal(trace.label, "OPT_OUT");
    } else {
      assert.equal(trace.label, "ABSTAIN");
    }
  } else if (decision.reason.includes("unknown model")) {
    assert.equal(trace.label, "SKIP_UNKNOWN_MODEL");
  } else {
    assert.equal(trace.label, "KEEP_CURRENT_MODEL");
  }
}

describe("decision trace", () => {
  it("downgrade trace matches suggest_switch downgrade", () => {
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Summarize this 2MB CI log",
      probes: [{ source: "log_file", bytes: 2_000_000 }],
    });
    assert.equal(decision.action, "suggest_switch");
    assert.equal(decision.suggestSwitch?.switch_direction, "downgrade");

    const trace = buildDecisionTrace(decision);
    assertTraceAlignsWithDecision(decision);
    assert.equal(trace.label, "DOWNGRADE");
    assert.match(trace.headline, /^DOWNGRADE →/);
    assert.ok(trace.why.some((b) => /Lower-cost capable model/i.test(b)));
    assert.equal(trace.qualityEvidence.status, "available");

    const text = formatDecisionTraceText(trace);
    assert.match(text, /Decision:\n  DOWNGRADE →/);
    assert.match(text, /Estimated cost:/);
  });

  it("upgrade trace matches suggest_switch upgrade", () => {
    const decision = evaluateGate({
      currentModel: "claude-haiku-4-5",
      userMessage: "Implement a new Backstage plugin for Git repo registration with tests",
    });
    assert.equal(decision.action, "suggest_switch");
    assert.equal(decision.suggestSwitch?.switch_direction, "upgrade");

    const trace = buildDecisionTrace(decision);
    assertTraceAlignsWithDecision(decision);
    assert.equal(trace.label, "UPGRADE");
    assert.match(trace.headline, /^UPGRADE →/);
    assert.ok(trace.why.some((b) => /Higher capability tier/i.test(b)));
  });

  it("stay trace for complex task on premium", () => {
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Design auth migration from this database dump",
      probes: [{ source: "database_dump", bytes: 2_000_000 }],
    });
    assert.equal(decision.action, "proceed");
    assert.equal(classifyRoutingDecision(decision), "stay");

    const trace = buildDecisionTrace(decision);
    assertTraceAlignsWithDecision(decision);
    assert.equal(trace.label, "KEEP_CURRENT_MODEL");
    assert.equal(trace.headline, "KEEP CURRENT MODEL");
    assert.ok(trace.why.some((b) => /complex/i.test(b)));

    const text = formatDecisionTraceText(trace);
    assert.match(text, /Decision:\n  KEEP CURRENT MODEL/);
  });

  it("abstain trace for underspecified analyze with large log", () => {
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Analyze this.",
      probes: [{ source: "log_file", bytes: 2_000_000 }],
    });
    assert.equal(decision.action, "proceed");
    assert.equal(classifyRoutingDecision(decision), "abstain");

    const trace = buildDecisionTrace(decision);
    assertTraceAlignsWithDecision(decision);
    assert.equal(trace.label, "ABSTAIN");
    assert.equal(trace.headline, "ABSTAIN");
    assert.equal(trace.qualityEvidence.status, "insufficient");
    assert.ok(trace.why.length > 0);

    const text = formatDecisionTraceText(trace);
    assert.match(text, /Decision:\n  ABSTAIN/);
    assert.match(text, /Why:/);
  });

  it("gateDecisionWithTrace adds decisionTrace without dropping gate fields", () => {
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Review PR #482 diff and list potential bugs",
      probes: [
        {
          source: "github_pr",
          additions: 1200,
          deletions: 400,
          changedFiles: 18,
        },
      ],
    });
    const payload = gateDecisionWithTrace(decision);
    assert.equal(payload.action, decision.action);
    assert.equal(payload.reason, decision.reason);
    assert.ok(payload.decisionTrace);
    assert.equal(payload.decisionTrace.label, "DOWNGRADE");

    const parsed = JSON.parse(JSON.stringify(payload)) as typeof payload;
    assert.equal(parsed.decisionTrace.routingOutcome, classifyRoutingDecision(decision));
    assert.equal(parsed.decisionTrace.gateReason, decision.reason);
  });
});
