import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeTask } from "../task-analyzer.js";
import { resolveSuccessSpecId } from "../task-contract.js";
import {
  buildTaskSuccessSpecification,
  criteriaForSpec,
  loadDefaultSuccessCriteriaCatalog,
  optionalCriteria,
  parseSuccessSpecificationJson,
  requiredCriteria,
  serializeSuccessSpecificationJson,
} from "../success-criteria.js";

describe("success criteria catalog", () => {
  const catalog = loadDefaultSuccessCriteriaCatalog();

  it("loads all task specs from JSON", () => {
    assert.ok(catalog.specs.summarization);
    assert.ok(catalog.specs.code_generation);
    assert.ok(catalog.specs.code_review);
    assert.ok(catalog.specs.debugging);
    assert.ok(catalog.specs.architecture);
    assert.ok(catalog.specs.analytical);
  });

  it("summarization criteria match Phase 4 definitions", () => {
    const ids = criteriaForSpec("summarization").map((c) => c.id);
    assert.deepEqual(ids, [
      "preserve_key_facts",
      "no_unsupported_claims",
      "cover_important_sections",
    ]);
    assert.ok(criteriaForSpec("summarization").every((c) => c.required));
  });

  it("code generation includes deterministic compile and test criteria", () => {
    const criteria = criteriaForSpec("code_generation");
    const compiles = criteria.find((c) => c.id === "compiles");
    assert.equal(compiles?.type, "deterministic");
    assert.equal(criteria.find((c) => c.id === "tests_pass")?.type, "deterministic");
  });

  it("analytical criteria include conclusion with uncertainty", () => {
    const ids = criteriaForSpec("analytical").map((c) => c.id);
    assert.ok(ids.includes("validate_assumptions"));
    assert.ok(ids.includes("conclusion_with_uncertainty"));
  });

  it("serializes and parses round-trip", () => {
    const analysis = analyzeTask({
      userMessage: "Review PR #482 diff and list potential bugs",
      probes: [{ source: "github_pr", additions: 100, deletions: 10, changedFiles: 2 }],
    });
    const spec = buildTaskSuccessSpecification("code_review", analysis);
    const json = serializeSuccessSpecificationJson(spec);
    const parsed = parseSuccessSpecificationJson(json);
    assert.deepEqual(parsed.criteria, spec.criteria);
    assert.equal(parsed.specId, "code_review");
  });

  it("required vs optional partition", () => {
    const spec = buildTaskSuccessSpecification(
      "architecture",
      analyzeTask({ userMessage: "Design auth migration" }),
    );
    assert.ok(requiredCriteria(spec).some((c) => c.id === "identify_tradeoffs"));
    assert.ok(optionalCriteria(spec).some((c) => c.id === "address_scalability"));
  });

  it("task contract attaches inspectable successSpecification", () => {
    const analysis = analyzeTask({
      userMessage: "Implement a Backstage plugin with tests",
    });
    assert.equal(analysis.contract.successSpecification.specId, "code_generation");
    assert.deepEqual(
      analysis.contract.successCriteria,
      analysis.contract.successSpecification.criteria,
    );
    assert.equal(resolveSuccessSpecId(analysis, analysis.contract.objective), "code_generation");
  });

  it("underspecified prompt uses underspecified spec", () => {
    const analysis = analyzeTask({ userMessage: "Analyze this." });
    assert.equal(analysis.contract.successSpecification.specId, "underspecified");
    assert.equal(analysis.contract.successSpecification.criteria[0]?.type, "human");
  });
});
