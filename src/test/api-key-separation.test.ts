import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, beforeEach, afterEach } from "node:test";
import { evaluateGate } from "../gate.js";
import {
  assertLiveModelConfigured,
  liveCompletionRequestCount,
  LiveModelError,
  openaiCompletionLimitField,
} from "../task-quality/live-client.js";
import { runLiveBenchmarkEvaluation } from "../task-quality/live-evaluation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, "..", "..", "src");

/** Placeholder env values for tests — never real credentials. */
const FAKE_ANTHROPIC = "test-anthropic-key-not-real";
const FAKE_OPENAI = "test-openai-key-not-real";

function restoreEnv(key: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY", saved: string | undefined): void {
  if (saved === undefined) delete process.env[key];
  else process.env[key] = saved;
}

function assertActionableMissingKeyError(err: unknown, expectedEnvVar: string): void {
  assert.ok(err instanceof LiveModelError);
  assert.equal(err.code, "missing_api_key");
  assert.match(err.message, new RegExp(`${expectedEnvVar} is required for live evaluation`));
  assert.match(err.message, /cost gate does not use provider API keys/i);
}

function withFetchBlocked<T>(fn: () => T): T {
  const original = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls++;
    throw new Error("gate path must not perform live HTTP requests");
  }) as typeof fetch;
  try {
    const result = fn();
    assert.equal(fetchCalls, 0, "expected zero fetch calls on gate path");
    return result;
  } finally {
    globalThis.fetch = original;
  }
}

describe("API key isolation regression", () => {
  const savedAnthropic = process.env.ANTHROPIC_API_KEY;
  const savedOpenai = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    restoreEnv("ANTHROPIC_API_KEY", savedAnthropic);
    restoreEnv("OPENAI_API_KEY", savedOpenai);
  });

  it("Test 1: gate succeeds with both keys unset and makes zero live provider calls", () => {
    const before = liveCompletionRequestCount;
    withFetchBlocked(() => {
      const decision = evaluateGate({
        currentModel: "claude-opus-4-6",
        userMessage: "Summarize this CI log",
        probes: [{ source: "log_file", bytes: 2_000_000 }],
      });
      assert.equal(decision.action, "suggest_switch");
    });
    assert.equal(liveCompletionRequestCount, before);
  });

  it("Test 2: Anthropic live evaluation fails clearly without ANTHROPIC_API_KEY", () => {
    assert.throws(
      () => assertLiveModelConfigured({ provider: "anthropic", modelId: "claude-haiku-4-5" }),
      (err: unknown) => {
        assertActionableMissingKeyError(err, "ANTHROPIC_API_KEY");
        return true;
      },
    );
  });

  it("Test 2b: runLiveBenchmarkEvaluation rejects before cases when Anthropic key missing", async () => {
    await assert.rejects(
      () =>
        runLiveBenchmarkEvaluation({
          target: { provider: "anthropic", modelId: "claude-haiku-4-5" },
          benchmarkSplit: "holdout",
          maxCases: 1,
        }),
      (err: unknown) => {
        assertActionableMissingKeyError(err, "ANTHROPIC_API_KEY");
        return true;
      },
    );
  });

  it("Test 3: OpenAI live evaluation fails clearly without OPENAI_API_KEY", () => {
    assert.throws(
      () => assertLiveModelConfigured({ provider: "openai", modelId: "gpt-4o-mini" }),
      (err: unknown) => {
        assertActionableMissingKeyError(err, "OPENAI_API_KEY");
        return true;
      },
    );
  });

  it("Test 3b: runLiveBenchmarkEvaluation rejects before cases when OpenAI key missing", async () => {
    await assert.rejects(
      () =>
        runLiveBenchmarkEvaluation({
          target: { provider: "openai", modelId: "gpt-4o-mini" },
          benchmarkSplit: "holdout",
          maxCases: 1,
        }),
      (err: unknown) => {
        assertActionableMissingKeyError(err, "OPENAI_API_KEY");
        return true;
      },
    );
  });

  it("Test 4: Anthropic live evaluation does not require OPENAI_API_KEY", async () => {
    process.env.ANTHROPIC_API_KEY = FAKE_ANTHROPIC;
    assert.doesNotThrow(() =>
      assertLiveModelConfigured({ provider: "anthropic", modelId: "claude-haiku-4-5" }),
    );
    const before = liveCompletionRequestCount;
    const report = await runLiveBenchmarkEvaluation({
      target: { provider: "anthropic", modelId: "claude-haiku-4-5" },
      benchmarkSplit: "holdout",
      maxCases: 1,
      append: false,
      outPath: join(mkdtempSync(join(tmpdir(), "live-eval-")), "runs.json"),
      completeFn: async () => ({
        output: "fixture-style stub",
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 5,
      }),
    });
    assert.equal(liveCompletionRequestCount, before);
    assert.ok(report.summary.caseCount >= 1);
    assert.equal(report.summary.evaluated, 1);
  });

  it("Test 5: OpenAI live evaluation does not require ANTHROPIC_API_KEY", async () => {
    process.env.OPENAI_API_KEY = FAKE_OPENAI;
    assert.doesNotThrow(() =>
      assertLiveModelConfigured({ provider: "openai", modelId: "gpt-4o-mini" }),
    );
    const before = liveCompletionRequestCount;
    const report = await runLiveBenchmarkEvaluation({
      target: { provider: "openai", modelId: "gpt-4o-mini" },
      benchmarkSplit: "holdout",
      maxCases: 1,
      append: false,
      outPath: join(mkdtempSync(join(tmpdir(), "live-eval-")), "runs.json"),
      completeFn: async () => ({
        output: "fixture-style stub",
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 5,
      }),
    });
    assert.equal(liveCompletionRequestCount, before);
    assert.ok(report.summary.caseCount >= 1);
    assert.equal(report.summary.evaluated, 1);
  });

  it("Test 6: gate source path does not import live provider client", () => {
    for (const rel of ["gate.ts", "cli.ts", "decision-trace.ts", "cost.ts"]) {
      const src = readFileSync(join(srcRoot, rel), "utf8");
      assert.doesNotMatch(
        src,
        /live-client|completeLiveModel|task-quality\/live-evaluation/,
        `${rel} must not depend on live evaluation modules`,
      );
    }
  });

  it("Test 6b: evaluateGate never increments live completion counter (fetch blocked)", () => {
    process.env.ANTHROPIC_API_KEY = FAKE_ANTHROPIC;
    process.env.OPENAI_API_KEY = FAKE_OPENAI;
    const before = liveCompletionRequestCount;
    withFetchBlocked(() => {
      evaluateGate({
        currentModel: "claude-opus-4-6",
        userMessage: "Summarize this CI log",
        probes: [{ source: "log_file", bytes: 2_000_000 }],
      });
    });
    assert.equal(liveCompletionRequestCount, before);
  });
});

describe("openaiCompletionLimitField", () => {
  it("uses max_completion_tokens for o-series reasoning models", () => {
    assert.equal(openaiCompletionLimitField("o3"), "max_completion_tokens");
    assert.equal(openaiCompletionLimitField("o1-preview"), "max_completion_tokens");
    assert.equal(openaiCompletionLimitField("o4-mini"), "max_completion_tokens");
  });

  it("keeps max_tokens for gpt models", () => {
    assert.equal(openaiCompletionLimitField("gpt-4o"), "max_tokens");
    assert.equal(openaiCompletionLimitField("gpt-4o-mini"), "max_tokens");
  });
});
