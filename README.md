# Cost Optimization & Model Switcher

Stop using expensive models for cheap work — and stop using fast models for hard work.

This project is an **agent skill + small library** that checks your task **before** the AI ingests large context (PRs, Jira boards, logs, dumps). It recommends switching to a better-matched model tier:

| Direction | When | Example |
|-----------|------|---------|
| **Downgrade** | Premium model + big context + simple task | Opus summarizing a 2MB log → Haiku |
| **Upgrade** | Fast model + complex task | Haiku implementing a plugin → Sonnet |

Works across **Claude Code**, **Cursor**, and **OpenAI** via a shared model catalog.

---

## How it works (30 seconds)

```
Your prompt + context size
        ↓
   Classify task (simple vs complex)
        ↓
   Match to capability tier (premium / balanced / fast)
        ↓
   Recommend switch or proceed
```

**Capability tiers** (provider-neutral):

| Tier | Claude | OpenAI | Good for |
|------|--------|--------|----------|
| **premium** | Opus | o3, o1 | Architecture, migration, deep debugging |
| **balanced** | Sonnet | gpt-4o | PR review, nuanced implementation |
| **fast** | Haiku | gpt-4o-mini | Summarize, extract, format, triage |

---

## Prerequisites

- **Node.js 20+** (only if you use the CLI or library)
- **Git**

You do **not** need to publish an npm package to use the skill — installing the skill file is enough for Claude/Cursor.

---

## Install

### 1. Clone the repo

```bash
git clone https://github.com/sathyapramod/cost-optimization-model-switcher.git
cd cost-optimization-model-switcher
```

Optional (CLI / library / tests):

```bash
npm install
npm run build
npm test
```

### 2. Install the skill (pick your tool)

#### Claude Code (personal — all projects)

```bash
ln -sfn "$(pwd)" ~/.claude/skills/cost-optimization-model-switcher
```

Verify:

```bash
ls ~/.claude/skills/cost-optimization-model-switcher/SKILL.md
```

**Restart Claude Code** (new session) so it loads the skill.

#### Cursor (personal — all projects)

```bash
mkdir -p ~/.cursor/skills
ln -sfn "$(pwd)" ~/.cursor/skills/cost-optimization-model-switcher
```

Or **per project** (share with your team):

```bash
mkdir -p .cursor/skills
ln -sfn /path/to/cost-optimization-model-switcher .cursor/skills/cost-optimization-model-switcher
```

Restart Cursor or start a **new Agent chat**.

#### OpenAI (ChatGPT / API / custom agent)

There is no OpenAI “skill folder” today. Use one of:

| Approach | How |
|----------|-----|
| **CLI gate** | Run `npm run gate` before sending large context (see below) |
| **API proxy** | Run `npm run proxy` and call `/v1/gate` from your app |
| **Library** | `import { evaluateGate } from './dist/index.js'` in your agent |

Copy `SKILL.md` into your system prompt or agent instructions if you want the same behavior in a custom GPT.

---

## Use it

### Invoke the skill

In **Claude Code** or **Cursor Agent**:

```
/cost-optimization-model-switcher

Summarize this 2MB CI log and list only errors.
```

Or mention cost/context in natural language — the skill may auto-apply when large external context is involved.

### What you should see

1. The agent **stops before** fetching full PRs, Jira exports, or huge files.
2. It asks you to switch models (via **AskUserQuestion** or a confirmation UI).
3. You approve the recommended tier.

### Important: manual model change (Claude Code & Cursor today)

**The skill cannot change the model in the status bar for you** (yet).

After you approve a switch:

1. Run **`/model`** (Claude Code) or use the **model picker** in Cursor.
2. Select the recommended model (e.g. Sonnet).
3. Confirm the **bottom bar** shows the new model.
4. Reply **`switched`** (or restate the task).

The conversation context stays in the **same session** — you do not need to re-paste the full prompt.

```
You:     /cost-optimization-model-switcher Implement a Backstage plugin with tests
Agent:   [asks] Switch to Sonnet?
You:     Switch to Sonnet and continue
You:     /model  → pick Sonnet
You:     switched
Agent:   [continues on Sonnet with full context]
```

### Opt out

Say any of:

- `stay on opus`
- `no model switch`
- `disable cost optimizer`

---

## Try it (copy-paste examples)

Run these from the repo root after `npm run build`.

**Downgrade — Opus → cheaper (exit code 2 = switch recommended)**

```bash
npm run gate -- --model claude-opus-4-6 \
  --probe log_file:2000000 \
  "Summarize this CI log"
```

**Upgrade — Haiku → Sonnet (moderate complex)**

```bash
npm run gate -- --json --model claude-haiku-4-5 \
  "Implement a new Backstage plugin for Git repo registration with tests"
```

**Upgrade — Haiku → Opus (deep complex)**

```bash
npm run gate -- --model claude-haiku-4-5 \
  --probe database_dump:500000 \
  "Design auth migration from this database dump"
```

