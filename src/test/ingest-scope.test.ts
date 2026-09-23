import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estimateEffectiveInputTokens,
  requiresScopedIngest,
  scopedRetentionFraction,
} from "../ingest-scope.js";

describe("ingest-scope", () => {
  it("retains less of log files for straightforward tasks", () => {
    const straight = scopedRetentionFraction("log_file", "straightforward");
    const complex = scopedRetentionFraction("log_file", "complex");
    assert.ok(straight < complex);
  });

  it("reduces large log token estimate materially", () => {
    const raw = 500_000;
    const effective = estimateEffectiveInputTokens(raw, "log_file", "straightforward");
    assert.ok(effective < raw * 0.2);
  });

  it("flags large probes as requiring scoped ingest", () => {
    assert.equal(
      requiresScopedIngest([{ source: "log_file", bytes: 2_000_000 }], "large", 500_000),
      true,
    );
  });
});
