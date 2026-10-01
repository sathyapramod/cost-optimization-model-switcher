# Cost Optimization & Model Switcher

Explainable **model gate** for AI coding agents: classify the task, size the context, and suggest a **capability-tier** switch (premium / balanced / fast). **Routing** (cheapest capable tier) and **quality assurance** (offline evaluator evidence) are separate — the gate may abstain from a downgrade when evidence does not support it. Estimates turn cost before Opus ingests a 2MB log or Haiku tackles a migration.

**Claude Code** · **Cursor** · **OpenAI** (skill, CLI, HTTP proxy, or npm library)

| | |
|--|--|
| **Deep docs & concepts** | [docs/README.md](docs/README.md) |
| **Routing vs quality assurance** | [docs/ROUTING_ASSURANCE.md](docs/ROUTING_ASSURANCE.md) |
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
- [API keys](#api-keys)
- [Evaluation & benchmarks](#evaluation--benchmarks)
- [Developer / maintainer evaluation](#developer--maintainer-evaluation)
- [Limitations](#limitations)
- [FAQ](#faq)

---

## Choose your path

| Goal | Start here | Needs npm? |
|------|------------|------------|
| Gate runs inside **Claude Code / Cursor** on every big PR, log, or Jira pull | [Install the skill](#install-the-skill) → [Use in the agent](#use-in-the-agent) | No |
| **Script or CI** calls the gate before a model turn | [Try the CLI](#try-the-cli-60-seconds) → [CLI reference](#cli-reference) | Yes |
| **Your product** calls `evaluateGate` or the proxy | [Integrate in your app](#integrate-in-your-app) | Yes |
| **Measure** task-quality on fixtures or live APIs (maintainers) | [Developer / maintainer evaluation](#developer--maintainer-evaluation) | Yes |

**What ships in this repo**

| Artifact | Role |
|----------|------|
| `SKILL.md` | Instructions the agent follows (symlink into skills) |
| `npm run gate` / `cost-gate` | CLI; exit `2` = switch recommended |
| `evaluateGate()` / `routeForTask()` | Gate + full routing decision (recommendation + assurance) |
| `npm run proxy` | `POST /v1/gate` for HTTP integrators |
| `catalogs/default.json` | Your model IDs → tiers |
| `benchmarks/<domain>/suite.json` | Per–task-class quality cases (train + holdout) |
| `benchmarks/assets/<caseId>.txt` | Source text for live API evaluation prompts |

---

## Try the CLI (60 seconds)

**Requires:** Node 20+ only — **no Anthropic or OpenAI API keys** for the cost gate. From repo root:

```bash
git clone https://github.com/sathyapramod/cost-optimization-model-switcher.git
cd cost-optimization-model-switcher
npm install && npm run build
npm run gate -- --json --model claude-opus-4-6 \
  --probe log_file:2000000 \
  "Summarize this CI log"
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
    "recommendedTier": "fast",
    "routingRecommendation": { "kind": "capability_routing", "recommendedModelId": "claude-haiku-4-5" },
    "qualityAssurance": {
      "kind": "quality_assurance",
      "guarantee": { "level": "probabilistic" },
      "evidenceStatus": "known",
      "evidenceSource": "fixture_train"
    },
    "effectiveRecommendation": { "basis": "quality_assured" }
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

`recommendedModelId` / `recommendedTier` follow **effective** choice (quality overlay may abstain and preserve the current model). Also inspect `taskAnalysis`, `capabilityProfile`, `routingConfidence`, and `contextOptimization` in the full JSON.

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

All commands from repo root after `npm run build`. The **gate** is local and deterministic — it does not call Anthropic or OpenAI.

| Command | Role |
|---------|------|
| `npm run gate` | **Primary** — task analysis, routing, cost estimate, model recommendation |
| `npm run proxy` | HTTP wrapper around the same gate logic |

**Developer / maintainer** (offline or live validation): `npm run evaluate:task-quality`, `npm run evaluate:held-out`, `npm run evaluate:live` — see [Developer / maintainer evaluation](#developer--maintainer-evaluation).

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
import { evaluateGate, routeForTask } from "cost-optimization-model-switcher";

const decision = evaluateGate({
  currentModel: "claude-opus-4-6",
  userMessage: "Summarize this 2MB CI log",
  probes: [{ source: "log_file", bytes: 2_000_000 }],
});

if (decision.action === "suggest_switch") {
  console.log(decision.suggestSwitch);
}

// Lower-level: separate routing recommendation vs quality assurance
const routing = routeForTask({
  currentModelId: "claude-opus-4-6",
  userMessage: "Summarize this 2MB CI log",
  probes: [{ source: "log_file", bytes: 2_000_000 }],
});
console.log(routing.routingRecommendation, routing.qualityAssurance);
```

**Custom models** — add rows to [catalogs/default.json](catalogs/default.json), then `npm test`. Unknown models skip the gate until catalogued. Guide: [docs/PROVIDERS.md](docs/PROVIDERS.md).

**Tool schema:** [schemas/suggest_model_switch.json](schemas/suggest_model_switch.json)

---

## How routing works

```text
Prompt + probes
  → task analysis (difficulty, intents, minimum tier)
  → capability routing (cheapest eligible tier from profiles)
  → routing recommendation (cost/capability — not verified quality)
  → quality assurance (Evidence Index v2 vs quality floor; may abstain)
  → effective recommendation → gate action + routingConfidence
```

| Layer | API field | Meaning |
|-------|-----------|---------|
| **Routing recommendation** | `routing.routingRecommendation` | Cheapest capability-eligible model. Disclaimer: not verified task quality. |
| **Quality assurance** | `routing.qualityAssurance` | Pass/fail evidence, `evidenceStatus`, `evidenceSource`, `evidenceConfidence`, guarantee `none` \| `probabilistic` \| `abstain`. |
| **Effective (gate)** | `routing.effectiveRecommendation` | What `recommendedModelId` uses: capability-only, quality-assured, or abstain (keep current). |

| Tier | Default Claude | Default OpenAI | Typical use |
|------|----------------|----------------|-------------|
| **premium** | Opus | o3, o1 | Architecture, migration, hard debug |
| **balanced** | Sonnet | gpt-4o | PR review, nuanced implementation |
| **fast** | Haiku | gpt-4o-mini | Summarize, extract, triage |

**Evidence Index v2** aggregates **pass and fail** evaluator runs per model × success spec (training fixtures + optional live runs). `benchmarks/success-rates.json` is **synthetic demo only** — not routing quality truth.

Details: [docs/ROUTING_ASSURANCE.md](docs/ROUTING_ASSURANCE.md) · [docs/ROUTING.md](docs/ROUTING.md) · [docs/README.md](docs/README.md).

---

## API keys

The **core cost gate** (`npm run gate`, `evaluateGate()`, `npm run proxy`) does **not** require Anthropic or OpenAI API keys. Routing, probes, catalogs, and cost estimates are computed locally.

API keys are **only** required when you explicitly run **live evaluation** against a real provider:

| Live evaluation | Environment variable |
|-----------------|----------------------|
| `--provider anthropic` | `ANTHROPIC_API_KEY` |
| `--provider openai` | `OPENAI_API_KEY` |

You only need the key for the provider you pass to `evaluate:live`. Copy [.env.example](.env.example) if you use a local `.env` for maintainer workflows (optional; the gate never reads it).

---

## Evaluation & benchmarks

Domain suites under `benchmarks/` (summarization, extraction, coding, code-review, debugging, architecture, security, analytical). Each case has success criteria and recorded outputs; **holdout** cases test generalization and are **excluded** from routing evidence.

| Command | Purpose |
|---------|---------|
| `npm test` | Unit tests + gate/adversarial regression |
| `npm run evaluate` | Router regression (`fixtures.json`) + adversarial traps |
| `npm run benchmark` | Gate fixtures only |

Offline fixture evaluation (no API keys): `npm run evaluate:task-quality`, `npm run evaluate:held-out`.

More: [benchmarks/README.md](benchmarks/README.md) · [docs/EVALUATION.md](docs/EVALUATION.md) · [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

---

## Developer / maintainer evaluation

Validation tooling for routing evidence and benchmark quality — **not** required for normal gate usage.

| Command | Purpose |
|---------|---------|
| `npm run evaluate:task-quality` | Criterion pass/fail on all fixture outputs → `benchmarks/results/task-quality-latest.*` |
| `npm run evaluate:held-out` | Holdout split only → `held-out-latest.*` |
| `npm run evaluate:live` | Call a real provider API, same evaluators → `live-runs.json` |

**Offline:**

```bash
npm run evaluate:task-quality
npm run evaluate:held-out
```

**Live** (provider key required only for the `--provider` you choose):

```bash
# Default: holdout slice (does not merge into routing evidence)
npm run evaluate:live -- --provider anthropic --model claude-haiku-4-5 --split holdout

# Train split: appends to live-runs.json and merges into Evidence Index v2 for routing
npm run evaluate:live -- --provider anthropic --split train --domain summarization,coding

# Preview prompts without API cost (no key required)
npm run evaluate:live -- --dry-run --split holdout
```

Prompt source material: `benchmarks/assets/<caseId>.txt` when present. Compare holdout pass rates to training fixtures; a large gap suggests overfitting recorded outputs.

---

## Limitations

| Issue | What to do |
|-------|------------|
| No automatic model switch in IDE | `/model` or picker, then `switched` |
| Cost numbers are estimates | [docs/COST_MODEL.md](docs/COST_MODEL.md)—not invoices |
| Task understanding is heuristic | Probes + classifiers are not validated ground truth |
| Quality assurance is probabilistic | Fixture/live criterion checks — not production correctness |
| New chat | Re-paste or “continue …” |

---

## FAQ

**npm for the skill only?**  
No—symlink is enough. npm is for CLI, tests, evaluation scripts, and library.

**Recommended Sonnet but still on Haiku?**  
The gate advises; you change the session model.

**Same session after `switched`?**  
Yes—context stays in that chat.

**Why did the gate say `proceed` instead of downgrade?**  
Quality assurance may **abstain** (insufficient evidence or no model meets pass-rate / mean-quality floors). Check `routing.qualityAssurance` and `effectiveRecommendation.basis`.

**Train vs holdout benchmarks?**  
**Train** cases feed routing evidence (fixtures + train-split live runs). **Holdout** cases are for generalization checks only.

---

## License

MIT — [LICENSE](LICENSE)
