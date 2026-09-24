# Cost model (heuristic)

**When to read this:** You interpret `estimated_*_usd` or `savings_percent` on CLI `--json` or `suggest_switch`.

**Back:** [Docs index](./README.md) · Edit prices in `catalogs/pricing.json`

Issue [#3](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/3): gate decisions can include **estimated USD** for the current vs recommended model on a **single turn**.

This is **not** billing data. It uses:

1. **Input tokens** — from context probes (`estimate.ts`) or `0` if none were passed.
2. **Output tokens** — heuristic by `task_class` (`estimateOutputTokens` in `src/cost.ts`).
3. **List prices** — `catalogs/pricing.json` (USD per 1M input/output tokens).

## Formula

```text
turn_cost_usd =
  (input_tokens / 1e6) × input_rate +
  (output_tokens / 1e6) × output_rate
```

`savings_percent` = `(cost_current - cost_recommended) / cost_current × 100`. Negative values mean the recommended tier costs more (typical on **upgrade**).

## Updating prices

Edit `catalogs/pricing.json` → `models` for specific slugs, or `tierDefaults` per provider/tier. Run `npm test`.

## API / CLI fields

On `suggest_switch` payloads (and CLI `--json`):

| Field | Meaning |
|-------|---------|
| `estimated_output_tokens` | Heuristic output for this turn |
| `estimated_cost_current_usd` | Current model turn estimate |
| `estimated_cost_recommended_usd` | Recommended model turn estimate |
| `estimated_savings_usd` | Current − recommended |
| `savings_percent` | Relative savings vs current |
| `cost_pricing_note` | Assumptions disclaimer |

Rationale text appends a one-line savings summary when a switch is suggested.
