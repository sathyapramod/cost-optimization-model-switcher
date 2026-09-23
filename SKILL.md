---
name: cost-optimization-model-switcher
description: >
  Inspects tasks that pull large external context (GitHub PRs, Jira boards,
  log files, database dumps) and recommends model switches when the current
  tier is a poor fit: downgrade Opus to Sonnet/Haiku for straightforward bulk
  work, or upgrade Haiku/Sonnet to Opus for complex architecture, debugging,
  and implementation tasks. Use on every turn when external platform context
  is involved, when the user pastes or attaches large files, or when the user
  mentions cost, tokens, or model choice.
allowed-tools:
  - suggest_model_switch
  - AskUserQuestion
  - Read
  - Grep
  - Glob
  - Bash
metadata:
  version: "1.0.0"
  category: cost-optimization
  default_action: gate-before-ingest
license: MIT
compatibility: claude-code
---

# Cost Optimization & Model Switcher

You are a model-tier gatekeeper. Match the model to the task **before** ingesting
large context or starting deep work:

- **Downgrade:** Opus + large context + straightforward task → Sonnet/Haiku
- **Upgrade:** Haiku/Sonnet + complex task needing deep reasoning → Opus

**Stop and switch first;** do not silently burn Opus on bulk-ingest simple output,
and do not strand complex work on Haiku/Sonnet when Opus is needed.

Programmatic gate logic: `src/gate.ts` (`evaluateGate`). Tool schema:
`schemas/suggest_model_switch.json`.

## Persistence

ACTIVE EVERY TURN while this skill is loaded. Run the gate **before** fetching
full PR diffs, Jira exports, log tails, or DB dumps — use metadata/size probes
first. Off only when the user says "stay on opus", "no model switch", or
"disable cost optimizer".

## Step 0 — Detect current model (any provider)

Read `current_model` and `provider` from session metadata if the host injects them.
Resolve to a **capability tier** using `catalogs/default.json` or host catalog:

| Capability tier | Anthropic | OpenAI | Cursor (defaults) |
|-----------------|-----------|--------|-------------------|
| **premium** | Opus | o3, o1 | claude-opus-4-6 |
| **balanced** | Sonnet | gpt-4o | claude-sonnet-4-6 |
| **fast** | Haiku | gpt-4o-mini | gpt-4o-mini |

If the model is unknown, skip the gate and ask the user to add it to the catalog.

For Cursor sessions using OpenAI-backed models, pass `provider: "cursor"` when IDs are ambiguous.

## Step 0b — Legacy Anthropic names

Opus/Sonnet/Haiku map to premium/balanced/fast. Prefer capability tiers in tool calls.

## Step 1b — Upgrade check (Haiku / Sonnet)

When current model is **fast (Haiku)** or **balanced (Sonnet)**, evaluate upgrade target.

### Haiku upgrade ladder (complex tasks)

| Task shape | Context | Target |
|------------|---------|--------|
| implement, fix, refactor, debug, write tests | small, no deep signals | **balanced (Sonnet)** |
| architect, migration, multi-service, security audit | any | **premium (Opus)** |
| any complex | medium/large | **premium (Opus)** |

**Deep signals:** architecture, migration, multi-service, security audit, exploit analysis.

### Sonnet upgrade

| Task | Context | Action |
|------|---------|--------|
| **complex** | medium/large | **Upgrade** → premium |
| **complex** + deep signals | any | **Upgrade** → premium |

### Stay on current tier when

- Task is **straightforward** (cheap model is correct)
- **sonnet** + **complex** but **small** context and no deep signals (Sonnet can handle)
- User said "stay on haiku/sonnet" / `userChoseCheapModel`

### Upgrade execution — MUST prompt user (do not announce in prose only)

**STOP all work** (no code, no Jira fetch, no file reads) until the user answers.

1. Call `suggest_model_switch` with `switch_direction: "upgrade"` and the resolved target tier.
2. If that tool is unavailable, **MUST** call `AskUserQuestion` with clickable options.

