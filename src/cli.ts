#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  buildDecisionTrace,
  formatDecisionTraceText,
  gateDecisionWithTrace,
} from "./decision-trace.js";
import {
  formatPricingAuditText,
  loadDefaultPricing,
  summarizePricingCatalogAudit,
} from "./cost.js";
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
  console.log(`cost-gate — analyze a task and recommend a cost-effective model (no API keys required)

Usage: cost-gate [options] "user message"

Commands (from repo root):
  npm run gate              Primary: local routing, cost estimates, model recommendation

Developer / maintainer commands (npm scripts):
  npm run evaluate:live     Live model evaluation against a real provider (API key required)
  npm run evaluate:task-quality   Offline criterion checks on fixture outputs
  npm run evaluate:held-out       Holdout split only (offline)

Options:
  --model <id>         Current model (default: claude-opus-4-6)
  --provider <id>      anthropic | openai | cursor (optional)
  --probe <spec>       Repeatable context probe (see README)
  --opt-out            User disabled model switching
  --chose-opus         User explicitly chose Opus
  --chose-cheap        User chose a cheaper model tier
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

const pricingCatalog = loadDefaultPricing();
const pricingCatalogAudit = summarizePricingCatalogAudit(pricingCatalog);

if (values.json) {
  console.log(
    JSON.stringify(
      { ...gateDecisionWithTrace(decision), pricingCatalogAudit },
      null,
      2,
    ),
  );
} else {
  printContextWarnings(decision);
  console.log(formatDecisionTraceText(buildDecisionTrace(decision)));
  if (decision.suggestSwitch?.cost_pricing_note) {
    console.log(`\nnote: ${decision.suggestSwitch.cost_pricing_note}`);
  }
  console.log(`\n${formatPricingAuditText(pricingCatalog)}`);
}

process.exit(decision.action === "suggest_switch" ? 2 : 0);
