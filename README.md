# Cost Optimization & Model Switcher

Explainable **model gate** for AI coding agents: classify the task, size the context, recommend the lowest **capability tier** that fits (premium / balanced / fast), and optionally estimate turn cost—before Opus ingests a 2MB log or Haiku tackles a migration.

**Claude Code** · **Cursor** · **OpenAI** (skill, CLI, HTTP proxy, or npm library)

| | |
|--|--|
| **Deep docs & concepts** | [docs/README.md](docs/README.md) |
| **Agent behavior (install this)** | [SKILL.md](SKILL.md) |

> Hosts do not auto-change the model yet. The skill **stops and asks**; you switch in `/model` or the picker, then reply `switched`.

---

## Contents

- [Choose your path](#choose-your-path)
- [Try the CLI](#try-the-cli-60-seconds)
- [Install the skill](#install-the-skill)
- [Use in the agent](#use-in-the-agent)
- [CLI reference](#cli-reference)
- [Integrate in your app](#integrate-in-your-app)
- [How routing works](#how-routing-works)
- [FAQ](#faq)

---

## Choose your path

| Goal | Start here | Needs npm? |
|------|------------|------------|
| Gate runs inside **Claude Code / Cursor** on every big PR, log, or Jira pull | [Install the skill](#install-the-skill) → [Use in the agent](#use-in-the-agent) | No |
| **Script or CI** calls the gate before a model turn | [Try the CLI](#try-the-cli-60-seconds) → [CLI reference](#cli-reference) | Yes |
| **Your product** calls `evaluateGate` or the proxy | [Integrate in your app](#integrate-in-your-app) | Yes |

**What ships in this repo**

| Artifact | Role |
|----------|------|
| `SKILL.md` | Instructions the agent follows (symlink into skills) |
| `npm run gate` / `cost-gate` | CLI; exit `2` = switch recommended |
| `evaluateGate()` | Same logic in TypeScript |
| `npm run proxy` | `POST /v1/gate` for HTTP integrators |
| `catalogs/default.json` | Your model IDs → tiers |

---

## Try the CLI (60 seconds)

**Requires:** Node 20+, then from repo root:

```bash
git clone https://github.com/sathyapramod/cost-optimization-model-switcher.git
cd cost-optimization-model-switcher
npm install && npm run build
```

**Downgrade example** (Opus + ~2MB log + summarize → Haiku):

```bash
npm run gate -- --json --model claude-opus-4-6 \
  --probe log_file:2000000 \
  "Summarize this CI log"
```

| Exit code | Meaning |
|-----------|---------|
| `0` | Stay on current tier |
| `2` | Switch recommended (`suggestSwitch` in JSON) |
| `1` | Error (bad args or unknown model—add it to the catalog) |

**What good output looks like** (fields trimmed):

```json
{
  "action": "suggest_switch",
  "routing": {
    "capableTier": "fast",
    "recommendedTier": "fast"
  },
  "suggestSwitch": {
    "switch_direction": "downgrade",
    "recommended_model_id": "claude-haiku-4-5",
    "rationale": "straightforward task over ~500k input tokens; …",
    "scoped_ingest_plan": "Do not read the full file first: run grep/tail …",
    "estimated_cost_current_usd": 8.1,
    "estimated_cost_recommended_usd": 0.54,
    "savings_percent": 93.3
  }
}
```

Also inspect `taskAnalysis`, `capabilityProfile`, and `contextOptimization` in the full JSON.

---

## Install the skill

**Requires:** Git only (no npm).

```bash
git clone https://github.com/sathyapramod/cost-optimization-model-switcher.git
cd cost-optimization-model-switcher
```

### Claude Code

```bash
ln -sfn "$(pwd)" ~/.claude/skills/cost-optimization-model-switcher
```

Open a **new session** (restart Claude Code). Confirm: `ls ~/.claude/skills/cost-optimization-model-switcher/SKILL.md`

### Cursor

```bash
mkdir -p ~/.cursor/skills
ln -sfn "$(pwd)" ~/.cursor/skills/cost-optimization-model-switcher
```

Team repo (optional):

```bash
mkdir -p .cursor/skills
ln -sfn "$(pwd)" .cursor/skills/cost-optimization-model-switcher
```

New **Agent** chat. Invoke: `@cost-optimization-model-switcher` or `/cost-optimization-model-switcher`.

### OpenAI / custom agents

No skill folder—use [CLI](#try-the-cli-60-seconds), [proxy](#integrate-in-your-app), or paste [SKILL.md](SKILL.md) into system instructions.

### After `git pull`

Symlink installs pick up code on pull; restart the host (**new session**) so `SKILL.md` reloads.

---

## Use in the agent

1. **Before** full PR/Jira/log/DB ingest, the skill evaluates task + probes (size/metadata).
2. You confirm a tier change when prompted.
3. You switch the session model, then say **`switched`**—same chat, no need to re-paste the whole task.

```
You:     /cost-optimization-model-switcher Implement a Backstage plugin with tests
Agent:   Recommend Sonnet?
You:     Yes
You:     /model  → Sonnet   (or Cursor model picker)
You:     switched
Agent:   continues on Sonnet
```

**Opt out:** `stay on opus` · `no model switch` · `disable cost optimizer`

| | Claude Code | Cursor | OpenAI |
|--|-------------|--------|--------|
| Skill location | `~/.claude/skills/cost-optimization-model-switcher/` | `~/.cursor/skills/…` or `.cursor/skills/…` | Use CLI/proxy/library |
| Change model | `/model` | Model picker | Your UI |
| Ambiguous slug | Default catalog | `provider: "cursor"` in API | `--provider openai` |

If the gate never runs, invoke the skill explicitly for that turn.

---

## CLI reference

All commands from repo root after `npm run build`.

| Scenario | Command |
|----------|---------|
| Downgrade | `npm run gate -- --model claude-opus-4-6 --probe log_file:2000000 "Summarize this CI log"` |
| Upgrade (code) | `npm run gate -- --json --model claude-haiku-4-5 "Implement a Backstage plugin with tests"` |
| Upgrade (deep + dump) | `npm run gate -- --model claude-haiku-4-5 --probe database_dump:500000 "Design auth migration from this dump"` |
| OpenAI | `npm run gate -- --model o3 --provider openai --probe log_file:2000000 "Summarize this CI log"` |
| Cursor | `npm run gate -- --model cursor-small --provider cursor "Implement distributed auth migration"` |

**Probes** (`--probe`):

| Value | Meaning |
|-------|---------|
| `github_pr:1200,400,18` | Additions, deletions, files changed |
| `jira:40` | ~40 issues |
| `log_file:2000000` | ~2MB log |
| `database_dump:1500000` | ~1.5MB dump |

---

## Integrate in your app

**Proxy**

```bash
npm run proxy
# POST http://127.0.0.1:8787/v1/gate
# POST http://127.0.0.1:8787/v1/suggest_model_switch
```

`AUTO_SWITCH=1` for local dev. Curl examples: [examples/integration.md](examples/integration.md).

**Library**

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

**Custom models** — add rows to [catalogs/default.json](catalogs/default.json), then `npm test`. Unknown models skip the gate until catalogued. Guide: [docs/PROVIDERS.md](docs/PROVIDERS.md).

**Tool schema:** [schemas/suggest_model_switch.json](schemas/suggest_model_switch.json)

---

## How routing works

```text
Prompt + probes (PR stats, bytes, …)
    → task analysis (difficulty, intents, minimum tier)
    → capability match (premium / balanced / fast)
    → confidence check → proceed or suggest_switch
```

| Tier | Default Claude | Default OpenAI | Typical use |
|------|----------------|----------------|-------------|
| **premium** | Opus | o3, o1 | Architecture, migration, hard debug |
| **balanced** | Sonnet | gpt-4o | PR review, nuanced implementation |
| **fast** | Haiku | gpt-4o-mini | Summarize, extract, triage |

Routing internals (profiles, confidence, benchmarks): [docs/README.md](docs/README.md).

---

## Limitations

| Issue | What to do |
|-------|------------|
| No automatic model switch in IDE | `/model` or picker, then `switched` |
| Cost numbers are estimates | [docs/COST_MODEL.md](docs/COST_MODEL.md)—not invoices |
| New chat | Re-paste or “continue …” |

---

## FAQ

**npm for the skill only?**  
No—symlink is enough. npm is for CLI, tests, and library.

**Recommended Sonnet but still on Haiku?**  
The gate advises; you change the session model.

**Same session after `switched`?**  
Yes—context stays in that chat.

---

## License

MIT — [LICENSE](LICENSE)
