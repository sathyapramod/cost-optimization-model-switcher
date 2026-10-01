import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { evaluateGate } from "../gate.js";
import {
  assertLiveModelConfigured,
  completeLiveModel,
  liveCompletionRequestCount,
  LiveModelError,
} from "../task-quality/live-client.js";
import { runLiveBenchmarkEvaluation } from "../task-quality/live-evaluation.js";

describe("API key separation (gate vs live evaluation)", () => {
  const savedAnthropic = process.env.ANTHROPIC_API_KEY;
  const savedOpenai = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (savedAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedAnthropic;
    if (savedOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedOpenai;
  });

  it("gate succeeds with both provider API keys unset", () => {
    const before = liveCompletionRequestCount;
    const decision = evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Summarize this CI log",
      probes: [{ source: "log_file", bytes: 2_000_000 }],
    });
    assert.equal(decision.action, "suggest_switch");
    assert.equal(liveCompletionRequestCount, before);
  });

  it("anthropic live evaluation requires ANTHROPIC_API_KEY only", () => {
    process.env.OPENAI_API_KEY = "sk-test-openai-only";
    assert.throws(
      () => assertLiveModelConfigured({ provider: "anthropic", modelId: "claude-haiku-4-5" }),
      (err: unknown) => {
        assert.ok(err instanceof LiveModelError);
        assert.match(err.message, /ANTHROPIC_API_KEY/);
        assert.doesNotMatch(err.message, /OPENAI_API_KEY is required/);
        return true;
      },
    );
  });

  it("openai live evaluation requires OPENAI_API_KEY only", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-anthropic-only";
    assert.throws(
      () => assertLiveModelConfigured({ provider: "openai", modelId: "gpt-4o-mini" }),
      (err: unknown) => {
        assert.ok(err instanceof LiveModelError);
        assert.match(err.message, /OPENAI_API_KEY/);
        assert.doesNotMatch(err.message, /ANTHROPIC_API_KEY is required/);
        return true;
      },
    );
  });

  it("runLiveBenchmarkEvaluation fails fast without the selected provider key", async () => {
    await assert.rejects(
      () =>
        runLiveBenchmarkEvaluation({
          target: { provider: "anthropic", modelId: "claude-haiku-4-5" },
          benchmarkSplit: "holdout",
          maxCases: 1,
        }),
      (err: unknown) => {
        assert.ok(err instanceof LiveModelError);
        assert.match(err.message, /ANTHROPIC_API_KEY/);
        return true;
      },
    );
  });

  it("completeLiveModel is not invoked by the gate path", async () => {
    const before = liveCompletionRequestCount;
    evaluateGate({
      currentModel: "claude-opus-4-6",
      userMessage: "Summarize this CI log",
      probes: [{ source: "log_file", bytes: 2_000_000 }],
    });
    assert.equal(liveCompletionRequestCount, before);
    await assert.rejects(
      () => completeLiveModel({ provider: "anthropic", modelId: "claude-haiku-4-5" }, "hi"),
      LiveModelError,
    );
    assert.equal(liveCompletionRequestCount, before);
  });
});
