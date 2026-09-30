import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runLiveBenchmarkEvaluation } from "../task-quality/live-evaluation.js";

describe("live benchmark resilience", () => {
  it("records a per-case error and keeps evaluating remaining cases instead of throwing", async () => {
    let call = 0;
    const report = await runLiveBenchmarkEvaluation({
      target: { provider: "openai", modelId: "gpt-4o-mini" },
      benchmarkSplit: "holdout",
      completeFn: async () => {
        call++;
        if (call === 1) {
          throw new Error("OpenAI API 429: insufficient_quota");
        }
        return { output: "some output", latencyMs: 1, inputTokens: 10, outputTokens: 5 };
      },
    });

    assert.ok(report.summary.caseCount > 1, "expected multiple holdout cases");
    assert.equal(report.summary.errored, 1);
    assert.equal(
      report.summary.evaluated,
      report.summary.caseCount - 1,
      "remaining cases must still be evaluated after one failure",
    );
    const erroredCase = report.cases.find((c) => c.error);
    assert.ok(erroredCase);
    assert.match(erroredCase!.error!, /insufficient_quota/);
    assert.ok(!erroredCase!.result, "errored case must not have a result");
  });
});
