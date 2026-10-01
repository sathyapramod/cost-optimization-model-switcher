# Cost Optimization & Model Switcher

You do not need your most expensive model for every coding task.

This project is a **local, explainable gate** for AI coding agents. It reads your message and context hints (PR size, log bytes, and similar probes), estimates task complexity and context, and recommends whether to **stay** on the current model, **move to a cheaper tier**, **move to a stronger tier**, or **abstain** when quality evidence is not strong enough to justify a change.

- **Local routing** — no provider API call for a normal recommendation  
- **Cost-aware** — heuristic turn-cost estimates from [catalogs/pricing.json](catalogs/pricing.json)  
- **Quality-aware** — can refuse a “cheap enough” downgrade when offline evidence does not support it  
- **No API key** required for `npm run gate`, the library, or the proxy  

Works with **Claude Code**, **Cursor**, **OpenAI-style** setups (CLI, HTTP proxy, or npm package). See [SKILL.md](SKILL.md) for agent behavior.

---

## Why this exists

Coding agents often default to **premium** models. That is reasonable for hard problems, but expensive for work that is mostly **reading and transforming bulk context**: summarizing CI logs, extracting fields from exports, triaging tickets, or listing PR issues. The opposite mistake is staying on a **fast** model for architecture design, security review, or subtle debugging.

This tool sits **before** you ingest a huge diff or log. It asks: given this task and this context size, is your current model tier a good fit—and is there enough **quality evidence** to recommend a cheaper alternative?

```text
User task
   ↓
Analyze task
   ↓
Estimate context + complexity
   ↓
Evaluate model capability + cost
   ↓
Check quality evidence
   ↓
Recommend:
   ↓
Downgrade / Stay / Upgrade / Abstain
```

The gate **suggests**; it does not change your IDE model for you.

---

## What can it recommend?

| Situation | Recommendation |
|-----------|----------------|
| Large context + straightforward task (e.g. summarize log) | **Downgrade** to a cheaper capable tier when evidence allows |
| Complex task on a weaker tier (e.g. migration on Haiku) | **Upgrade** to a stronger tier |
| Current tier already fits (or context too small to switch) | **Stay** (`proceed`) |
| Ambiguous prompt, missing evidence, or quality floor not met | **Abstain** — keep current model; no quality-safe downgrade |

Implementation terms: **`suggest_switch`** (downgrade or upgrade, CLI exit code `2`) vs **`proceed`** (stay, abstain, opt-out, or unknown model). A cheaper tier is recommended only when capability **and** configured quality checks allow it—not because “cheap” is always better.

---

## Model tiers

Models map to three **capability tiers** (see [catalogs/default.json](catalogs/default.json)). Defaults below; your host may use other IDs if they match catalog entries.

| Tier | Anthropic (default) | OpenAI (default) | Typical use |
|------|---------------------|------------------|-------------|
| **Premium** | claude-opus-4-6 | o3 | Architecture, hard debugging, deep reasoning |
| **Balanced** | claude-sonnet-4-6 | gpt-4o | PR review, nuanced implementation |
| **Fast** | claude-haiku-4-5 | gpt-4o-mini | Summarization, extraction, triage |

Cursor defaults in the same catalog use claude-opus-4-6 / claude-sonnet-4-6 / gpt-4o-mini for premium / balanced / fast. Unknown model IDs **skip switching** until you add them to the catalog.

---

## How it works

At a high level:

```text
Task analysis
      ↓
Context estimation
      ↓
Capability routing
      ↓
Cost estimation (when a switch is suggested)
      ↓
Quality evidence
      ↓
Routing confidence
      ↓
Recommendation + decision trace
```

| Step | What it does |
|------|----------------|
| **Task analysis** | Infers task type, difficulty, and minimum capability from your message |
| **Context estimation** | Uses probes (bytes, PR stats, etc.) for token bands and scoped-ingest hints |
| **Capability routing** | Picks the lowest-cost tier whose profile fits the task |
| **Cost estimation** | Single-turn USD estimate from pricing catalog + heuristic output tokens |
| **Quality evidence** | Offline evaluator history may **abstain** instead of endorsing a downgrade |
| **Routing confidence** | Blocks aggressive switches on ambiguous or underspecified prompts |
| **Recommendation** | `evaluateGate()` → stay, switch, or abstain with a human-readable trace |

Capability routing and quality assurance are **separate layers**; the gate follows the **effective** recommendation after quality rules. Details: [docs/ROUTING_ASSURANCE.md](docs/ROUTING_ASSURANCE.md).

---

## Do I need an API key?

### Normal usage: **No**

The gate runs **entirely on your machine**. It does **not** call Anthropic or OpenAI to produce a routing decision.

