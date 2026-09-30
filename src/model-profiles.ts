import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityTier, Provider } from "./types.js";

/**
 * Normalized capability vector for routing (0–5).
 * Curated catalog data — not empirical ground truth until validated by benchmarks.
 */
export interface ModelCapabilityVector {
  reasoning: number;
  coding: number;
  architecture: number;
  domainKnowledge: number;
  quantitativeReasoning: number;
  context: number;
  toolUse: number;
  outputComplexity: number;
  /** Higher = faster response (relative within catalog). */
  speed: number;
  /** Higher = lower relative $/token (more economical). */
  cost: number;
}

export interface CatalogModelProfile {
  modelId: string;
  /** Compatibility metadata for legacy APIs — not used as the routing decision. */
  tier: CapabilityTier;
  capabilities: ModelCapabilityVector;
}

export interface ProviderModelProfiles {
  models: CatalogModelProfile[];
}

export interface ModelProfileCatalog {
  version: string;
  note?: string;
  providers: Record<Provider, ProviderModelProfiles>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPath = join(__dirname, "..", "catalogs", "model-profiles.json");

let cached: ModelProfileCatalog | null = null;

export function loadDefaultModelProfiles(): ModelProfileCatalog {
  if (!cached) {
    cached = JSON.parse(readFileSync(defaultPath, "utf8")) as ModelProfileCatalog;
  }
  return cached;
}

export function mergeModelProfiles(
  base: ModelProfileCatalog,
  override?: Partial<ModelProfileCatalog>,
): ModelProfileCatalog {
  if (!override) return base;
  const providers = { ...base.providers } as ModelProfileCatalog["providers"];
  if (override.providers) {
    for (const provider of Object.keys(override.providers) as Provider[]) {
      const patch = override.providers[provider];
      if (!patch) continue;
      providers[provider] = {
        models: patch.models ?? providers[provider]?.models ?? [],
      };
    }
  }
  return {
    version: override.version ?? base.version,
    note: override.note ?? base.note,
    providers,
  };
}

export function listProviderModels(
  provider: Provider,
  catalog: ModelProfileCatalog = loadDefaultModelProfiles(),
): CatalogModelProfile[] {
  return catalog.providers[provider]?.models ?? [];
}

export function findModelProfile(
  modelId: string,
  provider: Provider,
  catalog: ModelProfileCatalog = loadDefaultModelProfiles(),
): CatalogModelProfile | undefined {
  const normalized = modelId.trim().toLowerCase();
  const models = listProviderModels(provider, catalog);
  return models
    .filter((m) => normalized.includes(m.modelId.toLowerCase()))
    .sort((a, b) => b.modelId.length - a.modelId.length)[0];
}
