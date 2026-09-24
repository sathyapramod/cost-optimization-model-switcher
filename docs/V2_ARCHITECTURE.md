# V2 architecture — capability routing

**Audience:** Contributors changing router modules or benchmarks. End users: [README](../README.md).

**Back:** [Docs index](./README.md)

Epic: [#9 — V2 15-day capability routing roadmap](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/9)

V2 evolves the v1 **gate** (`evaluateGate`) from a single heuristic function into a **pipeline** of analyzers and engines. The public entry point stays `evaluateGate()` until release ([#24](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/24)); internals are split incrementally so benchmark fixtures keep passing.

## Today (v1.1 router)

```text
GateInput (model, message, probes, flags)
        │
        ├─ estimate tokens / context band
        ├─ classify task (patterns → taskClass, scores)
        ├─ context optimization (scoped ingest)
        └─ tier rules (upgrade / downgrade / proceed)
        │
        ▼
   GateDecision + optional suggestSwitch
```

| Module | Responsibility |
|--------|----------------|
| `src/gate.ts` | Orchestration, switch payloads |
| `src/task-analyzer.ts` | **Day 2 (#11)** — feature-based task requirements |
| `src/capabilities.ts` | **Day 3 (#12)** — tier capability limits + `selectCapableTier` |
| `src/router.ts` | **Day 4 (#13)** — `routeForTask` (profiles + legacy floors) |
| `src/routing-confidence.ts` | **Day 5 (#14)** — confidence + safety no-op |
| `src/classify.ts` | Tier pick helpers, rationales, scoped-ingest copy |
| `src/classify-core.ts` | Shared ingest / source helpers (no circular imports) |
| `src/catalog.ts` | Model ID → capability tier |
| `src/estimate.ts` | Probe → tokens → band |
| `src/ingest-scope.ts` | Effective tokens after scoped ingest |
| `src/cost.ts` | Heuristic $ estimates |

## Target (V2 pipeline)

```text
GateInput
    │
    ▼
┌─────────────────────┐
│ Task Analyzer (#11) │  intents, features, minimumCapability
└──────────┬──────────┘
           ▼
┌─────────────────────────────┐
│ Capability profiles (#12) │  per-model strengths, limits
└──────────┬──────────────────┘
           ▼
┌─────────────────────┐
│ Routing engine (#13)│  lowest-cost model that meets requirements
└──────────┬──────────┘
           ▼
┌──────────────────────────┐
│ Confidence / safety (#14)│  no-op when uncertain
└──────────┬───────────────┘
           ▼
   (P1) Context optimizer (#17), cost (#18), policy (#19)
   (P1) Explain (#20), UX (#21)
   (P2) Telemetry (#22), feedback (#23)
           ▼
   GateDecision (+ trace for explain CLI)
```

### Issue map

| Day | Issue | Module / artifact |
|-----|-------|-------------------|
| 1 | [#10](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/10) | This doc, `v2-baseline.test.ts`, benchmark contract |
| 2 | [#11](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/11) | `task-analyzer.ts`, [TASK_ANALYZER.md](./TASK_ANALYZER.md) |
| 3 | [#12](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/12) | `catalogs/capabilities.json`, [CAPABILITY_PROFILES.md](./CAPABILITY_PROFILES.md) |
| 4 | [#13](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/13) | `router.ts`, [ROUTING.md](./ROUTING.md) |
| 5 | [#14](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/14) | `routing-confidence.ts`, [ROUTING_CONFIDENCE.md](./ROUTING_CONFIDENCE.md) |
| 6–7 | [#15](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/15)–[#16](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/16) | Benchmark + adversarial suites |
| 8–12 | [#17](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/17)–[#21](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/21) | Context, cost, policy, explain, CLI UX |
| 13–14 | [#22](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/22)–[#23](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/23) | Telemetry + learning loop |
| 15 | [#24](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/24) | Integration, version bump, demo |

Parallel: [#8](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/8) provider adapters (proxy path for demo).

## Baseline contract (Day 1)

Do not change routing behavior without updating:

1. `benchmarks/fixtures.json` expectations
2. `src/test/gate.test.ts`
3. `src/test/v2-baseline.test.ts` (runs full benchmark expectations in CI via `npm test`)

Run before every V2 PR:

```bash
npm test
npm run benchmark
```

## `GateDecision.taskAnalysis` (#11)

Every `evaluateGate()` result includes `taskAnalysis` (see [TASK_ANALYZER.md](./TASK_ANALYZER.md)). v1 fields `taskClass` and `scores` remain for CLI/skill compatibility; they are derived from the same analysis object.

## Planned breaking changes (only at #24)

- Router may return **proceed** when confidence is low (#14) even if a tier mismatch exists.
- `explain` subcommand (#20) may expose internal trace IDs.
- Capability profiles may replace flat tier-only catalog for routing (#12–#13).

Document any intentional behavior change in the PR that references the day issue.

## Related

- [SCORING.md](./SCORING.md) — v1 task vs ingest scores
- [BENCHMARKS.md](./BENCHMARKS.md) — fixture suite
- [ROADMAP.md](./ROADMAP.md) — V1 gaps + V2 epic link