You can run it with **no** `ANTHROPIC_API_KEY` and **no** `OPENAI_API_KEY`:

- `npm run gate` / `cost-gate`
- `evaluateGate()` from the npm package
- `npm run proxy`
- `npm test`, `npm run benchmark`, `npm run evaluate`, `npm run benchmark:router`

### Live evaluation: **Yes** (optional, for maintainers)

Only **`npm run evaluate:live`** (and similar maintainer flows) call a real provider API. You need the key for the provider you pass on the command line—not both keys unless you run both providers.

| Provider | Environment variable |
|----------|----------------------|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |

Live evaluation is **optional**. It is not part of ordinary gate usage. See [src/test/api-key-separation.test.ts](src/test/api-key-separation.test.ts) for regression coverage.

---

## Installation and normal usage

**Node 20+** for CLI and library. **Git only** if you install the agent skill via symlink (no npm required for the skill alone).

```bash
git clone https://github.com/sathyapramod/cost-optimization-model-switcher.git
cd cost-optimization-model-switcher
npm install
npm run build
```

Analyze a task (example: Opus + large log + summarize):

```bash
npm run gate -- --model claude-opus-4-6 \
  --probe log_file:2000000 \
  "Summarize this CI log"
```

Machine-readable output and decision trace:

```bash
npm run gate -- --json --model claude-opus-4-6 \
  --probe log_file:2000000 \
  "Summarize this CI log"
```

Other useful probes: `github_pr:1200,400,18`, `jira:40`, `database_dump:1500000`, `paste:8000`. Run `npm run help` for formats.

| Exit code | Meaning |
|-----------|---------|
| `0` | Proceed — stay, abstain, or no switch |
| `2` | Switch recommended (`suggest_switch`) |
| `1` | Error (e.g. invalid arguments) |

---

## What the output means

Human mode prints a **MODEL ROUTING DECISION** block (from `formatDecisionTraceText`), then optional pricing audit lines. With `--json`, you get the full `GateDecision` plus `decisionTrace` and `pricingCatalogAudit`.

**Trace sections (human output):**

| Section | Meaning |
|---------|---------|
| **Current model** | Resolved tier and catalog ID for `--model` |
| **Task** | Inferred category and task class (straightforward vs complex) |
| **Context** | Estimated tokens, context band, primary probe source |
| **Required capabilities** | Inferred needs (e.g. long-context, summarization) |
| **Quality evidence** | Disposition: `sufficient`, `insufficient`, or `unknown`; quality floor line when applicable |
| **Decision** | e.g. `DOWNGRADE → …`, `KEEP CURRENT MODEL`, `ABSTAIN` |
| **Reason** | On abstain, why evidence blocked a safe cheaper switch |
| **Estimated cost** | Present when `suggest_switch` includes cost fields |
| **Why** | Bullet list derived from gate fields (deterministic, not LLM-generated) |

**Important JSON fields:**

| Field | Meaning |
|-------|---------|
| `action` | `proceed` or `suggest_switch` |
| `suggestSwitch.switch_direction` | `downgrade` or `upgrade` |
| `suggestSwitch.recommended_model_id` | Catalog target model |
| `suggestSwitch.estimated_cost_*_usd` | Heuristic single-turn costs—not invoices |
| `suggestSwitch.savings_percent` | Relative savings vs current model on that estimate |
| `routing.routingConfidence` | Confidence state; may block switch |
| `routing.qualityAssurance.guarantee.level` | `none`, `probabilistic`, or `abstain` |
| `decisionTrace` | Same story as human trace, structured for tools |

Cost numbers depend on probes, task class, and [catalogs/pricing.json](catalogs/pricing.json); treat them as **estimates**.

---

## Real-world examples

These match behaviors covered by gate fixtures and tests—not performance guarantees.

### Example A — Downgrade

**Situation:** Premium model, large log, clearly straightforward summarization, quality evidence supports a fast-tier switch.

```bash
npm run gate -- --json --model claude-opus-4-6 \
  --probe log_file:2000000 \
  "Summarize this CI log and list errors only"
```

**Typical outcome:** `action: "suggest_switch"`, `switch_direction: "downgrade"`, recommended fast-tier ID (e.g. claude-haiku-4-5), cost and savings fields populated, `decisionTrace.label: "DOWNGRADE"` when quality disposition is sufficient.

### Example B — Upgrade

**Situation:** Fast tier, complex migration / architecture-style task.

```bash
npm run gate -- --json --model claude-haiku-4-5 \
  --probe database_dump:500000 \
  "Design auth migration from this dump"
```

**Typical outcome:** `suggest_switch` with `switch_direction: "upgrade"` toward premium (e.g. claude-opus-4-6).

### Example C — Abstain / stay

