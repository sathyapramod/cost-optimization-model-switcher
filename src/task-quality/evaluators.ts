import type { EvaluableCriterion, CriterionEvaluationResult } from "./types.js";
import type { SuccessCriterionType } from "../success-criteria.js";

export const TASK_CONTRACT_EVALUATOR_ID = "task-contract-evaluator-v1";

export interface EvaluateOutputInput {
  output: string;
  criteria: EvaluableCriterion[];
}

function includesAll(text: string, parts: string[]): string[] {
  const lower = text.toLowerCase();
  return parts.filter((p) => !lower.includes(p.toLowerCase()));
}

function matchPatterns(text: string, patterns: string[], mode: "any" | "all"): boolean {
  if (patterns.length === 0) return true;
  const flags = "i";
  const regexes = patterns.map((p) => new RegExp(p, flags));
  if (mode === "any") return regexes.some((r) => r.test(text));
  return regexes.every((r) => r.test(text));
}

function countBulletLines(text: string): number {
  return text.split("\n").filter((l) => /^\s*[-*•]\s+/.test(l)).length;
}

function extractJsonPayload(output: string): unknown {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? output).trim();
  return JSON.parse(raw);
}

function runDeterministicCheck(
  check: string,
  output: string,
  spec: EvaluableCriterion["spec"] = {},
): { passed: boolean; score: number; details: string } {
  switch (check) {
    case "non_empty":
      return {
        passed: output.trim().length > 0,
        score: output.trim().length > 0 ? 1 : 0,
        details: "output must be non-empty",
      };
    case "has_code_fence": {
      const has = /```[\s\S]*?```/.test(output);
      return { passed: has, score: has ? 1 : 0, details: "expects fenced code block" };
    }
    case "structured_json": {
      try {
        const parsed = extractJsonPayload(output) as Record<string, unknown>;
        const missing = (spec.requiredKeys ?? []).filter((k) => !(k in parsed));
        if (missing.length) {
          return {
            passed: false,
            score: 0,
            details: `JSON missing keys: ${missing.join(", ")}`,
          };
        }
        const itemKeys = spec.itemKeys ?? [];
        if (itemKeys.length) {
          const firstArray = Object.values(parsed).find((v) => Array.isArray(v)) as
            | Record<string, unknown>[]
            | undefined;
          if (!firstArray?.length) {
            return { passed: false, score: 0, details: "expected a non-empty JSON array" };
          }
          const bad = firstArray.find((item) =>
            itemKeys.some((k) => !(k in item)),
          );
          if (bad) {
            return {
              passed: false,
              score: 0,
              details: `array items missing keys: ${itemKeys.join(", ")}`,
            };
          }
        }
        return { passed: true, score: 1, details: "valid structured JSON" };
      } catch (e) {
        return {
          passed: false,
          score: 0,
          details: `invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }
    case "exports_named_function": {
      const name = spec.functionName ?? "";
      const codeMatch = output.match(/```[\s\S]*?```/);
      const code = codeMatch?.[0] ?? output;
      const found = new RegExp(
        `(export\\s+)?(async\\s+)?function\\s+${name}\\b|const\\s+${name}\\s*=`,
      ).test(code);
      return {
        passed: found,
        score: found ? 1 : 0,
        details: found ? `exports ${name}` : `missing function ${name}`,
      };
    }
    case "embedded_test_assertions": {
      const patterns = spec.testPatterns ?? [];
      if (!patterns.length) {
        return { passed: false, score: 0, details: "no testPatterns configured" };
      }
      const hits = patterns.filter((p) => new RegExp(p, "i").test(output)).length;
      const score = hits / patterns.length;
      return {
        passed: score >= 1,
        score,
        details:
          score >= 1
            ? "all test assertion patterns present"
            : `missing test patterns (${hits}/${patterns.length})`,
      };
    }
    default:
      return { passed: false, score: 0, details: `unknown deterministic check: ${check}` };
  }
}

function evaluateOne(criterion: EvaluableCriterion, output: string): CriterionEvaluationResult {
  const spec = criterion.spec ?? {};
  const base = {
    criterionId: criterion.id,
    type: criterion.type,
    evaluator: `${TASK_CONTRACT_EVALUATOR_ID}/${criterion.type}`,
  };

  if (criterion.type === "llm_judge") {
    return {
      ...base,
      passed: false,
      score: 0,
      details: "LLM-as-judge not implemented; use deterministic or structured checks",
    };
  }

  if (criterion.type === "human") {
    return {
      ...base,
      passed: false,
      score: 0,
      details: "human review required — not evaluated offline",
    };
  }

  if (criterion.type === "deterministic" && spec.check) {
    const r = runDeterministicCheck(spec.check, output, spec);
    return { ...base, passed: r.passed, score: r.score, details: r.details };
  }

  const missing = spec.mustInclude ? includesAll(output, spec.mustInclude) : [];
  const forbidden = spec.mustNotInclude
    ? spec.mustNotInclude.filter((p) => output.toLowerCase().includes(p.toLowerCase()))
    : [];

  let score = 1;
  const issues: string[] = [];

  if (missing.length) {
    issues.push(`missing required phrases: ${missing.join(", ")}`);
    score = 0;
  }
  if (forbidden.length) {
    issues.push(`forbidden phrases present: ${forbidden.join(", ")}`);
    score = 0;
  }
  if (spec.patternsAny && !matchPatterns(output, spec.patternsAny, "any")) {
    issues.push(`no pattern matched from: ${spec.patternsAny.join(" | ")}`);
    score = 0;
  }
  if (spec.patternsAll && !matchPatterns(output, spec.patternsAll, "all")) {
    issues.push(`not all required patterns matched`);
    score = 0;
  }
  if (spec.minBulletLines != null && countBulletLines(output) < spec.minBulletLines) {
    issues.push(`expected at least ${spec.minBulletLines} bullet lines`);
    score = 0;
  }

  if (criterion.type === "rubric" && spec.rubricKeywords?.length) {
    const lower = output.toLowerCase();
    const hit = spec.rubricKeywords.filter((k) => lower.includes(k.toLowerCase())).length;
    score = hit / spec.rubricKeywords.length;
    if (score < 1) {
      issues.push(`rubric keyword coverage ${Math.round(score * 100)}%`);
    }
  }

  const passed = criterion.required ? score >= 1 : score >= 0.5;

  return {
    ...base,
    passed,
    score: Math.round(score * 1000) / 1000,
    details: issues.length ? issues.join("; ") : "checks satisfied",
  };
}

export function evaluateOutputAgainstCriteria(
  input: EvaluateOutputInput,
): CriterionEvaluationResult[] {
  return input.criteria.map((c) => evaluateOne(c, input.output));
}

export function aggregateQualityScore(
  results: CriterionEvaluationResult[],
  criteria: EvaluableCriterion[],
): { qualityScore: number; passed: boolean; errors: string[] } {
  const errors: string[] = [];
  const required = criteria.filter((c) => c.required);
  const requiredResults = results.filter((r) =>
    required.some((c) => c.id === r.criterionId),
  );

  for (const r of requiredResults) {
    if (r.type === "llm_judge") {
      errors.push(`${r.criterionId}: ${r.details}`);
    }
    if (r.type === "human" && !r.passed) {
      errors.push(`${r.criterionId}: pending human review`);
    }
  }

  const requiredFailed = requiredResults.filter((r) => !r.passed);
  const passed = requiredFailed.length === 0 && requiredResults.length > 0;

  if (results.length === 0) {
    return { qualityScore: 0, passed: false, errors: ["no criteria evaluated"] };
  }

  const weights = criteria.map((c) => (c.required ? 2 : 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let weighted = 0;
  for (const c of criteria) {
    const r = results.find((x) => x.criterionId === c.id);
    const w = c.required ? 2 : 1;
    weighted += (r?.score ?? 0) * w;
  }
  const qualityScore = Math.round((weighted / totalWeight) * 1000) / 1000;

  return { qualityScore, passed, errors };
}
