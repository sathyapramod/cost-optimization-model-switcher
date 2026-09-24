# Routing confidence (V2 Day 5 — #14)

**When to read this:** The gate returned `proceed` but you expected a switch—or you tune no-op rules.

**Back:** [Docs index](./README.md) · [ROUTING.md](./ROUTING.md)

**Module:** `src/routing-confidence.ts`  
**Entry:** `evaluateRoutingConfidence()` — called from `evaluateGate()` after `routeForTask()`.

## Purpose

Avoid noisy or risky model-switch prompts when profile routing is uncertain. When `suggestSwitch` is false, the gate **proceeds** (no-op) even if tier heuristics would have recommended a switch.

## Signals

| Condition | Result |
|-----------|--------|
| No `capableTier` in catalog | `suggestSwitch: false`, confidence **low** |
| `taskAnalysis.flags.mixedIntent` | **no-op** (straightforward + complex verbs) |
| `capableTier !== legacyTier` | Cap confidence at **medium** (profile vs heuristic disagreement) |
| Two-tier **downgrade** + **low** context confidence + ambiguous difficulty | **no-op** |
| One-tier **upgrade** + `currentMeetsTask` + **low** context confidence | **no-op** |

Context confidence uses the same bands as before: large ingest → high, medium → medium, small → low.

## API surface

`GateDecision` fields:

- `routing` — tiers from #13 (`legacyTier`, `capableTier`, `recommendedTier`, …)
- `routingConfidence` — `{ confidence, suggestSwitch, noOpReason? }`
- `suggestSwitch.confidence` — aligned with `routingConfidence.confidence` on switch paths

```typescript
import { evaluateRoutingConfidence } from "cost-optimization-model-switcher";
```

## Tests

```bash
npm test -- --test-name-pattern=evaluateRoutingConfidence
npm run benchmark
```

Benchmark fixtures should still pass; mixed-intent premium + large PR is an intentional **proceed** case.

## Related

- [ROUTING.md](./ROUTING.md) — tier selection
- [V2_ARCHITECTURE.md](./V2_ARCHITECTURE.md) — Day 5 / #14
