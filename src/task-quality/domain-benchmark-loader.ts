import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskCategory } from "../task-types.js";
import type {
  BenchmarkDomain,
  TaskCase,
  TaskCaseCandidate,
  TaskCaseContext,
  TaskQualityFixtureSuite,
} from "./types.js";
import type { EvaluableCriterion } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const benchmarksRoot = join(__dirname, "..", "..", "benchmarks");

export const BENCHMARK_DOMAIN_DIRS: BenchmarkDomain[] = [
  "summarization",
  "extraction",
  "coding",
  "code-review",
  "debugging",
  "architecture",
  "security",
  "analytical",
];

export interface DomainBenchmarkSuiteFile {
  version: string;
  domain: BenchmarkDomain;
  description?: string;
  cases: DomainBenchmarkCaseRaw[];
}

export interface DomainBenchmarkCaseRaw {
  id: string;
  benchmarkSplit?: "train" | "holdout";
  task: string;
  context?: TaskCaseContext;
  taskType?: string;
  category?: TaskCategory;
  requirements?: Record<string, number>;
  successCriteria: EvaluableCriterion[];
  evaluator?: string;
  expectedBehavior?: TaskCase["expectedBehavior"];
  criteriaSource?: TaskCase["criteriaSource"];
  candidates: TaskCaseCandidate[];
}

function defaultCategory(domain: BenchmarkDomain): TaskCategory {
  switch (domain) {
    case "summarization":
    case "extraction":
      return "summarization";
    case "coding":
      return "crud_implementation";
    case "code-review":
      return "pr_review";
    case "debugging":
      return "debugging";
    case "architecture":
      return "architecture";
    case "security":
      return "security";
    case "analytical":
      return "other";
    default:
      return "other";
  }
}

function normalizeCase(raw: DomainBenchmarkCaseRaw, domain: BenchmarkDomain): TaskCase {
  const probes = raw.context?.probes;
  return {
    id: raw.id,
    benchmarkSplit: raw.benchmarkSplit ?? "train",
    domain,
    taskType: raw.taskType ?? domain,
    category: raw.category ?? defaultCategory(domain),
    userMessage: raw.task,
    context: raw.context,
    requirements: raw.requirements,
    expectedBehavior: raw.expectedBehavior,
    evaluator: raw.evaluator ?? "task-contract-evaluator-v1",
    probes,
    criteriaSource: raw.criteriaSource ?? "fixture_only",
    evaluationCriteria: raw.successCriteria,
    candidates: raw.candidates,
  };
}

export function loadDomainBenchmarkSuites(
  root = benchmarksRoot,
): { suites: DomainBenchmarkSuiteFile[]; cases: TaskCase[] } {
  const suites: DomainBenchmarkSuiteFile[] = [];
  const cases: TaskCase[] = [];

  for (const domain of BENCHMARK_DOMAIN_DIRS) {
    const path = join(root, domain, "suite.json");
    if (!existsSync(path)) continue;
    const suite = JSON.parse(readFileSync(path, "utf8")) as DomainBenchmarkSuiteFile;
    suites.push(suite);
    for (const raw of suite.cases) {
      cases.push(normalizeCase(raw, domain));
    }
  }

  return { suites, cases };
}

export function mergeTaskQualitySuites(
  legacy: TaskQualityFixtureSuite,
  domainCases: TaskCase[],
): TaskQualityFixtureSuite {
  const byId = new Map<string, TaskCase>();
  for (const c of domainCases) byId.set(c.id, c);
  for (const c of legacy.cases) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }
  return {
    version: legacy.version,
    note:
      "Merged domain task-quality suites under benchmarks/<domain>/ plus legacy task-quality/fixtures.json.",
    cases: [...byId.values()],
  };
}
