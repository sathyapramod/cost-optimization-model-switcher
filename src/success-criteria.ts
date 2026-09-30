import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskAnalysisCore, TaskCategory } from "./task-types.js";

/** How a criterion will be evaluated (LLM judge reserved for future use). */
export type SuccessCriterionType =
  | "deterministic"
  | "structured"
  | "rubric"
  | "llm_judge"
  | "human";

export interface SuccessCriterion {
  id: string;
  description: string;
  type: SuccessCriterionType;
  required: boolean;
  /** Optional machine-readable evaluation hook (e.g. compile/test command id). */
  spec?: Record<string, unknown>;
}

export type SuccessSpecId =
  | "summarization"
  | "code_generation"
  | "code_review"
  | "debugging"
  | "architecture"
  | "analytical"
  | "security"
  | "underspecified";

export interface TaskSuccessSpecification {
  specId: SuccessSpecId;
  version: string;
  label: string;
  criteria: SuccessCriterion[];
  /** Category used for routing/benchmarks (may differ from specId for analytical → other). */
  taskCategory: TaskCategory;
}

export interface SuccessCriteriaCatalogEntry {
  specId: string;
  label: string;
  criteria: SuccessCriterion[];
}

export interface SuccessCriteriaCatalog {
  version: string;
  note?: string;
  specs: Record<string, SuccessCriteriaCatalogEntry>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultCatalogPath = join(__dirname, "..", "catalogs", "success-criteria.json");

let cachedCatalog: SuccessCriteriaCatalog | null = null;

export function loadDefaultSuccessCriteriaCatalog(): SuccessCriteriaCatalog {
  if (!cachedCatalog) {
    cachedCatalog = JSON.parse(
      readFileSync(defaultCatalogPath, "utf8"),
    ) as SuccessCriteriaCatalog;
  }
  return cachedCatalog;
}

export function mergeSuccessCriteriaCatalog(
  base: SuccessCriteriaCatalog,
  override?: Partial<SuccessCriteriaCatalog>,
): SuccessCriteriaCatalog {
  if (!override) return base;
  return {
    version: override.version ?? base.version,
    note: override.note ?? base.note,
    specs: { ...base.specs, ...override.specs },
  };
}

export function criteriaForSpec(
  specId: SuccessSpecId,
  catalog: SuccessCriteriaCatalog = loadDefaultSuccessCriteriaCatalog(),
): SuccessCriterion[] {
  const entry = catalog.specs[specId];
  if (!entry) return [];
  return entry.criteria.map((c) => ({ ...c }));
}

export function buildTaskSuccessSpecification(
  specId: SuccessSpecId,
  analysis: TaskAnalysisCore,
  catalog: SuccessCriteriaCatalog = loadDefaultSuccessCriteriaCatalog(),
): TaskSuccessSpecification {
  const entry = catalog.specs[specId];
  const criteria = criteriaForSpec(specId, catalog);

  return {
    specId,
    version: catalog.version,
    label: entry?.label ?? specId,
    criteria,
    taskCategory: analysis.category,
  };
}

export interface SerializedTaskSuccessSpecification {
  specId: SuccessSpecId;
  version: string;
  label: string;
  taskCategory: TaskCategory;
  criteria: SuccessCriterion[];
}

export function serializeSuccessSpecification(
  spec: TaskSuccessSpecification,
): SerializedTaskSuccessSpecification {
  return {
    specId: spec.specId,
    version: spec.version,
    label: spec.label,
    taskCategory: spec.taskCategory,
    criteria: spec.criteria.map((c) => ({
      id: c.id,
      description: c.description,
      type: c.type,
      required: c.required,
      ...(c.spec ? { spec: c.spec } : {}),
    })),
  };
}

export function parseSuccessSpecification(
  json: SerializedTaskSuccessSpecification,
): TaskSuccessSpecification {
  return {
    specId: json.specId,
    version: json.version,
    label: json.label,
    taskCategory: json.taskCategory,
    criteria: json.criteria.map((c) => ({ ...c })),
  };
}

export function serializeSuccessSpecificationJson(spec: TaskSuccessSpecification): string {
  return JSON.stringify(serializeSuccessSpecification(spec), null, 2);
}

export function parseSuccessSpecificationJson(raw: string): TaskSuccessSpecification {
  return parseSuccessSpecification(JSON.parse(raw) as SerializedTaskSuccessSpecification);
}

export function requiredCriteria(spec: TaskSuccessSpecification): SuccessCriterion[] {
  return spec.criteria.filter((c) => c.required);
}

export function optionalCriteria(spec: TaskSuccessSpecification): SuccessCriterion[] {
  return spec.criteria.filter((c) => !c.required);
}
