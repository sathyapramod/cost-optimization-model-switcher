import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertBenchmarkExpectations,
  loadFixtureSuite,
  runBenchmarkSuite,
} from "../benchmark.js";

describe("benchmark suite", () => {
  it("loads fixtures", () => {
    const suite = loadFixtureSuite();
    assert.ok(suite.fixtures.length >= 6);
  });

  it("meets gate routing expectations", () => {
    const report = runBenchmarkSuite();
    assertBenchmarkExpectations(report);
  });

  it("computes cost per success for every cell", () => {
    const report = runBenchmarkSuite();
    for (const f of report.fixtures) {
      assert.equal(f.cells.length, 3);
      for (const c of f.cells) {
        assert.ok(c.costPerSuccessfulTaskUsd > 0);
        assert.ok(c.assumedSuccessRate > 0 && c.assumedSuccessRate <= 1);
      }
    }
  });
});