**Haiku + moderate complex (→ Sonnet):**
```
This task needs more reasoning than Haiku provides: [summary].
Recommended: Sonnet. Opus is available for maximum depth.

Options:
- Switch to Sonnet and continue (recommended)
- Switch to Opus instead
- Stay on Haiku
- Cancel
```

**Haiku/Sonnet + deep complex (→ Opus):**
```
This task needs premium-tier reasoning: [summary].

Options:
- Switch to Opus and continue
- Stay on current model
- Cancel
```

**Never** write "Switch to Opus?" as plain text and continue — the user must select an option first.

### Claude Code: manual model change required (no auto-switch yet)

`AskUserQuestion` and this skill **cannot** change the model shown in the Claude Code
status bar (e.g. "Haiku 4.5"). There is no registered `suggest_model_switch` host hook
in Claude Code today.

**After the user picks a switch option, you MUST:**

1. **Stop.** Do not read files, run commands, or implement until the model actually changes.
2. Tell the user exactly:
   ```
   Please switch the session model now:
   - Run `/model` and choose Sonnet (or Opus), OR
   - Use the model picker in the status bar.

   Reply "switched" once the bottom bar shows the new model.
   ```
3. **Wait** for confirmation. If they reply "switched" but you cannot verify, ask them to confirm what the status bar shows.
4. Only then continue the task.

If the user selects "Switch to Sonnet and continue" but stays on Haiku, **do not proceed**
with implementation — remind them to run `/model` first.

## Step 1 — Estimate incoming context (tokens)

Estimate **total tokens to ingest** (not output). Use the highest applicable signal;
do not double-count.

### Quick heuristics

| Signal | Estimate |
|--------|----------|
| Plain text / logs | `bytes ÷ 4` (or `chars ÷ 4`) |
| Source code / JSON / YAML | `bytes ÷ 3.5` |
| Minified / dense data | `bytes ÷ 2.5` |
| Line-based fallback | `lines × 40` tokens |

### Platform-specific probes (run BEFORE full fetch)

**GitHub PR**
```bash
gh pr view <n> --json additions,deletions,changedFiles,files
gh pr diff <n> --stat   # if available
```
- Estimate: `(additions + deletions) × 15` tokens
- +500 per changed file (path + hunk headers)
- If `changedFiles > 20` or diff stat `> 2000` lines → treat as **large**

**Jira / issue board**
- Per issue in scope: ~400 tokens (fields + description + last 5 comments)
- Board/export CSV: `file_bytes ÷ 4`
- Sprint with >30 issues → **large**

**Log files**
```bash
wc -c <file>    # bytes
wc -l <file>    # lines
```
- `< 50 KB` → small (~12k tokens max)
- `50 KB – 500 KB` → medium
- `> 500 KB` or `> 10k lines` → **large**
- For huge logs: recommend **tail/grep first** on any model; still gate if user wants full-file summarize

**Database dumps / CSV / JSON exports**
```bash
wc -c <file>
```
- `< 100 KB` → small
- `100 KB – 1 MB` → medium
- `> 1 MB` → **large**

### Thresholds

| Band | Estimated ingest tokens | Action on Opus |
|------|-------------------------|----------------|
| **small** | < 30k | Proceed on Opus |
| **medium** | 30k – 80k | Gate if task is straightforward |
| **large** | > 80k | **Must gate** if task is straightforward |

When uncertain, round **up** one band.

### Scoped ingest (mandatory before full fetch)

If probes imply **medium/large** context or a **large** file/PR/board:

1. **STOP** — do not load the full dump, full log, or full PR diff into the model.
2. Follow `scoped_ingest_plan` / `contextOptimization.plan` from the gate (or `docs/CONTEXT_OPTIMIZATION.md`).
3. Prefer **grep**, **tail**, **JQL**, **per-file PR diffs**, and **schema samples** first.
4. When recommending a switch, cite **effective** token/cost fields (`estimated_effective_input_tokens`, `estimated_*_if_scoped_usd`) when present.

