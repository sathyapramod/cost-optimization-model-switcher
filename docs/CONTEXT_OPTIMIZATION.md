# Context optimization (scoped ingest)

Issue [#5](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/5): reduce **what you ingest** before (or instead of) switching models.

## Flow

```text
Large probe / medium–large band
        ↓
contextOptimization.required = true
        ↓
Follow scoped_ingest_plan (grep, tail, JQL, per-file PR diffs)
        ↓
effectiveInputTokens ≪ rawInputTokens
        ↓
Lower cost (see estimated_*_if_scoped_usd on suggest_switch)
```

Tier routing still uses **full** ingest size so we do not skip downgrade/upgrade when the user might load everything. Cost fields show both full-ingest and **if-scoped** estimates on switch payloads.

## API

Every `GateDecision` includes `contextOptimization`:

| Field | Meaning |
|-------|---------|
| `required` | Large probe or band / token threshold |
| `plan` | Human + agent steps (also `scoped_ingest_plan` on tool payload) |
| `rawInputTokens` | From probes |
| `effectiveInputTokens` | Heuristic after scope (`ingest-scope.ts`) |
| `reductionPercent` | Approx. % reduction |

## CLI

Non-JSON mode prints **warnings on stderr** when scoped ingest is required:

```bash
npm run gate -- --model claude-opus-4-6 --probe log_file:2000000 "Summarize this CI log"
```

## Agents

See `SKILL.md` — do not full-fetch large context before executing the scoped plan.
