import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadFixtureSuite } from "../benchmark.js";
import { analyzeTask, minimumCapabilityForAnalysis } from "../task-analyzer.js";

describe("analyzeTask", () => {
  it("matches benchmark fixture categories", () => {
    const suite = loadFixtureSuite();
    for (const fixture of suite.fixtures) {
      const analysis = analyzeTask({
        userMessage: fixture.userMessage,
        probes: fixture.probes,
      });
      assert.equal(
        analysis.category,
        fixture.category,
        `category mismatch for ${fixture.id}`,
      );
    }
  });

  it("marks large log summarize as straightforward with high bulk processing need", () => {
    const analysis = analyzeTask({
      userMessage: "Summarize this 2MB CI log and list errors only",
      probes: [{ source: "log_file", bytes: 2_000_000 }],
    });
    assert.equal(analysis.taskClass, "straightforward");
    assert.ok(analysis.features.bulkTextProcessing >= 3);
    assert.equal(analysis.minimumCapability, "fast");
  });

  it("marks auth migration as premium minimum capability", () => {
    const analysis = analyzeTask({
      userMessage: "Design auth migration from this database dump",
      probes: [{ source: "database_dump", bytes: 500_000 }],
    });
    assert.equal(analysis.taskClass, "complex");
    assert.equal(analysis.flags.deepSignals, true);
    assert.equal(minimumCapabilityForAnalysis(analysis), "premium");
  });

  it("detects mixed intent as complex", () => {
    const analysis = analyzeTask({
      userMessage: "Review PR diff and implement the fix for the race",
    });
    assert.equal(analysis.taskClass, "complex");
    assert.equal(analysis.flags.mixedIntent, true);
  });
});
