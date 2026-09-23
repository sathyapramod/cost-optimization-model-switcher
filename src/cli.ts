#!/usr/bin/env node
import { parseArgs } from "node:util";
import { evaluateGate } from "./gate.js";
import type { ContextProbe, ContextSource } from "./types.js";

function parseProbe(raw: string): ContextProbe {
  const [kind, ...rest] = raw.split(":");
  const value = rest.join(":");
  const source = kind as ContextSource;

  switch (source) {
    case "github_pr": {
      const [additions, deletions, changedFiles, ...refs] = value.split(",");
      return {
        source,
        additions: Number(additions),
        deletions: Number(deletions),
        changedFiles: Number(changedFiles),
        refs: refs.length ? refs : undefined,
      };
    }
    case "jira": {
      const count = Number(value);
      return { source, issueCount: Number.isFinite(count) ? count : 0 };
    }
    case "log_file":
    case "database_dump":
    case "csv_export":
    case "json_export":
    case "paste": {
      const [bytes, lines] = value.split(",");
      return {
        source,
        bytes: bytes ? Number(bytes) : undefined,
        lines: lines ? Number(lines) : undefined,
      };
    }
    default:
      return { source: "other", refs: value ? [value] : undefined };
  }
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: "string", default: "claude-opus-4-6" },
    provider: { type: "string" },
    probe: { type: "string", multiple: true },
    "opt-out": { type: "boolean", default: false },
    "chose-opus": { type: "boolean", default: false },
    "chose-cheap": { type: "boolean", default: false },
    "auto-switch": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`Usage: cost-gate [options] "user message"

Options:
  --model <id>         Current model (default: claude-opus-4-6)
  --probe <spec>       Repeatable context probe (see README)
  --opt-out            User disabled model switching
  --chose-opus         User explicitly chose Opus
  --auto-switch        Host auto-switch enabled
  --json               JSON output
  -h, --help           Show help

Probe formats:
  github_pr:<additions>,<deletions>,<changedFiles>[,ref...]
  jira:<issueCount>
  log_file:<bytes>[,<lines>]
  database_dump:<bytes>[,<lines>]
`);
  process.exit(0);
}

const message = positionals.join(" ").trim();
if (!message) {
  console.error("error: user message required");
  process.exit(1);
}

const probes = (values.probe ?? []).map(parseProbe);
const decision = evaluateGate({
  currentModel: values.model!,
  provider: values.provider as "anthropic" | "openai" | "cursor" | undefined,
  userMessage: message,
  probes,
  userOptedOut: values["opt-out"],
  userChoseOpus: values["chose-opus"],
  userChoseCheapModel: values["chose-cheap"],
  autoSwitchEnabled: values["auto-switch"],
});

function printContextWarnings(decision: ReturnType<typeof evaluateGate>) {
  const opt = decision.contextOptimization;
  if (!opt?.required) return;
  console.error(`context: scoped ingest required — ${opt.plan}`);
  if (opt.reductionPercent >= 15 && opt.rawInputTokens > 0) {
    console.error(
      `context: full ingest ~${Math.round(opt.rawInputTokens / 1000)}k tokens; ` +
        `after scope ~${Math.round(opt.effectiveInputTokens / 1000)}k (~${opt.reductionPercent}% reduction).`,
    );
  }
}

if (values.json) {
  console.log(JSON.stringify(decision, null, 2));
} else {
  printContextWarnings(decision);
  console.log(decision.reason);
  if (decision.suggestSwitch) {
    const sw = decision.suggestSwitch;
    console.log(`recommended: ${sw.recommended_model_id} (${sw.confidence} confidence)`);
    if (sw.estimated_cost_current_usd != null && sw.estimated_cost_recommended_usd != null) {
      console.log(
        `estimated turn cost: $${sw.estimated_cost_current_usd.toFixed(4)} → $${sw.estimated_cost_recommended_usd.toFixed(4)}` +
          (sw.savings_percent != null && sw.estimated_savings_usd! > 0
            ? ` (save ~${sw.savings_percent}%)`
            : ""),
      );
    }
    console.log(sw.rationale);
    if (sw.cost_pricing_note) console.log(`note: ${sw.cost_pricing_note}`);
  }
}

process.exit(decision.action === "suggest_switch" ? 2 : 0);
