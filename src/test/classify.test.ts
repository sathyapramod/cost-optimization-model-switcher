import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyTask,
  needsPremiumUpgrade,
  scoreIngestComplexity,
  scoreTaskDifficulty,
} from "../classify.js";

describe("task vs ingest scores", () => {
  it("low task difficulty for summarize even when ingest band is large", () => {
    const task = scoreTaskDifficulty("Summarize this 50MB CI log");
    const ingest = scoreIngestComplexity("large", 500_000);
    assert.ok(task <= 1);
    assert.equal(ingest, 5);
  });

  it("high task difficulty for small concurrency fix", () => {
    const task = scoreTaskDifficulty("Fix the race condition in this 100-line module");
    const ingest = scoreIngestComplexity("small", 5_000);
    assert.ok(task >= 2);
    assert.ok(ingest <= 1);
  });

  it("does not require premium for sonnet on small complex fix", () => {
    assert.equal(
      needsPremiumUpgrade(
        "Fix the race condition in this 100-line module",
        "small",
        scoreTaskDifficulty("Fix the race condition in this 100-line module"),
      ),
      false,
    );
  });
});

describe("classifyTask", () => {
  it("marks summarize requests as straightforward", () => {
    assert.equal(classifyTask("Summarize this 2MB CI log"), "straightforward");
  });

  it("marks implement requests as complex", () => {
    assert.equal(classifyTask("Implement the auth migration from this dump"), "complex");
  });

  it("prefers complex when mixed signals", () => {
    assert.equal(
      classifyTask("Review PR diff and implement the fix for the race"),
      "complex",
    );
  });
});
