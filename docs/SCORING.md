# Task vs ingest scoring (v1)

**When to read this:** You want to know why the gate upgraded or downgraded a tier from message text vs probe size.

**Back:** [Docs index](./README.md) · [TASK_ANALYZER.md](./TASK_ANALYZER.md) (V2 structured analysis)

Issue [#4](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/4): routing uses **two 0–5 scores** instead of mixing context size into task difficulty.

| Score | Source | Meaning |
|-------|--------|---------|
| `taskDifficulty` | User message (patterns + deep signals) | Reasoning / code-change depth |
| `ingestComplexity` | Probes + context band | How heavy external context is |

`taskClass` is derived from task difficulty: **≤1 → straightforward**, **≥2 → complex**.

## Premium upgrade (Sonnet → Opus)

`needsPremiumUpgrade` uses **both** scores:

- Deep signals (architecture, migration, security audit, …) → premium
- `taskDifficulty ≥ 4` → premium
- `taskDifficulty ≥ 2` **and** `ingestComplexity ≥ 3` (medium/large band) → premium

Small ingest + complex fix/debug on Sonnet → **stay on Sonnet** (no automatic Opus).

## API

`evaluateGate()` returns `scores: { taskDifficulty, ingestComplexity }` on every decision. CLI `--json` includes the same object.

Helpers: `scoreTaskDifficulty`, `scoreIngestComplexity`, `taskClassFromDifficulty` (exported from the package).

V2 adds structured analysis: `analyzeTask()` and `GateDecision.taskAnalysis` — see [TASK_ANALYZER.md](./TASK_ANALYZER.md).
