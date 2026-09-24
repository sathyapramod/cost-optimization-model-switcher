# Evaluation framework (V2 Day 6–7 — #15 / #16)

**When to read this:** You change routing and need regression + adversarial checks in one run.

**Back:** [Docs index](./README.md) · [BENCHMARKS.md](./BENCHMARKS.md)

## Layers

| Layer | Issue | Data | Purpose |
|-------|-------|------|---------|
| **Regression** | #15 | `benchmarks/fixtures.json` | Cost/success + `expectByTier` gate contract |
| **Adversarial** | #16 | `benchmarks/adversarial.json` | False-positive / false-negative routing traps |

Both run through `runEvaluation()` in `src/evaluation.ts`.

## Commands

```bash
npm run evaluate          # full report + exit 1 on failure
npm run benchmark         # regression only (fixtures)
npm test                  # unit tests include evaluation + adversarial
```

Outputs:

- `benchmarks/results/evaluation-latest.json`
- `benchmarks/results/evaluation-latest.md`
- `benchmarks/results/latest.json` (benchmark-only script)

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
