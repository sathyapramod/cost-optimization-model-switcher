# Task analyzer (V2 Day 2 — #11)

**Entry point:** `analyzeTask()` in `src/task-analyzer.ts`

Turns the user message and optional context probes into **feature-based task requirements** used by the gate today and by the routing engine ([#13](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/13)) next.

## Input / output

```typescript
import { analyzeTask } from "cost-optimization-model-switcher";

const analysis = analyzeTask({
  userMessage: "Review PR #482 diff and list potential bugs",
  probes: [{ source: "github_pr", additions: 1200, deletions: 400, changedFiles: 18 }],
});
```

| Field | Meaning |
|-------|---------|
| `intents` | Multi-label verbs (summarize, review, implement, …) |
| `category` | Benchmark category (`pr_review`, `summarization`, …) |
| `taskClass` / `taskDifficulty` | Same rules as [SCORING.md](./SCORING.md) |
| `ingestComplexity` / `contextBand` | From probes (not message verbs) |
| `features` | 0–5 capability needs (reasoning, code, security, bulk text, context) |
| `flags` | `deepSignals`, `mixedIntent`, `wantsThoroughReview` |
| `minimumCapability` | `fast` / `balanced` / `premium` hint for router (#13) |

`evaluateGate()` attaches the same object as `GateDecision.taskAnalysis`.

## Feature vector (routing input)

| Feature | High when |
|---------|-----------|
| `reasoningDepth` | Complex / deep-signal tasks |
| `codeChange` | implement, refactor, debug |
| `securityDepth` | security audit, exploit language |
| `bulkTextProcessing` | summarize, extract, format on simple tasks |
| `contextDependence` | Mirrors ingest complexity (large PR, log, dump) |

`minimumCapability` is a conservative tier floor:

- Deep signals or security → **premium**
- Straightforward → **fast**
- Complex + medium/large ingest → **premium**
- Other complex → **balanced**

The v1 gate still uses `pickUpgradeTier` / `pickDowngradeTier` in `classify.ts`; #13 will route from `minimumCapability` + capability profiles instead of duplicating rules.

## Extending (#11 follow-ups)

1. Add intent patterns in `task-analyzer.ts` (keep benchmarks green).
2. Map new categories in `inferCategory()` and `benchmarks/fixtures.json`.
3. Add cases to `src/test/task-analyzer.test.ts`.
4. Use `selectCapableTier(provider, analysis.features, analysis.minimumCapability)` — see [CAPABILITY_PROFILES.md](./CAPABILITY_PROFILES.md).

## Tests

```bash
npm test -- --test-name-pattern=analyzeTask
npm test -- --test-name-pattern=V2 baseline
```
