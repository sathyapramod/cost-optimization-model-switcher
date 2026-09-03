import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyTask } from "../classify.js";

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
