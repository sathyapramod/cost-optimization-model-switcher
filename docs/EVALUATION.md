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
npm run evaluate:live-compare # offline: premium baseline vs router on holdout, from recorded live runs
npm run benchmark             # regression only (fixtures)
npm run benchmark:router      # fixture-based baseline-vs-router cost/quality comparison (Priorities 1–2)
npm test                      # unit tests include all suites
```

Outputs:

- `benchmarks/results/evaluation-latest.json`
- `benchmarks/results/evaluation-latest.md`
- `benchmarks/results/latest.json` (benchmark-only script)
- `benchmarks/results/task-quality-latest.json` / `.md` (Phase 5)
- `benchmarks/results/held-out-latest.json` / `.md`
- `benchmarks/results/live-runs.json` / `live-latest.md` (live API runs)
- `benchmarks/results/router-benchmark.json` / `.md` (fixture-based baseline vs router)
- `benchmarks/results/live-holdout-comparison.json` / `.md` (empirical baseline vs router, holdout only)

## What "train" vs "holdout" means

| Split | Used for | Can it influence routing rules? |
|-------|----------|----------------------------------|
| `train` | Builds Evidence Index v2 (`buildQualityEvidenceIndex`), which `routeForTask` consults for quality-constrained routing. Live `train`-split runs merge in too (`evidenceEligible: true`). | **Yes** — this is calibration data. |
| `holdout` | Never read by `buildQualityEvidenceIndex` or merged by `mergeLiveRunsIntoEvidenceIndex` (`evidenceEligible` is hardcoded `false` for holdout rows in `task-quality/live-evaluation.ts`). Used only by `runHeldOutBenchmarkEvaluation` and the live baseline-vs-router comparison below. | **No** — generalization check only. |

If holdout pass rates track train pass rates, the routing rules generalize. If holdout is much worse, the rules likely overfit the recorded train outputs — do not patch this by moving holdout cases into train; investigate the routing heuristic instead.

## What is empirical vs synthetic (quick index)

| Data | Empirical or synthetic | Where |
|------|------------------------|-------|
| `benchmarks/success-rates.json` | **Synthetic** (`synthetic: true` in the file) — placeholder tier×category rates for `cost_per_successful_task_usd` heuristics only. | `src/benchmark.ts`, `scripts/run-benchmarks.mjs` |
| `benchmarks/<domain>/suite.json` candidate outputs | **Fixture-based** — recorded text, scored by the real criterion evaluator (`task-contract-evaluator-v1`); not a live API call. | `runTaskQualityEvaluation()` |
| `benchmarks/results/live-runs.json` | **Empirical** — a real provider API call, scored by the same evaluator. | `npm run evaluate:live` |
| `npm run benchmark:router` report | **Fixture-based + synthetic** cost/quality mix (Priority 1–2). Explicitly labeled `evidence.taskQuality: "mixed"` in the JSON. | `src/router-benchmark.ts` |
| `npm run evaluate:live-compare` report | **Empirical where a recorded (task, model) live run exists; otherwise no claim.** Never fabricates a pass/fail. | `src/live-holdout-benchmark.ts` |

## Live evaluation

1. Add or verify `benchmarks/assets/<caseId>.txt` for cases that need source material.
2. `npm run evaluate:live -- --split holdout` — default generalization slice (not merged into routing evidence).
3. `npm run evaluate:live -- --split train` — updates `live-runs.json`; **train** rows merge into Evidence Index v2 via `buildRoutingQualityEvidence()` / `loadDefaultQualityEvidence()`.

Compare holdout pass rates to fixture train rates; a large gap suggests overfitting recorded outputs.

**API keys:** only the key for `--provider` is required (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`). `npm run gate` / `evaluateGate()` never read or require a provider API key — see `src/test/api-key-separation.test.ts`. Live evaluation is **optional**; the gate, benchmark, and evaluation suites all run fully offline without it.

## Empirical baseline vs router (holdout, live)

`npm run evaluate:live-compare` answers: *for holdout tasks the router has actually been exercised against with real model calls, does the router-selected model do as well as the premium baseline?*

It is a **read-only report over `benchmarks/results/live-runs.json`** — it does not call any provider API itself, so it needs no API key and never writes evidence used by routing.

Workflow:

```bash
# 1. Record premium baseline runs on holdout
npm run evaluate:live -- --split holdout --provider anthropic --model claude-opus-4-6

# 2. Record router-selected-model runs on the same holdout cases
#    (check routingDecision per task in the step-3 report, or benchmark:router, to see which model the gate picked)
npm run evaluate:live -- --split holdout --provider anthropic --model claude-haiku-4-5

# 3. Compare
npm run evaluate:live-compare -- --provider anthropic
```

For each holdout task it re-runs `evaluateGate` (starting from the premium model, matching `benchmark:router`) to classify the routing decision (`downgrade` / `upgrade` / `stay` / `abstain`), then looks up any recorded live run for the premium model and for the router-selected model on that exact task.

**Paired comparison rule:** a task only counts toward the quality-pass-rate delta when (a) the router selected a *different* model than premium **and** (b) a live run is recorded for *both* models on that task. The minimum sample size before a delta is reported instead of `insufficient evidence` is `MIN_PAIRED_HOLDOUT_SAMPLES` (currently 5) — a documented, deliberately conservative threshold (`ponytail:` comment in `src/live-holdout-benchmark.ts`), not a statistical significance test.

If the sample is below that threshold, the report says exactly:

```text
insufficient evidence: <n> paired holdout live run(s) ... Do not treat the router as
quality-preserving on this basis.
```

It never claims "router preserves quality" — it reports the observed pass-rate delta (which may be positive, negative, or zero) with that caveat attached.

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

```typescript
import { compareLiveHoldoutBaselineVsRouter } from "cost-optimization-model-switcher";

// Offline — reads benchmarks/results/live-runs.json only, no API key needed.
const report = compareLiveHoldoutBaselineVsRouter({ provider: "anthropic" });
report.pairedComparison.insufficientEvidence; // true until enough paired holdout runs exist
```

## CI

`.github/workflows/ci.yml` runs `npm run evaluate` after unit tests.
