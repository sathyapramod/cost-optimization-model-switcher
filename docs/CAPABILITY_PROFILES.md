# Model capability profiles (V2 Day 3 — #12)

**Data:** `catalogs/capabilities.json`  
**API:** `src/capabilities.ts`

Maps each provider tier (`fast` / `balanced` / `premium`) to **feature ceilings** (0–5) aligned with [`TaskFeatureVector`](./TASK_ANALYZER.md). The routing engine ([#13](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/13)) uses these limits with `analyzeTask()` to pick the lowest-cost capable tier.

## Feature dimensions

| Dimension | Model limit means |
|-----------|-------------------|
| `reasoningDepth` | Multi-step reasoning, architecture |
| `codeChange` | Implementation, refactor, non-trivial fixes |
| `securityDepth` | Audits, exploit reasoning |
| `bulkTextProcessing` | Summarize, extract, triage at scale |
| `contextDependence` | Large PRs, logs, dumps in context |

A model **covers** a task when every `limits.*` is **≥** the task’s `features.*`.

## Defaults (heuristic)

| Tier | Typical ceiling |
|------|-----------------|
| **fast** | Strong bulk text and large-context ingest; weak reasoning/security |
| **balanced** | Solid code + reasoning; moderate security |
| **premium** | Full ceiling on all dimensions |

Per-provider tables live in JSON; OpenAI **premium** (`o3`) overrides lower `bulkTextProcessing` (reasoning-first).

## API

```typescript
import {
  analyzeTask,
  loadDefaultCapabilities,
  resolveCapabilityProfile,
  selectCapableTier,
  currentModelMeetsTask,
} from "cost-optimization-model-switcher";
import { resolveModel, loadDefaultCatalog } from "cost-optimization-model-switcher";

const analysis = analyzeTask({ userMessage: "Summarize this 2MB log", probes: [...] });
const tier = selectCapableTier("anthropic", analysis.features, analysis.minimumCapability);

const resolved = resolveModel("claude-haiku-4-5", loadDefaultCatalog());
const profile = resolveCapabilityProfile(resolved);
const ok = currentModelMeetsTask(resolved, analysis.features);
```

`evaluateGate()` uses `routeForTask()` for switch recommendations — see [ROUTING.md](./ROUTING.md).

## Custom profiles

```typescript
import { loadDefaultCapabilities, mergeCapabilities } from "cost-optimization-model-switcher";

const caps = mergeCapabilities(loadDefaultCapabilities(), {
  tiers: {
    cursor: {
      fast: { reasoningDepth: 3, codeChange: 2, securityDepth: 1, bulkTextProcessing: 5, contextDependence: 3 },
    },
  },
});
```

Optional `overrides[]` entries match model ID substrings (same style as `catalogs/default.json`).

## Tests

```bash
npm test -- --test-name-pattern=capability profiles
```

Fixture-driven cases: `summarize-large-log` → `fast`, `security-audit` → `premium`, implement on Haiku → not capable on fast tier profile.

## Related

- [TASK_ANALYZER.md](./TASK_ANALYZER.md) — task `features` / `minimumCapability`
- [V2_ARCHITECTURE.md](./V2_ARCHITECTURE.md) — pipeline
- [PROVIDERS.md](./PROVIDERS.md) — model ID catalog
