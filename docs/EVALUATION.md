# Evaluation framework (V2 Day 6–7 — #15 / #16)

**When to read this:** You change routing and need regression + adversarial checks in one run.

**Back:** [Docs index](./README.md) · [BENCHMARKS.md](./BENCHMARKS.md)

## Layers

| Layer | Issue | Data | Purpose |
|-------|-------|------|---------|
| **Regression** | #15 | `benchmarks/fixtures.json` | Cost/success + `expectByTier` gate contract |
| **Adversarial** | #16 | `benchmarks/adversarial.json` | False-positive / false-negative routing traps |
| **Task quality (Phase 5+)** | — | `benchmarks/<domain>/suite.json` | Criterion-level pass/fail on recorded outputs per task class |

Router regression runs through `runEvaluation()` in `src/evaluation.ts`.

**Important:** `benchmarks/success-rates.json` assumed rates are **not** empirical quality evidence. Use `runTaskQualityEvaluation()` for criterion-based quality measurement.

## Commands

```bash
npm run evaluate              # router regression + adversarial
npm run evaluate:task-quality # task contract criterion evaluation (offline outputs)
npm run evaluate:held-out     # holdout split only (not in routing evidence)
npm run evaluate:live         # call live APIs + same evaluators (see below)
npm run benchmark             # regression only (fixtures)
npm test                      # unit tests include all suites
```

Outputs:

- `benchmarks/results/evaluation-latest.json`
- `benchmarks/results/evaluation-latest.md`
- `benchmarks/results/latest.json` (benchmark-only script)
- `benchmarks/results/task-quality-latest.json` / `.md` (Phase 5)
- `benchmarks/results/held-out-latest.json` / `.md`
- `benchmarks/results/live-runs.json` / `live-latest.md` (live API runs)

## Live evaluation

1. Add or verify `benchmarks/assets/<caseId>.txt` for cases that need source material.
2. `npm run evaluate:live -- --split holdout` — default generalization slice (not merged into routing evidence).
3. `npm run evaluate:live -- --split train` — updates `live-runs.json`; **train** rows merge into Evidence Index v2 via `buildRoutingQualityEvidence()` / `loadDefaultQualityEvidence()`.

Compare holdout pass rates to fixture train rates; a large gap suggests overfitting recorded outputs.

## Task quality (Phase 5)

```typescript
import { runTaskQualityEvaluation, formatTaskQualityMarkdown } from "cost-optimization-model-switcher";

const report = runTaskQualityEvaluation();
```

Each result includes `qualityScore`, `passed`, `criterionResults`, `latencyMs`, token counts, and `estimatedCostUsd`. See [SUCCESS_CRITERIA.md](./SUCCESS_CRITERIA.md).

## Adversarial kinds

| Kind | Meaning | Failure |
|------|---------|---------|
| `false_positive` | Router must **not** `suggest_switch` | Unwanted switch prompt |
| `false_negative` | Router **must** `suggest_switch` with expected tier | Missed savings / wrong tier |

Add cases to `benchmarks/adversarial.json` when you fix a routing bug or discover a new edge case.

## API

```typescript
import { runEvaluation, assertEvaluation } from "cost-optimization-model-switcher";

const report = runEvaluation();
assertEvaluation(report);
```

## CI

`.github/workflows/ci.yml` runs `npm run evaluate` after unit tests.
