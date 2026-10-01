import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADVERSARIAL_TRAPS,
  assertAdversarialSuite,
  loadAdversarialSuite,
  runAdversarialCase,
  runAdversarialSuite,
} from "../adversarial.js";

describe("adversarial trap coverage", () => {
  it("every trap class has at least one fixture with input, expect, and reason", () => {
    const suite = loadAdversarialSuite();
    const byTrap = new Map<string, typeof suite.cases>();
    for (const c of suite.cases) {
      assert.ok(c.trap, c.id);
      assert.ok(c.reason.length > 0, `${c.id} needs reason`);
      assert.ok(c.userMessage.length > 0, `${c.id} needs input`);
      assert.ok(c.expect?.action, `${c.id} needs expected decision`);
      const list = byTrap.get(c.trap) ?? [];
      list.push(c);
      byTrap.set(c.trap, list);
    }
    for (const trap of ADVERSARIAL_TRAPS) {
      assert.ok((byTrap.get(trap)?.length ?? 0) >= 1, `missing trap fixture: ${trap}`);
    }
  });

  it("all fixtures pass against evaluateGate (permanent regression)", () => {
    const report = runAdversarialSuite();
    assertAdversarialSuite(report);
    assert.ok(report.summary.caseCount >= ADVERSARIAL_TRAPS.length);
  });

  it("unknown-model fixture skips switching", () => {
    const suite = loadAdversarialSuite();
    const c = suite.cases.find((x) => x.id === "fp-unknown-model-no-switch");
    assert.ok(c);
    const result = runAdversarialCase(c!, suite.provider);
    assert.equal(result.passed, true);
    assert.match(result.decision.reason, /unknown model/);
    assert.equal(result.decision.action, "proceed");
  });

  it("underspecified fixture abstains rather than downgrading", () => {
    const suite = loadAdversarialSuite();
    const c = suite.cases.find((x) => x.id === "fp-opus-analyze-this-underspecified");
    assert.ok(c);
    const result = runAdversarialCase(c!, suite.provider);
    assert.equal(result.passed, true);
    assert.equal(result.decision.routing?.qualityAssurance?.guarantee.level, "abstain");
  });
});
