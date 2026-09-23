# Roadmap

Evolve **cost-optimization-model-switcher** from a model **recommendation** gate into a **routing + cost optimization** engine: route where the host allows, execute, observe outcomes, and escalate when the tier was insufficient.

**Epic (GitHub):** [#2 — Model routing + cost optimization engine](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/2)

---

## Where we are today

| Capability | Status |
|------------|--------|
| Task + context heuristics | Shipped (`evaluateGate`, skill, CLI, proxy) |
| Tier recommendation (upgrade / downgrade) | Shipped |
| Provider-neutral catalog | Shipped (`catalogs/default.json`) |
| Estimated **dollar** cost and savings | Shipped ([#3](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/3)) — see [COST_MODEL.md](./COST_MODEL.md) |
| Automatic model switch in Claude/Cursor | **Not supported by hosts** — user runs `/model` or the picker ([#8](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/8)) |

```text
Today:
  Task → analyze → recommend tier → human switches model → work continues

Target:
  Task → router → model selected → execute → observe → sufficient? → done or escalate
```

---

## Gaps (tracked as GitHub issues)

| Gap | Issue | Priority | Summary |
|-----|-------|----------|---------|
| Real cost model | [#3](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/3) | **P0** | Input/output pricing, estimated $ current vs recommended, savings % |
| Task scoring v1 | [#4](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/4) | P1 | Shipped — [SCORING.md](./SCORING.md) |
| Context optimization | [#5](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/5) | P1 | Shipped — [CONTEXT_OPTIMIZATION.md](./CONTEXT_OPTIMIZATION.md) |
| Benchmarks | [#6](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/6) | P2 | Shipped — [BENCHMARKS.md](./BENCHMARKS.md), `npm run benchmark` |
| Feedback loop | [#7](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/7) | P2 | Outcome telemetry (proxy-first); learn routing over time |
| Provider adapters | [#8](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/8) | P2 | `ModelProvider` + real routing where APIs allow; manual flow elsewhere |

---

## Recommended implementation order

1. **#3 — Cost model** — Shippable without platform APIs; makes ROI visible; blocks meaningful benchmarks and feedback metrics.
2. **#4 — Scoring v1** — Fewer wrong tier suggestions (e.g. huge log summarize vs small hard debug).
3. **#5 — Scoped ingest** — Often larger savings than tier change alone.
4. **#6 — Benchmarks** — Evidence for wider adoption; needs #3 for cost-per-success.
5. **#7 — Feedback** — Needs execution path (e.g. proxy) and #3 for predicted vs actual cost.
6. **#8 — Adapters / auto routing** — Capstone; Cursor/Claude auto-switch remains platform-dependent.

```text
#3 → #4 → #5 → #6 → #7 → #8
         ↑ optional parallel after #3
```

---

## P0 definition of done ([#3](https://github.com/sathyapramod/cost-optimization-model-switcher/issues/3))

- Pricing data per model in repo catalog (input / output / cache where applicable).
- Library helper: `estimateCost` (or equivalent) from token estimates + catalog.
- `GateDecision` and `suggest_model_switch` expose estimated cost current, recommended, and savings (USD and/or %).
- Output-token assumptions documented by task class; estimates labeled as heuristic.
- CLI `--json` and skill guidance for presenting savings to users.
- Unit tests for cost math.

**Out of scope for v1:** live billing APIs, guaranteed invoice-level accuracy.

---

## Dependencies between issues

| Issue | Depends on | Blocks |
|-------|------------|--------|
| #3 | — | #6, #7 (metrics) |
| #4 | #3 (optional, for output heuristics) | — |
| #5 | #3 (cost of smaller ingest + tier) | — |
| #6 | #3; #4 optional (stable router version) | — |
| #7 | #3; #8 partial (proxy execution) | — |
| #8 | #3 (cost-aware routing objective) | Full auto-switch on Cursor/Claude (host) |

---

## How to work an issue

1. Assign yourself on GitHub.
2. Branch: `gap-<n>/<short-name>` (e.g. `gap-2/cost-model` for issue #3).
3. Open a PR with `Fixes #<issue>` in the description.
4. Update this doc only when priority or scope changes (keep issue bodies as the detailed checklist).

---

## Related docs

- [README](../README.md) — install, CLI, limitations
- [PROVIDERS.md](./PROVIDERS.md) — catalog and provider integration
- [Integration examples](../examples/integration.md) — proxy and tool flow