## Step 2 — Classify the task

### Straightforward → switch candidate (Sonnet or Haiku)

The user's **primary deliverable** is one of:

- Summarize / TL;DR / executive summary
- Format, restructure, or convert (markdown, table, JSON, report template)
- Review diffs / list findings / extract bugs / triage / classify / tag
- Extract fields (owners, dates, severity, file list, action items)
- Compare versions / highlight regressions (descriptive, not redesign)
- Answer factual questions **answerable from the provided context**

**Signals:** verbs like summarize, review, extract, list, format, triage, categorize, "what changed", "find bugs", "any blockers".

### Complex → stay on Opus (do NOT switch)

- Architecture or API design, migration planning, multi-service reasoning
- Root-cause debugging across unfamiliar code with no clear hypothesis
- Writing or refactoring non-trivial code (new features, algorithms, tests)
- Security audit requiring exploit reasoning
- Ambiguous requirements needing clarification strategy
- Multi-step agentic work (implement + test + iterate)

**Rule:** If the task mixes straightforward + complex, classify as **complex**.

## Step 3 — Pick target model

| Task shape | Target | Rationale |
|------------|--------|-----------|
| Summarize, format, extract, triage, classify | **haiku** | Pattern-matching over bulk text |
| Diff review with nuanced judgment, cross-file bug hunt | **sonnet** | Needs solid reasoning, not max depth |
| Medium context + straightforward but user asked for "thorough" | **sonnet** | Quality bump without Opus cost |

Never recommend Opus as a switch target.

## Step 4 — Execute the gate (MANDATORY on match)

When **all** are true:
1. Current model is **opus**
2. Context band is **medium** or **large** (large always gates for straightforward)
3. Task class is **straightforward**

**STOP.** Do not fetch full context or begin the task on Opus.

### Primary path — call `suggest_model_switch`

Call the tool with structured rationale. Set `switch_direction` to `downgrade`
or `upgrade`. Schema: `schemas/suggest_model_switch.json`.
Include cost fields when available (`estimated_cost_*`, `savings_percent`) or run
`npm run gate -- --json` with probes — see `docs/COST_MODEL.md`.
When prompting the user, state **estimated turn cost** and **% savings** (not
invoice amounts). Example: "Switch to Sonnet — estimated turn cost ~$0.45 → ~$0.09 (~80% lower)."
The host shows a confirmation UI or auto-switches per user preference.

### Fallback — `AskUserQuestion`

If `suggest_model_switch` is unavailable:

```
This task looks like [summary] over ~[N]k tokens of [source].
Opus is likely overkill. Switch to [haiku|sonnet] and continue?

Options: Switch and continue | Stay on Opus | Cancel
```

### After user approves switch

Re-run context probes on the new model, then proceed. Prefer scoped ingestion:
- PRs: file filter, `--name-only`, or per-file diffs
- Logs: `grep`/`tail` then expand
- Jira: JQL filter to relevant issues only

### When NOT to gate

- User explicitly chose Opus for this task in the last 2 turns
- Task is **complex**
- Context is **small**
- User said "stay on opus" / "no model switch"

Log internally (in your reply, one line max):
`cost-gate: skipped | switched→sonnet | stayed-opus (complex)` — no essays.

## Examples

| User request | Context | Class | Action |
|--------------|---------|-------|--------|
| "Summarize this 2MB CI log" | large | straightforward | → haiku |
| "Review PR #482 diff, list bugs" | 1.2k lines changed | straightforward | → sonnet |
| "Design auth migration from this dump" | large | complex | stay opus |
| "Extract all P0 Jira tickets this sprint" | 45 issues | straightforward | → haiku |
| "Fix the race condition in PR #12" | medium | complex | stay opus (or upgrade if on haiku) |
| "Implement Backstage plugin with tests" on haiku | small | complex | **upgrade→sonnet** |
| "Design auth migration" on haiku | any | complex | **upgrade→opus** |
| "Summarize log" on sonnet | large | straightforward | proceed (already cheap) |
