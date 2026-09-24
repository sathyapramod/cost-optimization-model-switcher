# Documentation

Use this index to find the right guide. The project ships as an **agent skill** (Claude Code, Cursor), a **CLI** (`npm run gate`), and a **library** (`evaluateGate`).

## Start here

| I want to… | Read |
|------------|------|
| Install and use in Claude Code or Cursor | [README — Install & use](../README.md#install) |
| Run one command to see a model recommendation | [README — Try it](../README.md#try-it-60-seconds) |
| Wire OpenAI, Cursor, or a custom catalog | [PROVIDERS.md](./PROVIDERS.md) |
| Call the gate from my app or proxy | [examples/integration.md](../examples/integration.md) |
| Understand estimated $ on a turn | [COST_MODEL.md](./COST_MODEL.md) |
| See what is shipped vs planned | [ROADMAP.md](./ROADMAP.md) |

## How routing works (concepts)

| Topic | Doc |
|-------|-----|
| Task difficulty vs ingest size (v1 scores) | [SCORING.md](./SCORING.md) |
| Scoped ingest before full fetch | [CONTEXT_OPTIMIZATION.md](./CONTEXT_OPTIMIZATION.md) |
| Feature-based task analysis (V2) | [TASK_ANALYZER.md](./TASK_ANALYZER.md) |
| Capability tiers vs task features | [CAPABILITY_PROFILES.md](./CAPABILITY_PROFILES.md) |
| Router merge (profiles + legacy rules) | [ROUTING.md](./ROUTING.md) |
| When the gate stays quiet (no switch) | [ROUTING_CONFIDENCE.md](./ROUTING_CONFIDENCE.md) |
| V2 pipeline and issue map | [V2_ARCHITECTURE.md](./V2_ARCHITECTURE.md) |
| Fixture suite and `npm run benchmark` | [BENCHMARKS.md](./BENCHMARKS.md) |

## Artifacts in the repo

| Path | Purpose |
|------|---------|
| `SKILL.md` | Agent instructions (symlinked into `~/.claude/skills` or `~/.cursor/skills`) |
| `catalogs/default.json` | Model ID → provider + capability tier |
| `catalogs/capabilities.json` | Per-tier feature limits (V2 routing) |
| `catalogs/pricing.json` | Heuristic list prices for cost estimates |
| `schemas/suggest_model_switch.json` | Tool schema for custom UIs |
| `examples/tool-call.json` | Sample `suggest_model_switch` payload |

## Contributing to routing behavior

Before changing heuristics or fixtures:

```bash
npm test
npm run benchmark
```

See [V2_ARCHITECTURE.md](./V2_ARCHITECTURE.md) for the baseline contract.
