import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedModel } from "./catalog.js";
import type { TaskFeatureVector } from "./task-analyzer.js";
import type { CapabilityTier, Provider } from "./types.js";

export type CapabilityLimits = TaskFeatureVector;

export interface CapabilityOverride {
  match: string;
  provider?: Provider;
  priority?: number;
  limits: Partial<CapabilityLimits>;
}

export interface CapabilityCatalog {
  version: string;
  note?: string;
  tiers: Record<Provider, Record<CapabilityTier, CapabilityLimits>>;
  overrides?: CapabilityOverride[];
}

export interface ModelCapabilityProfile {
  provider: Provider;
  tier: CapabilityTier;
  modelId: string;
  limits: CapabilityLimits;
  /** True when a catalog `overrides[]` entry was applied. */
  matchedOverride: boolean;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPath = join(__dirname, "..", "catalogs", "capabilities.json");

const TIER_ORDER: CapabilityTier[] = ["fast", "balanced", "premium"];

const TIER_RANK: Record<CapabilityTier, number> = {
  fast: 0,
  balanced: 1,
  premium: 2,
};

let cachedDefault: CapabilityCatalog | null = null;

export function loadDefaultCapabilities(): CapabilityCatalog {
  if (!cachedDefault) {
    cachedDefault = JSON.parse(readFileSync(defaultPath, "utf8")) as CapabilityCatalog;
  }
  return cachedDefault;
}

export function mergeCapabilities(
  base: CapabilityCatalog,
  override?: Partial<CapabilityCatalog>,
): CapabilityCatalog {
  if (!override) return base;
  const tiers = { ...base.tiers } as CapabilityCatalog["tiers"];
  if (override.tiers) {
    for (const provider of Object.keys(override.tiers) as Provider[]) {
      tiers[provider] = { ...tiers[provider], ...override.tiers[provider] };
    }
  }
  return {
    version: override.version ?? base.version,
    note: override.note ?? base.note,
    tiers,
    overrides: [...(base.overrides ?? []), ...(override.overrides ?? [])],
  };
}

function mergeLimits(base: CapabilityLimits, patch: Partial<CapabilityLimits>): CapabilityLimits {
  return {
    reasoningDepth: patch.reasoningDepth ?? base.reasoningDepth,
    codeChange: patch.codeChange ?? base.codeChange,
    securityDepth: patch.securityDepth ?? base.securityDepth,
    bulkTextProcessing: patch.bulkTextProcessing ?? base.bulkTextProcessing,
    contextDependence: patch.contextDependence ?? base.contextDependence,
  };
}

function findOverride(
  modelId: string,
  provider: Provider,
  catalog: CapabilityCatalog,
): CapabilityOverride | undefined {
  const normalized = modelId.trim().toLowerCase();
  const matches = (catalog.overrides ?? [])
    .filter((o) => {
      if (!normalized.includes(o.match.toLowerCase())) return false;
      if (o.provider && o.provider !== provider) return false;
      return true;
    })
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || b.match.length - a.match.length);
  return matches[0];
}

export function limitsForTier(
  provider: Provider,
  tier: CapabilityTier,
  catalog: CapabilityCatalog = loadDefaultCapabilities(),
): CapabilityLimits {
  return catalog.tiers[provider][tier];
}

export function resolveCapabilityProfile(
  resolved: ResolvedModel,
  catalog: CapabilityCatalog = loadDefaultCapabilities(),
): ModelCapabilityProfile {
  const base = limitsForTier(resolved.provider, resolved.tier, catalog);
  const override = findOverride(resolved.modelId, resolved.provider, catalog);
  const limits = override ? mergeLimits(base, override.limits) : base;
  return {
    provider: resolved.provider,
    tier: resolved.tier,
    modelId: resolved.modelId,
    limits,
    matchedOverride: override != null,
  };
}

export function profileMeetsFeatures(
  profile: ModelCapabilityProfile | CapabilityLimits,
  required: TaskFeatureVector,
): boolean {
  const limits = "limits" in profile ? profile.limits : profile;
  return (
    limits.reasoningDepth >= required.reasoningDepth &&
    limits.codeChange >= required.codeChange &&
    limits.securityDepth >= required.securityDepth &&
    limits.bulkTextProcessing >= required.bulkTextProcessing &&
    limits.contextDependence >= required.contextDependence
  );
}

export function tierMeetsMinimum(tier: CapabilityTier, floor: CapabilityTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[floor];
}

export function higherTier(a: CapabilityTier, b: CapabilityTier): CapabilityTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

/** Lowest-cost tier on `provider` that satisfies features and `minimumTier` floor (#13). */
export function selectCapableTier(
  provider: Provider,
  required: TaskFeatureVector,
  minimumTier: CapabilityTier,
  catalog: CapabilityCatalog = loadDefaultCapabilities(),
): CapabilityTier | null {
  for (const tier of TIER_ORDER) {
    if (!tierMeetsMinimum(tier, minimumTier)) continue;
    const limits = limitsForTier(provider, tier, catalog);
    if (profileMeetsFeatures(limits, required)) return tier;
  }
  return null;
}

export function currentModelMeetsTask(
  resolved: ResolvedModel,
  required: TaskFeatureVector,
  catalog: CapabilityCatalog = loadDefaultCapabilities(),
): boolean {
  return profileMeetsFeatures(resolveCapabilityProfile(resolved, catalog), required);
}
