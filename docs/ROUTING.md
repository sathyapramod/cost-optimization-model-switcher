# Routing engine (V2 Day 4 — #13)

**When to read this:** You debug `GateDecision.routing` or change `routeForTask`.

**Back:** [Docs index](./README.md) · [ROUTING_CONFIDENCE.md](./ROUTING_CONFIDENCE.md)

**Module:** `src/router.ts`  
**Entry:** `routeForTask()` — used by `evaluateGate()` when suggesting a switch.

## Flow (Phase 2 + Phase 6)

```text
analyzeTask() → task contract requirements
       +
extractRoutingRequirements() → task axes + context capability (from probes/band)
       +
model-profiles.json → per-model capability vector (curated, not ground truth)
       ↓
filterCapableModels() → mandatory axis match
       ↓
Phase 6: quality-constrained policy (minimize cost, quality ≥ required)
  • success spec id + required quality threshold
  • fixture-backed expected quality per model (task-quality benchmarks)
  • reject below floor / missing evidence; pick cheapest eligible
  • preserve current model when unsafe
       ↓
recommended modelId + explanation (capability + quality)
       ↓
recommendedTier = compatibility metadata on chosen model (not the decision rule)
```

See `src/quality-constrained-policy.ts` and `src/quality-evidence.ts`. Required quality defaults to **0.85** ( **0.90** for architecture/security specs). Evidence is aggregated from `benchmarks/task-quality/fixtures.json` — not `success-rates.json`.

Legacy `pickDowngradeTier` / `pickUpgradeTier` tiers are exposed as `legacyTier` for confidence comparison only.

Capability matching alone can recommend **fast** for PR review; legacy downgrade heuristics still bump to **balanced** when diffs need nuance. Upgrades use the same **max rank** merge so security/architecture tasks stay on **premium**.

## `RoutingDecision`

| Field | Meaning |
|-------|---------|
| `capableTier` | Pure profile match (`null` if no tier fits) |
| `recommendedTier` | What the gate suggests |
| `currentMeetsTask` | Whether the active model’s profile covers `taskAnalysis.features` |

`GateDecision.routing` is set on **suggest_switch** paths. `GateDecision.capabilityProfile` describes the **current** model.

## API

```typescript
import { routeForTask, loadRoutingCapabilities } from "cost-optimization-model-switcher";

const routing = routeForTask({
  resolved,
  taskAnalysis,
  contextBand,
  primarySource,
  userMessage,
  taskDifficulty,
  switchDirection: "downgrade", // or "upgrade"
});
```

## Tests

```bash
npm test -- --test-name-pattern=routeForTask
npm run benchmark
```

## Confidence (#14)

After `routeForTask()`, `evaluateRoutingConfidence()` may **no-op** (proceed) — see [ROUTING_CONFIDENCE.md](./ROUTING_CONFIDENCE.md).
