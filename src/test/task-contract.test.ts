import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeTask } from "../task-analyzer.js";
import {
  buildTaskContract,
  deriveObjective,
  deriveRequirements,
  deriveUnderstandingConfidence,
  extractConstraints,
  inferRiskLevel,
  isAnalyticalTask,
} from "../task-contract.js";

describe("task contract", () => {
  it("heuristicTaskDifficulty mirrors analysis.taskDifficulty", () => {
    const analysis = analyzeTask({
      userMessage: "Implement a new Backstage plugin with tests",
    });
    assert.equal(analysis.contract.heuristicTaskDifficulty, analysis.taskDifficulty);
  });

  it("deriveObjective uses first sentence", () => {
    assert.equal(
      deriveObjective("Summarize this log. Also email the team."),
      "Summarize this log.",
    );
  });

  it("extractConstraints finds must/only phrases", () => {
    const c = extractConstraints("Summarize errors only. Must not include info logs.");
    assert.ok(c.some((x) => /only/i.test(x)));
    assert.ok(c.some((x) => /must not/i.test(x)));
  });

  it("deriveRequirements maps ingest to contextUnderstanding", () => {
    const analysis = analyzeTask({
      userMessage: "Summarize this 2MB CI log",
      probes: [{ source: "log_file", bytes: 2_000_000 }],
    });
    const req = deriveRequirements(analysis, analysis.contract.objective, analysis.contextBand);
    assert.ok(req.contextUnderstanding >= 3);
    assert.ok(req.reasoning <= 2);
  });

  it("analytical task detection adds criteria and raises domain/output axes", () => {
    const msg =
      "Compare CAP theorem tradeoffs for our event-sourced payment platform and recommend a consistency model";
    const analysis = analyzeTask({ userMessage: msg });
    assert.equal(isAnalyticalTask(msg, analysis), true);
    assert.ok(analysis.contract.requirements.domainKnowledge >= 4);
    assert.ok(analysis.contract.requirements.outputComplexity >= 4);
    assert.equal(analysis.contract.successSpecification.specId, "analytical");
    assert.ok(
      analysis.contract.successCriteria.some((c) => c.id === "validate_assumptions"),
    );
  });

  it("deriveUnderstandingConfidence flags mixed intent as low", () => {
    const analysis = analyzeTask({
      userMessage: "Review PR diff and implement the fix for the race",
    });
    const conf = deriveUnderstandingConfidence(
      analysis,
      "Review PR diff and implement the fix for the race",
    );
    assert.equal(conf.overall, "medium");
    assert.ok(conf.ambiguities.some((a) => a.includes("mixed")));
  });

  it("inferRiskLevel elevates security and deep migration", () => {
    assert.equal(
      inferRiskLevel(
        ["security"],
        { deepSignals: true, mixedIntent: false, wantsThoroughReview: false },
        "security audit exploit",
      ),
      "critical",
    );
    assert.equal(
      inferRiskLevel(
        ["architect"],
        { deepSignals: true, mixedIntent: false, wantsThoroughReview: false },
        "migration",
      ),
      "high",
    );
  });

  it("buildTaskContract matches analyzeTask.contract", () => {
    const analysis = analyzeTask({
      userMessage: "Review PR #482 diff and list potential bugs",
      probes: [{ source: "github_pr", additions: 1200, deletions: 400, changedFiles: 18 }],
    });
    const built = buildTaskContract({
      userMessage: "Review PR #482 diff and list potential bugs",
      probes: [{ source: "github_pr", additions: 1200, deletions: 400, changedFiles: 18 }],
      contextBand: analysis.contextBand,
      primarySource: analysis.primarySource,
      analysis,
    });
    assert.equal(built.taskType, analysis.contract.taskType);
    assert.deepEqual(built.requirements, analysis.contract.requirements);
    assert.equal(built.heuristicTaskDifficulty, analysis.taskDifficulty);
  });
});

describe("TaskContract examples", () => {
  function contractFor(userMessage: string, probes?: Parameters<typeof analyzeTask>[0]["probes"]) {
    return analyzeTask({ userMessage, probes }).contract;
  }

  it("a) simple summarization", () => {
    const c = contractFor("Summarize this 2MB CI log and list errors only", [
      { source: "log_file", bytes: 2_000_000 },
    ]);
    assert.equal(c.taskType, "summarization");
    assert.equal(c.riskLevel, "low");
    assert.equal(c.successSpecification.specId, "summarization");
    assert.ok(c.successCriteria.some((s) => s.id === "preserve_key_facts"));
  });

  it("b) PR review", () => {
    const c = contractFor("Review PR #482 diff and list potential bugs", [
      { source: "github_pr", additions: 1200, deletions: 400, changedFiles: 18 },
    ]);
    assert.equal(c.taskType, "pr_review");
    assert.ok(c.requirements.contextUnderstanding >= 3);
    assert.equal(c.successSpecification.specId, "code_review");
    assert.ok(c.successCriteria.some((s) => s.id === "identify_known_defects"));
  });

  it("c) debugging", () => {
    const c = contractFor("Fix the race condition in this 100-line concurrency module", [
      { source: "paste", bytes: 8000 },
    ]);
    assert.equal(c.taskType, "debugging");
    assert.ok(c.requirements.coding >= 3);
    assert.equal(c.successSpecification.specId, "debugging");
    assert.ok(c.successCriteria.some((s) => s.id === "identify_root_cause"));
  });

  it("d) architecture design", () => {
    const c = contractFor("Design auth migration from this database dump", [
      { source: "database_dump", bytes: 500_000 },
    ]);
    assert.equal(c.taskType, "architecture");
    assert.equal(c.riskLevel, "high");
    assert.ok(c.requirements.architecture >= 4);
  });

  it("e) complex analytical question", () => {
    const c = contractFor(
      "Analyze how eventual consistency in our checkout service affects duplicate charge risk under partition",
    );
    assert.ok(c.requirements.domainKnowledge >= 3);
    assert.equal(c.successSpecification.specId, "analytical");
    assert.ok(c.successCriteria.some((s) => s.id === "consider_constraints"));
  });
});
