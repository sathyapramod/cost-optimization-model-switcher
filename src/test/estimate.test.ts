import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bandFromTokens,
  bytesToTokens,
  prStatsToTokens,
  resolveContextBand,
} from "../estimate.js";

describe("estimate", () => {
  it("maps bytes to tokens", () => {
    assert.equal(bytesToTokens(4000, "log_file"), 1000);
  });

  it("estimates PR stats", () => {
    const tokens = prStatsToTokens(500, 300, 8);
    assert.equal(tokens, 500 * 15 + 300 * 15 + 8 * 500);
  });

  it("assigns context bands", () => {
    assert.equal(bandFromTokens(10_000), "small");
    assert.equal(bandFromTokens(50_000), "medium");
    assert.equal(bandFromTokens(120_000), "large");
  });

  it("bumps band for large probes", () => {
    const band = resolveContextBand(
      [{ source: "github_pr", additions: 1500, deletions: 800, changedFiles: 25 }],
      20_000,
    );
    assert.equal(band, "medium");
  });
});