**Underspecified prompt (abstain on downgrade path):**

```bash
npm run gate -- --model claude-opus-4-6 \
  --probe log_file:2000000 \
  "Analyze this."
```

**Typical outcome:** `proceed`, routing confidence insufficient, quality may abstain; trace label **ABSTAIN**; no downgrade recommendation.

**Stay on premium (complex task):** architecture/migration prompts with large dumps often **`proceed`** with complex task class—no downgrade even with large context.

**Unknown model:** IDs not in the catalog → **`proceed`**, reason includes `unknown model`; switching skipped.

---

## Evidence and quality

The router does **not** always pick the cheapest capable model. Flow:

```text
Candidate cheaper model
        ↓
Quality evidence
        ↓
 ┌──────┴──────┐
 ↓             ↓
Enough       Insufficient
evidence     evidence
 ↓             ↓
Recommend     Abstain
 (switch)     (stay)
```

| Layer | Role |
|-------|------|
| **Capability routing** | “Which tier fits the task?” (profiles + cost policy) |
| **Quality evidence** | “Do we have offline pass-rate / quality data for this spec and model?” |
| **Final recommendation** | Quality can **veto** a downgrade; effective choice in `routing.effectiveRecommendation` |

**Data types (do not mix them up):**

| Data | What it is |
|------|------------|
| **Fixture evaluation** | Recorded outputs in `benchmarks/<domain>/` scored by criterion evaluators—used for evidence index (train split) |
| **Synthetic rates** | [benchmarks/success-rates.json](benchmarks/success-rates.json)—placeholder tier×category rates for **cost-per-success math only**, not empirical quality truth |
| **Live evaluation** | Optional API runs → `benchmarks/results/live-runs.json` (gitignored locally)—empirical outputs scored offline |
| **Holdout** | Generalization slice; **not** merged into routing evidence |

Train vs holdout: [docs/EVALUATION.md](docs/EVALUATION.md).

---

## Benchmark results

Committed repository **does not ship** generated benchmark numbers (`benchmarks/results/` is gitignored). To produce a report locally:

```bash
npm run benchmark:router
```

Writes `benchmarks/results/router-benchmark.json` and `.md` on your machine.

The report compares:

- **Strategy A — Premium baseline:** always premium tier on the workload  
- **Strategy B — Router:** production `evaluateGate` from premium start  

It includes **estimated** total cost, cost per task, cost per successful task (using fixture + synthetic quality weights where noted), quality pass rate (mixed evidence), **routing decision counts** (downgrade / upgrade / stay / abstain), and an explicit evidence label that costs are fixture-based and quality is **not** live API measurement.

**Do not treat these figures as provider bills or production savings.** They characterize the bundled offline workload only.

Other offline checks:

```bash
npm test                 # unit + adversarial regression
npm run evaluate         # fixtures + adversarial traps
npm run benchmark        # gate fixtures only
```

---

## Integration

| Path | How |
|------|-----|
| **Claude Code** | Symlink repo → `~/.claude/skills/cost-optimization-model-switcher`; use skill in session ([SKILL.md](SKILL.md)) |
| **Cursor** | Symlink → `~/.cursor/skills/cost-optimization-model-switcher` (or `.cursor/skills/` in repo) |
| **HTTP** | `npm run proxy` → `POST /v1/gate` ([examples/integration.md](examples/integration.md)) |
| **npm / library** | `import { evaluateGate, gateDecisionWithTrace } from "cost-optimization-model-switcher"` |

After a recommendation, **you** change the model in `/model` or the host picker, then continue (e.g. reply `switched` per skill). Hosts do not auto-switch today.

Custom models: [catalogs/default.json](catalogs/default.json), [docs/PROVIDERS.md](docs/PROVIDERS.md). Tool schema: [schemas/suggest_model_switch.json](schemas/suggest_model_switch.json).

### Claude Code

```bash
ln -sfn "$(pwd)" ~/.claude/skills/cost-optimization-model-switcher
```

Restart the app (new session). Verify: `SKILL.md` exists under that path.

### Cursor

```bash
mkdir -p ~/.cursor/skills
ln -sfn "$(pwd)" ~/.cursor/skills/cost-optimization-model-switcher
```

Invoke `@cost-optimization-model-switcher` or `/cost-optimization-model-switcher` in Agent chat.

---

## CLI reference

### User commands

| Command | Purpose |
|---------|---------|
| `npm run gate` | Analyze task; print decision trace (or JSON with `--json`) |
| `npm run help` | Gate CLI help |
| `npm run proxy` | HTTP gate on `127.0.0.1:8787` (see proxy source) |
| `npm run build` | Compile TypeScript (required before gate/proxy from source) |

