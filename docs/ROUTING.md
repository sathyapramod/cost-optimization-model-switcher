# Routing engine (V2 Day 4 — #13)

**Module:** `src/router.ts`  
**Entry:** `routeForTask()` — used by `evaluateGate()` when suggesting a switch.

## Flow

```text
analyzeTask() → features + minimumCapability
       +
selectCapableTier() → lowest-cost tier that covers features
       +
pickDowngradeTier / pickUpgradeTier → legacy quality floors
       ↓
higherTier(capable, legacy) → recommendedTier
```

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

## Next (#14)

Add confidence thresholds and **proceed** (no-op) when `capableTier` is ambiguous or `currentMeetsTask` is true on a higher tier than `capableTier` suggests.
