# Benchmarks

## Router regression (gate behavior)

| Path | Purpose |
|------|---------|
| `fixtures.json` | `evaluateGate` expectations by tier (cost routing contract) |
| `adversarial.json` | False-positive / false-negative switch traps |
| `success-rates.json` | **Synthetic / demo** tier×category rates for cost-per-success math only — not empirical quality |

## Task-quality (domain suites)

Task-specific quality benchmarks live under **one folder per task class**. Each case defines the task, context, requirements, success criteria, evaluator, and recorded model outputs — not generic “is the model smart” prompts.

```
benchmarks/
  summarization/
  extraction/
  coding/
  code-review/
  debugging/
  architecture/
  security/
  analytical/
```

Each domain has `suite.json` with ≥3 cases. Run:

```bash
npm run evaluate:task-quality
```

Reports:

- `benchmarks/results/task-quality-latest.json` / `.md` — all cases
- `benchmarks/results/held-out-latest.json` / `.md` — **holdout** split only (`npm run evaluate:held-out`)

Cases default to `benchmarkSplit: "train"`. Holdout cases are excluded from routing evidence index v2. See [docs/ROUTING_ASSURANCE.md](../docs/ROUTING_ASSURANCE.md).

Legacy monolithic `task-quality/fixtures.json` is merged at load time for backward compatibility; prefer adding cases under domain folders.
