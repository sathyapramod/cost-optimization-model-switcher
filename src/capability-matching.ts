import type { CatalogModelProfile, ModelCapabilityVector } from "./model-profiles.js";
import type { RoutingRequirements } from "./routing-requirements.js";
import type { TaskRequirements } from "./task-contract.js";

export type CapabilityAxis = keyof ModelCapabilityVector;

export interface RequirementAxisSpec {
  axis: CapabilityAxis;
  required: number;
  mandatory: boolean;
}

export interface CapabilityMatchResult {
  modelId: string;
  tier: CatalogModelProfile["tier"];
  meetsMandatory: boolean;
  failedAxes: CapabilityAxis[];
}

const TASK_AXIS_MAP: Array<{ taskKey: keyof TaskRequirements; capability: CapabilityAxis }> = [
  { taskKey: "reasoning", capability: "reasoning" },
  { taskKey: "coding", capability: "coding" },
  { taskKey: "architecture", capability: "architecture" },
  { taskKey: "domainKnowledge", capability: "domainKnowledge" },
  { taskKey: "quantitativeReasoning", capability: "quantitativeReasoning" },
  { taskKey: "toolUse", capability: "toolUse" },
  { taskKey: "outputComplexity", capability: "outputComplexity" },
];

export function requirementAxes(requirements: RoutingRequirements): RequirementAxisSpec[] {
  const axes: RequirementAxisSpec[] = [];

  for (const { taskKey, capability } of TASK_AXIS_MAP) {
    const required = requirements.task[taskKey];
    if (required <= 0) continue;
    axes.push({
      axis: capability,
      required,
      mandatory: true,
    });
  }

  if (requirements.context.contextCapability > 0) {
    axes.push({
      axis: "context",
      required: requirements.context.contextCapability,
      mandatory: true,
    });
  }

  return axes;
}

export function modelMeetsRequirements(
  model: CatalogModelProfile,
  requirements: RoutingRequirements,
): CapabilityMatchResult {
  const specs = requirementAxes(requirements);
  const failedAxes: CapabilityAxis[] = [];

  for (const spec of specs) {
    if (!spec.mandatory) continue;
    const actual = model.capabilities[spec.axis];
    if (actual < spec.required) failedAxes.push(spec.axis);
  }

  return {
    modelId: model.modelId,
    tier: model.tier,
    meetsMandatory: failedAxes.length === 0,
    failedAxes,
  };
}

export function filterCapableModels(
  models: CatalogModelProfile[],
  requirements: RoutingRequirements,
): CatalogModelProfile[] {
  return models.filter((m) => modelMeetsRequirements(m, requirements).meetsMandatory);
}
