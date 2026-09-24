# Integration example

Wire the gate into a host app, CI step, or custom agent. You need Node 20+, `npm install`, `npm run build`, and for HTTP examples `npm run proxy`.

**Related:** [README](../README.md) (CLI) · [PROVIDERS.md](../docs/PROVIDERS.md) (catalog) · [schemas/suggest_model_switch.json](../schemas/suggest_model_switch.json)

## 1. Gate before the model turn

```bash
curl -s http://127.0.0.1:8787/v1/gate \
  -H 'content-type: application/json' \
  -d '{
    "currentModel": "claude-opus-4-6",
    "userMessage": "Summarize this 2MB CI log",
    "probes": [{ "source": "log_file", "bytes": 2000000 }]
  }' | jq .
```

## 2. Handle tool call from Claude

When the model calls `suggest_model_switch`, forward the payload:

```bash
curl -s http://127.0.0.1:8787/v1/suggest_model_switch \
  -H 'content-type: application/json' \
  -d @examples/tool-call.json | jq .
```

Return the JSON body to the model as the tool result so it can continue on the cheaper tier.

## 3. Host responsibilities

- Inject `current_model` into session metadata when possible
- Block or pause Opus ingestion until switch is accepted or declined
- On `preserve_context: true`, carry user message + gate metadata into the new session
- Map `recommended_model_id` to your provider's model slug if defaults differ
