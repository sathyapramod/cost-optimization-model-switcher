# Routing confidence (V2 Day 5 — #14)

**When to read this:** The gate returned `proceed` but you expected a switch—or you tune no-op rules.

**Back:** [Docs index](./README.md) · [ROUTING.md](./ROUTING.md)

**Modules:** `src/routing-uncertainty.ts` (Phase 3 assessment), `src/routing-confidence.ts` (gate integration)  
**Entry:** `evaluateRoutingConfidence()` — called from `evaluateGate()` after `routeForTask()`.

## Purpose

Avoid noisy or risky model-switch prompts when the task is not well understood. When `suggestSwitch` is false, the gate **proceeds** (conservative no-op) and may include a **clarification** payload for UI/CLI.

Routing confidence is **not** derived from context size alone. Four dimensions are tracked separately:

| Dimension | Meaning |
|-----------|---------|
| `taskUnderstanding` | Intent clarity, contract ambiguities, underspecified prompts |
| `context` | Probes present, whether the message references unattached context |
| `capabilityMatching` | Whether exactly one model clearly fits requirements |
| `routing` | Blended decision confidence (capped by task + capability signals) |

## Routing states

| State | Typical behavior |
|-------|------------------|
| `confident` | Normal capability routing + switch suggestion when appropriate |
| `uncertain` | No switch unless clear capability insufficiency on upgrade |
| `ambiguous` | No aggressive downgrade; clarification recommended |
| `insufficient_information` | Prompt too vague (e.g. “Analyze this.”) — no switch, ask clarifying questions |

## Signals

| Condition | Result |
|-----------|--------|
| Underspecified / ambiguous intent | `suggestSwitch: false`, `clarification.needed: true` |
| No `capableTier` in catalog | `suggestSwitch: false` |
| Routing dimension below configured threshold | **no-op** unless `capabilityInsufficient` on upgrade |
| Clear capability gap (non-vague task) | Upgrade may still be suggested |

## API surface

`GateDecision` fields:

- `routing` — capability router output (`recommendedModelId`, `explanation`, …)
- `routingConfidence` — `{ state, dimensions, lowConfidenceReasons, clarification, suggestSwitch, … }`
- `suggestSwitch.confidence` — legacy aggregate aligned with `routingConfidence.confidence` on switch paths

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