Common flags: `--model`, `--provider`, `--probe` (repeatable), `--json`, `--opt-out`, `--chose-opus`, `--chose-cheap`, `--auto-switch`.

### Developer / maintainer commands

| Command | Purpose |
|---------|---------|
| `npm test` | Build + unit tests (gate, adversarial, API-key isolation, …) |
| `npm run evaluate` | Router regression + adversarial suite |
| `npm run benchmark` | Gate fixture benchmarks |
| `npm run benchmark:router` | Premium baseline vs router (cost + quality mix) |
| `npm run evaluate:task-quality` | Criterion evaluation on domain fixtures |
| `npm run evaluate:held-out` | Holdout split only |
| `npm run evaluate:live` | Live provider API + same evaluators |
| `npm run evaluate:live-compare` | Offline baseline vs router from recorded live runs |
| `npm run validate-skill` | Validate SKILL.md structure |

---

## Developer / maintainer evaluation

Live and holdout tooling exists to **calibrate and sanity-check** routing evidence—not for end users running the gate day to day.

- **`evaluate:live`** — Calls a real model, scores output with the same criteria as fixtures, can append to `live-runs.json`. Requires **`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`** for the chosen `--provider`. Train-split runs can merge into routing evidence; holdout does not.  
- **`evaluate:held-out`** — Measures generalization on holdout cases without feeding routing rules.  
- **`evaluate:live-compare`** — Reads recorded live runs only (no API); reports paired baseline vs router when enough holdout samples exist; otherwise states insufficient evidence.  
- **`benchmark:router`** — Offline workload; mixed fixture/synthetic quality; labeled in report JSON.

Interpret benchmarks as **regression signals**, not proof of real-world spend or quality unless you have your own live holdout data.

Workflow notes: [docs/EVALUATION.md](docs/EVALUATION.md), [benchmarks/README.md](benchmarks/README.md).

---

## Limitations

| Topic | Note |
|-------|------|
| **Cost** | Estimates from catalog list prices + heuristic output tokens—not invoices |
| **Pricing freshness** | [catalogs/pricing.json](catalogs/pricing.json) metadata may have no `retrievedAt`; CLI can warn when stale/unknown |
| **Quality** | Probabilistic / fixture-based; abstain when evidence is weak—not universal correctness |
| **Task understanding** | Heuristic classifiers; ambiguous prompts trigger abstain or clarification |
| **Switching** | Recommendations only; IDE must change model manually |
| **Live eval** | Requires provider credentials; optional |
| **Public claims** | Do not cite offline router benchmark % as production ROI without live validation |

---

## FAQ

### Does this call Anthropic/OpenAI during normal routing?

**No.** Normal gate, proxy, and library paths are local. Only maintainer commands such as `npm run evaluate:live` call provider APIs.

### Do I need an API key?

**Not for normal gate usage.** Optional **`ANTHROPIC_API_KEY`** or **`OPENAI_API_KEY`** only when you run live evaluation for the matching provider.

### Does it automatically switch my model?

**No.** The skill/CLI recommends; you switch in Claude Code (`/model`), Cursor (picker), or your host, then continue the session.

### Is the cost exact?

**No.** It is a **heuristic** turn estimate from `catalogs/pricing.json` and inferred token counts. See [docs/COST_MODEL.md](docs/COST_MODEL.md).

### What happens when the router is uncertain?

It **abstains** or **stays**: insufficient task description, missing quality evidence, quality floor not met, or low routing confidence. Check `decisionTrace` or `routing.qualityAssurance`.

### Can I run the benchmark myself?

Yes:

```bash
npm run benchmark:router
```

Output is written under `benchmarks/results/` (local; not committed). See [benchmarks/README.md](benchmarks/README.md).

### Do I need npm for the Claude/Cursor skill?

**No** for the skill symlink alone. **Yes** for CLI, tests, and npm package usage.

---

## License

MIT — [LICENSE](LICENSE)

---

## Further reading (advanced)

| Topic | Document |
|-------|----------|
| Docs index | [docs/README.md](docs/README.md) |
| Routing vs quality assurance | [docs/ROUTING_ASSURANCE.md](docs/ROUTING_ASSURANCE.md) |
| Routing internals | [docs/ROUTING.md](docs/ROUTING.md) |
| Cost model | [docs/COST_MODEL.md](docs/COST_MODEL.md) |
| Evaluation & holdout | [docs/EVALUATION.md](docs/EVALUATION.md) |
| Benchmarks layout | [benchmarks/README.md](benchmarks/README.md) |
| Agent skill (install) | [SKILL.md](SKILL.md) |
| Catalogs | [catalogs/](catalogs/) |
| HTTP examples | [examples/integration.md](examples/integration.md) |
