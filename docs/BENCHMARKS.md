# Benchmarks

**When to read this:** You change routing heuristics or fixtures and need CI-style regression checks.

**Back:** [Docs index](./README.md) · [V2_ARCHITECTURE.md](./V2_ARCHITECTURE.md) (baseline contract)

Issue [#6](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/6): measure **router correctness** and **cost per successful task** (heuristic).

## Layers

| Layer | What it measures | How to run |
|-------|------------------|------------|
| **Full evaluation (CI)** | Regression fixtures + adversarial cases | `npm run evaluate` — see [EVALUATION.md](./EVALUATION.md) |
| **Regression only** | Gate action + tier per fixture × starting tier | `npm run benchmark` |
| **Live quality (optional)** | Real success, latency, tokens | Record runs in `benchmarks/live-results.json` (schema provided) |

Router benchmarks do **not** call LLM APIs. They use `evaluateGate`, `catalogs/pricing.json`, and assumed success rates in `benchmarks/success-rates.json`.

## Key metric

```text
cost_per_successful_task_usd = estimated_turn_cost_usd / assumed_success_rate
```

Turn cost uses scoped input tokens for straightforward tasks when context optimization applies (see [#5](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/5)).

## Run locally

```bash
npm run build
npm run benchmark
```

Outputs:

- `benchmarks/results/latest.json` — full report
- `benchmarks/results/latest.md` — markdown tables
- Exit code **1** if any `expectByTier` gate assertion fails

Pure JSON (no npm noise):

```bash
node scripts/run-benchmarks.mjs
```

## Fixtures

Edit `benchmarks/fixtures.json`:

- `category` — maps to success rates
- `expectByTier` — optional assertions for `premium` / `balanced` / `fast` starts
- `probes` — same shape as CLI `--probe`

## Assumed success rates

`benchmarks/success-rates.json` holds **placeholder** rates by category × tier. Update from production telemetry or live runs; document changes in commit messages.

## Live runs (manual)

1. Pick a fixture id and tier.
2. Run the task in Claude/Cursor on that model.
3. Record success, tokens, latency in a file matching `benchmarks/live-results.schema.json`.
4. Derive empirical success rates and patch `success-rates.json`.

## CI

`.github/workflows/ci.yml` runs `npm run benchmark` after unit tests.
