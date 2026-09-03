# Cost Optimization & Model Switcher

Provider-agnostic model gate for **Anthropic**, **OpenAI**, and **Cursor**. Matches capability tier to task before ingesting large external context.

| Tier | Anthropic | OpenAI | Use for |
|------|-----------|--------|---------|
| **premium** | Opus | o3, o1 | Complex reasoning |
| **balanced** | Sonnet | gpt-4o | Nuanced review |
| **fast** | Haiku | gpt-4o-mini | Summarize, extract, format |

See [docs/PROVIDERS.md](docs/PROVIDERS.md) for catalog customization.

This repo ships:

- **SKILL.md** — Agent skill instructions
- **catalogs/default.json** — model ID → tier mapping
- **schemas/suggest_model_switch.json** — tool schema for host UI / proxy
- **src/** — TypeScript gate library

## Quick start

```bash
npm install
npm run build
npm test
```

### CLI

```bash
npm run gate -- \
  --model claude-opus-4-6 \
  --probe github_pr:1200,400,18,https://github.com/org/repo/pull/482 \
  "Review PR #482 diff and list potential bugs"
```

Exit code `2` means the gate recommends a model switch. Add `--json` for machine-readable output.

```bash
# OpenAI: downgrade o3 for log summarize
npm run gate -- --model o3 --provider openai \
  --probe log_file:2000000 "Summarize this CI log"

# Cursor: upgrade fast tier for complex work
npm run gate -- --model cursor-small --provider cursor \
  "Design auth migration from this dump"
```

### Probe formats

| Flag value | Meaning |
|------------|---------|
| `github_pr:<additions>,<deletions>,<changedFiles>[,ref...]` | PR diff stats |
| `jira:<issueCount>` | Jira board scope |
| `log_file:<bytes>[,<lines>]` | Log file size |
| `database_dump:<bytes>[,<lines>]` | DB dump / export |

### Reference proxy

```bash
npm run proxy
# POST http://127.0.0.1:8787/v1/gate
# POST http://127.0.0.1:8787/v1/suggest_model_switch
```

Set `AUTO_SWITCH=1` to auto-accept switches in dev.

## Library usage

```typescript
import { evaluateGate, SUGGEST_MODEL_SWITCH_TOOL, handleSuggestModelSwitch } from "cost-optimization-model-switcher";

const decision = evaluateGate({
  currentModel: "claude-opus-4-6",
  userMessage: "Summarize this 2MB CI log",
  probes: [{ source: "log_file", bytes: 2_000_000 }],
});

if (decision.action === "suggest_switch" && decision.suggestSwitch) {
  const result = await handleSuggestModelSwitch(decision.suggestSwitch, {
    autoSwitchEnabled: false,
    onSwitch: async (input) => ({
      status: "accepted",
      switched_to: input.recommended_model_id ?? input.recommended_model,
      message: "Switched.",
    }),
  });
}
```

Register `SUGGEST_MODEL_SWITCH_TOOL` with your Claude host alongside the skill.

## Integration checklist

1. Copy or submodule this repo; load `SKILL.md` as a Claude skill.
2. Register `schemas/suggest_model_switch.json` as a client tool named `suggest_model_switch`.
3. On tool call, invoke `handleSuggestModelSwitch` (or your own UI) and return the host response to the model.
4. Optionally call `POST /v1/gate` from a proxy before the first model turn.

## Project layout

```
├── SKILL.md
├── catalogs/default.json
├── docs/PROVIDERS.md
├── schemas/suggest_model_switch.json
├── src/
│   ├── catalog.ts       # model resolution + tier defaults
│   ├── gate.ts          # evaluateGate — main entry
│   ├── estimate.ts      # token heuristics
│   ├── classify.ts      # task classification
│   ├── tool-schema.ts   # tool loader + handler
│   ├── cli.ts           # cost-gate CLI
│   └── proxy.ts         # reference HTTP server
└── examples/
```

## License

MIT
