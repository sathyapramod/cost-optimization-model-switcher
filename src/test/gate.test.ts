import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateGate } from "../gate.js";

describe("evaluateGate", () => {
  it("suggests switch on opus + large PR review", () => {
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Review PR #482 diff and list potential bugs",
      probes: [
        {
          source: "github_pr",
          additions: 1200,
          deletions: 400,
          changedFiles: 18,
          refs: ["https://github.com/org/repo/pull/482"],
        },
      ],
    });

    assert.equal(decision.action, "suggest_switch");
    assert.equal(decision.suggestSwitch?.recommended_model, "sonnet");
    assert.equal(decision.taskClass, "straightforward");
  });

  it("stays on opus for complex architecture tasks", () => {
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Design auth migration from this database dump",
      probes: [{ source: "database_dump", bytes: 2_000_000 }],
    });

    assert.equal(decision.action, "proceed");
    assert.match(decision.reason, /complex/);
  });

  it("skips gate when not on opus", () => {
    const decision = evaluateGate({
      currentModel: "claude-sonnet-4-6",
      userMessage: "Summarize this log",
      probes: [{ source: "log_file", bytes: 900_000 }],
    });

    assert.equal(decision.action, "proceed");
    assert.match(decision.reason, /already on sonnet/);
  });

  it("respects user opt-out", () => {
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Summarize this log",
      probes: [{ source: "log_file", bytes: 900_000 }],
      userOptedOut: true,
    });

    assert.equal(decision.action, "proceed");
    assert.match(decision.reason, /opted out/);
  });
});
