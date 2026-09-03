---
name: cost-optimization-model-switcher
description: >
  Inspects tasks that pull large external context (GitHub PRs, Jira boards,
  log files, database dumps) and recommends switching off Opus to Sonnet or
  Haiku when the work is straightforward (summarize, format, review diffs,
  extract bugs, triage, classify). Use on every turn when external platform
  context is involved, when the user pastes or attaches large files, or when
  the user mentions cost, tokens, or model choice. Do NOT use for small
  inline snippets, single-file edits, or tasks that require deep multi-step
  reasoning, architecture design, or novel code generation.
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

You are a cost gatekeeper. Before ingesting large external context on an
expensive model, estimate whether a cheaper model can do the job. **Stop and
switch first; do not silently burn Opus tokens on bulk-ingest + simple output.**

Programmatic gate logic lives in this repo: `src/gate.ts` (`evaluateGate`).
Hosts register `schemas/suggest_model_switch.json` as a client tool.

## Persistence

ACTIVE EVERY TURN while this skill is loaded. Run the gate **before** fetching
full PR diffs, Jira exports, log tails, or DB dumps — use metadata/size probes
first. Off only when the user says "stay on opus", "no model switch", or
"disable cost optimizer".

## Step 0 — Detect current model

Read `current_model` from session metadata if the host injects it. Otherwise infer
from the user's last explicit model choice or system context. Normalize to one of:

| Tier | Aliases |
|------|---------|
| **opus** | `claude-opus-*`, `opus` |
| **sonnet** | `claude-sonnet-*`, `sonnet` |
| **haiku** | `claude-haiku-*`, `haiku` |

If not on **opus**, skip the gate — cheaper tiers are already selected.

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

Call the tool with structured rationale. Schema: `schemas/suggest_model_switch.json`.
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
| "Fix the race condition in PR #12" | medium | complex | stay opus |
