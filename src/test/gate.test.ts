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
    assert.equal(decision.suggestSwitch?.recommended_capability_tier, "balanced");
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

  it("skips gate when not on opus for straightforward tasks", () => {
    const decision = evaluateGate({
      currentModel: "claude-sonnet-4-6",
      userMessage: "Summarize this log",
      probes: [{ source: "log_file", bytes: 900_000 }],
    });

    assert.equal(decision.action, "proceed");
    assert.match(decision.reason, /straightforward on balanced/);
  });

  it("suggests sonnet upgrade on haiku for moderate implement tasks", () => {
    const decision = evaluateGate({
      currentModel: "claude-haiku-4-5",
      userMessage: "Implement a new Backstage plugin for Git repo registration with tests",
    });

    assert.equal(decision.action, "suggest_switch");
    assert.equal(decision.suggestSwitch?.recommended_capability_tier, "balanced");
    assert.equal(decision.suggestSwitch?.recommended_model_id, "claude-sonnet-4-6");
  });

  it("suggests opus upgrade on haiku for deep complex tasks", () => {
    const decision = evaluateGate({
      currentModel: "claude-haiku-4-5",
      userMessage: "Design auth migration from this database dump",
      probes: [{ source: "database_dump", bytes: 500_000 }],
    });

    assert.equal(decision.action, "suggest_switch");
    assert.equal(decision.suggestSwitch?.recommended_capability_tier, "premium");
    assert.equal(decision.suggestSwitch?.provider, "anthropic");
    assert.equal(decision.suggestSwitch?.switch_direction, "upgrade");
  });

  it("downgrades OpenAI premium on large straightforward task", () => {
    const decision = evaluateGate({
      currentModel: "o3",
      userMessage: "Summarize this 2MB CI log",
      probes: [{ source: "log_file", bytes: 2_000_000 }],
    });

    assert.equal(decision.action, "suggest_switch");
    assert.equal(decision.suggestSwitch?.provider, "openai");
    assert.equal(decision.suggestSwitch?.switch_direction, "downgrade");
    assert.equal(decision.suggestSwitch?.recommended_capability_tier, "fast");
    assert.equal(decision.suggestSwitch?.recommended_model_id, "gpt-4o-mini");
  });

  it("upgrades Cursor fast tier for complex tasks", () => {
    const decision = evaluateGate({
      currentModel: "cursor-small",
      provider: "cursor",
      userMessage: "Implement distributed auth migration",
      probes: [{ source: "database_dump", bytes: 100_000 }],
    });

    assert.equal(decision.action, "suggest_switch");
    assert.equal(decision.suggestSwitch?.switch_direction, "upgrade");
    assert.equal(decision.suggestSwitch?.provider, "cursor");
  });

  it("suggests opus upgrade on sonnet for deep complex tasks", () => {
    const decision = evaluateGate({
      currentModel: "claude-sonnet-4-6",
      userMessage: "Architect multi-service migration from this dump",
      probes: [{ source: "database_dump", bytes: 200_000 }],
    });

    assert.equal(decision.action, "suggest_switch");
    assert.equal(decision.suggestSwitch?.recommended_capability_tier, "premium");
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