**OpenAI downgrade**

```bash
npm run gate -- --model o3 --provider openai \
  --probe log_file:2000000 \
  "Summarize this CI log"
```

**Cursor upgrade**

```bash
npm run gate -- --model cursor-small --provider cursor \
  "Implement distributed auth migration"
```

Add `--json` for machine-readable output.

### CLI probe formats

| `--probe` value | Meaning |
|-----------------|---------|
| `github_pr:1200,400,18` | PR diff stats (additions, deletions, files changed) |
| `jira:40` | ~40 issues in scope |
| `log_file:2000000` | Log file ~2MB |
| `database_dump:1500000` | Dump ~1.5MB |

---

## Platform-specific notes

### Claude Code

| Item | Detail |
|------|--------|
| Skill path | `~/.claude/skills/cost-optimization-model-switcher/` |
| Invoke | `/cost-optimization-model-switcher` |
| Switch model | `/model` after the prompt |
| Auto-switch | Not available yet — manual `/model` required |

### Cursor

| Item | Detail |
|------|--------|
| Skill path | `~/.cursor/skills/…` or `.cursor/skills/…` |
| Invoke | `@cost-optimization-model-switcher` or paste skill name in Agent |
| Switch model | Model picker in chat UI |
| Catalog | Pass `provider: "cursor"` when model IDs are ambiguous |

### OpenAI

| Item | Detail |
|------|--------|
| CLI | `npm run gate -- --model gpt-4o-mini --provider openai "…"` |
| Proxy | `npm run proxy` → `POST http://127.0.0.1:8787/v1/gate` |
| Catalog | Edit `catalogs/default.json` for your model slugs |

More detail: [docs/PROVIDERS.md](docs/PROVIDERS.md)

---

## Customize models

Edit `catalogs/default.json` to add your model names:

```json
{
  "entries": [
    { "match": "composer-2.5", "provider": "cursor", "tier": "premium", "priority": 110 }
  ],
  "defaults": {
    "cursor": {
      "premium": "composer-2.5",
      "balanced": "composer-2",
      "fast": "cursor-small"
    }
  }
}
```

Then run `npm test`. Unknown models skip the gate until you add them.

---

## Update after `git pull`

The skill is usually a **symlink** to this repo:

```bash
cd cost-optimization-model-switcher
git pull origin main
```

Restart **Claude Code** or **Cursor** (new session) to reload `SKILL.md`.

No reinstall needed if the symlink is still valid.

---

## For developers

### HTTP proxy (reference)

```bash
npm run proxy
# POST http://127.0.0.1:8787/v1/gate
# POST http://127.0.0.1:8787/v1/suggest_model_switch
```

Set `AUTO_SWITCH=1` for dev auto-accept.

### Library

```typescript
import { evaluateGate } from "cost-optimization-model-switcher";

const decision = evaluateGate({
  currentModel: "claude-opus-4-6",
  userMessage: "Summarize this 2MB CI log",
  probes: [{ source: "log_file", bytes: 2_000_000 }],
});

if (decision.action === "suggest_switch") {
  console.log(decision.suggestSwitch);
}
```

Tool schema for custom UIs: `schemas/suggest_model_switch.json`

### Project layout

```
├── SKILL.md                 # Agent instructions (install this)
├── catalogs/default.json    # Model → tier mapping
├── schemas/                 # suggest_model_switch tool schema
├── docs/PROVIDERS.md        # Provider integration guide
├── src/                     # Gate library + CLI + proxy
└── examples/                # Sample tool calls
```

---

## Limitations (read this)

| Limitation | Workaround |
|------------|------------|
| Skill does not auto-change Claude/Cursor model | User runs `/model` or model picker, then says `switched` |
| `suggest_model_switch` tool not wired in Claude Code UI | `AskUserQuestion` + manual switch |
| Agent may skip the gate if skill not invoked | Use `/cost-optimization-model-switcher` explicitly |
| New session loses thread | Re-paste task or say “continue …” |

---

## FAQ

**Q: Do I need npm to use the skill?**  
No. Symlink `SKILL.md` via the repo path. npm is for CLI, tests, and library use.

**Q: Will it work on Sonnet / Haiku / GPT-4o?**  
Yes. The catalog maps any supported model ID to a tier.

**Q: Why did it recommend Sonnet but I’m still on Haiku?**  
The prompt records your choice; you must switch the session model manually.

**Q: Does “switched” keep my earlier messages?**  
Yes, in the **same session**. New session = re-paste the task.

---

## License

MIT — see [LICENSE](LICENSE)

## Links

- [Provider & catalog guide](docs/PROVIDERS.md)
- [Cost estimates (heuristic)](docs/COST_MODEL.md)
- [Task vs ingest scoring](docs/SCORING.md)
- [Roadmap](docs/ROADMAP.md)
- [Example tool call](examples/tool-call.json)
- [Integration examples](examples/integration.md)
