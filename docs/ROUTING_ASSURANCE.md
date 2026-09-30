# Routing recommendation vs quality assurance

**When to read this:** You interpret `GateDecision.routing` or tune switch/no-op behavior.

## Two layers (do not conflate)

| Layer | Field | Meaning |
|-------|--------|---------|
| **Routing recommendation** | `routing.routingRecommendation` | Cheapest **capability-eligible** model from curated profiles + cost policy. **Not** verified task quality. |
| **Quality assurance** | `routing.qualityAssurance` | Offline evaluator evidence (index v2) vs declared quality floor. May **abstain**. |
| **Effective (gate)** | `routing.effectiveRecommendation` | What `recommendedModelId` / `recommendedTier` reflect: capability-only, quality-assured (probabilistic), or abstain (preserve current). |

`routingConfidence` (Phase 3) is **routing** confidence (task understanding, context, capability match) — separate from quality assurance evidence confidence.

## Quality guarantee semantics

| Level | Meaning |
|-------|---------|
| `none` | No empirical assurance claim for the selected path. |
| `probabilistic` | Training-fixture pass-rate and mean quality met configured floors — **not** deterministic correctness. |
| `abstain` | Underspecified task, missing evidence, or no model meets floors — **do not** treat downgrade as quality-safe. |

## Evidence index v2

- Built from **training** fixture split only (`benchmarkSplit: "train"`).
- Stores **pass and fail** runs per model × success spec.
- Fields: `passRate`, `meanQuality`, `sampleCount`, `evaluatorId` / `evaluatorVersion`, `modelVersion`, `evidenceConfidence`, `evidenceSource`.
- **Holdout** cases (`benchmarkSplit: "holdout"`) are for `runHeldOutBenchmarkEvaluation()` — excluded from routing evidence.

```bash
npm run evaluate:task-quality
npm run evaluate:held-out
```

## API

```typescript
import {
  routeForTask,
  buildQualityEvidenceIndex,
  runHeldOutBenchmarkEvaluation,
} from "cost-optimization-model-switcher";
```

See also [ROUTING.md](./ROUTING.md), [EVALUATION.md](./EVALUATION.md), [benchmarks/README.md](../benchmarks/README.md).
