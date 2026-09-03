import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityTier, ModelTier, Provider } from "./types.js";

export interface CatalogEntry {
  match: string;
  provider: Provider;
  tier: CapabilityTier;
  priority?: number;
}

export interface ModelCatalog {
  version: string;
  defaults: Record<Provider, Record<CapabilityTier, string>>;
  entries: CatalogEntry[];
}

export interface ResolvedModel {
  modelId: string;
  provider: Provider;
  tier: CapabilityTier;
  matched: boolean;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultCatalogPath = join(__dirname, "..", "catalogs", "default.json");

let cachedDefault: ModelCatalog | null = null;

export function loadDefaultCatalog(): ModelCatalog {
  if (!cachedDefault) {
    cachedDefault = JSON.parse(readFileSync(defaultCatalogPath, "utf8")) as ModelCatalog;
  }
  return cachedDefault;
}

export function mergeCatalog(base: ModelCatalog, override?: Partial<ModelCatalog>): ModelCatalog {
  if (!override) return base;
  return {
    version: override.version ?? base.version,
    defaults: { ...base.defaults, ...override.defaults },
    entries: [...base.entries, ...(override.entries ?? [])],
  };
}

function inferProvider(model: string): Provider | null {
  const m = model.toLowerCase();
  if (m.includes("gpt-") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) {
    return "openai";
  }
  if (m.includes("composer") || m.includes("cursor-")) return "cursor";
  if (m.includes("claude") || m.includes("opus") || m.includes("sonnet") || m.includes("haiku")) {
    return "anthropic";
  }
  return null;
}

export function resolveModel(
  modelId: string,
  catalog: ModelCatalog = loadDefaultCatalog(),
  providerHint?: Provider,
): ResolvedModel {
  const normalized = modelId.trim().toLowerCase();
  const matches = catalog.entries
    .filter((e) => normalized.includes(e.match.toLowerCase()))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || b.match.length - a.match.length);

  if (matches.length > 0) {
    const best = matches[0]!;
    return {
      modelId,
      provider: providerHint ?? best.provider,
      tier: best.tier,
      matched: true,
    };
  }

  const provider = providerHint ?? inferProvider(normalized);
  if (!provider) {
    return { modelId, provider: "anthropic", tier: "balanced", matched: false };
  }

  return { modelId, provider, tier: "balanced", matched: false };
}

export function defaultModelForTier(
  provider: Provider,
  tier: CapabilityTier,
  catalog: ModelCatalog = loadDefaultCatalog(),
): string {
  return catalog.defaults[provider][tier];
}

export function tierLabel(tier: CapabilityTier): string {
  return tier;
}

/** @deprecated Anthropic-specific alias for tool backward compatibility */
export function tierToLegacyAnthropicTier(tier: CapabilityTier): ModelTier {
  if (tier === "premium") return "opus";
  if (tier === "balanced") return "sonnet";
  return "haiku";
}

export function legacyAnthropicTierToCapability(tier: ModelTier): CapabilityTier {
  if (tier === "opus") return "premium";
  if (tier === "sonnet") return "balanced";
  return "fast";
}

export function tierDisplayName(
  tier: CapabilityTier,
  provider: Provider,
): string {
  const names: Record<Provider, Record<CapabilityTier, string>> = {
    anthropic: { premium: "Opus", balanced: "Sonnet", fast: "Haiku" },
    openai: { premium: "o-series / GPT premium", balanced: "GPT-4o", fast: "GPT-4o mini" },
    cursor: { premium: "premium tier", balanced: "balanced tier", fast: "fast tier" },
  };
  return names[provider][tier];
}
