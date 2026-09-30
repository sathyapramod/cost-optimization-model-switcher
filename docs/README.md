# Documentation

Use this index to find the right guide. The project ships as an **agent skill** (Claude Code, Cursor), a **CLI** (`npm run gate`), and a **library** (`evaluateGate`).

## Start here

| I want to… | Read |
|------------|------|
| Install and use in Claude Code or Cursor | [README — Install the skill](../README.md#install-the-skill) |
| Run one command to see a model recommendation | [README — Try the CLI](../README.md#try-the-cli-60-seconds) |
| Run task-quality / held-out / live evaluation | [README — Evaluation & benchmarks](../README.md#evaluation--benchmarks) |
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
| Task success criteria (Phase 4) | [SUCCESS_CRITERIA.md](./SUCCESS_CRITERIA.md) |
| Capability tiers vs task features | [CAPABILITY_PROFILES.md](./CAPABILITY_PROFILES.md) |
| Router merge (profiles + legacy rules) | [ROUTING.md](./ROUTING.md) |
| When the gate stays quiet (no switch) | [ROUTING_CONFIDENCE.md](./ROUTING_CONFIDENCE.md) |
| Routing vs quality assurance | [ROUTING_ASSURANCE.md](./ROUTING_ASSURANCE.md) |
| V2 pipeline and issue map | [V2_ARCHITECTURE.md](./V2_ARCHITECTURE.md) |
| Fixture suite and `npm run benchmark` | [BENCHMARKS.md](./BENCHMARKS.md) |
| Full evaluation (benchmark + adversarial + live) | [EVALUATION.md](./EVALUATION.md) |
| Domain task-quality suites | [benchmarks/README.md](../benchmarks/README.md) |

## Artifacts in the repo

| Path | Purpose |
|------|---------|
| `SKILL.md` | Agent instructions (symlinked into `~/.claude/skills` or `~/.cursor/skills`) |
| `catalogs/default.json` | Model ID → provider + capability tier |
| `catalogs/capabilities.json` | Per-tier feature limits (V2 routing) |
| `catalogs/pricing.json` | Heuristic list prices for cost estimates |
| `catalogs/success-criteria.json` | Task-type success criterion definitions |
| `schemas/suggest_model_switch.json` | Tool schema for custom UIs |
| `examples/tool-call.json` | Sample `suggest_model_switch` payload |

## Contributing to routing behavior

Before changing heuristics or fixtures:

```bash
npm test
npm run evaluate
npm run evaluate:task-quality
npm run evaluate:held-out   # optional: npm run evaluate:live with API keys
```

See [V2_ARCHITECTURE.md](./V2_ARCHITECTURE.md) for the baseline contract.
