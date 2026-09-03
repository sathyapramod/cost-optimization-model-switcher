# Provider-agnostic model catalog

The gate does **not** hardcode Opus/Sonnet/Haiku or GPT model names. It resolves any model ID to:

| Concept | Values | Meaning |
|---------|--------|---------|
| **Provider** | `anthropic`, `openai`, `cursor` | Who serves the model |
| **Capability tier** | `premium`, `balanced`, `fast` | Relative reasoning cost/capability |

Gate rules are expressed only in tiers:

- **Downgrade:** `premium` + large straightforward context → `balanced` or `fast`
- **Upgrade:** `fast`/`balanced` + complex task → `premium`

The host maps tiers back to concrete model IDs using `catalogs/default.json`.

## Built-in catalog

`catalogs/default.json` ships with common models:

| Provider | Premium | Balanced | Fast |
|----------|---------|----------|------|
| Anthropic | claude-opus-4-6 | claude-sonnet-4-6 | claude-haiku-4-5 |
| OpenAI | o3 | gpt-4o | gpt-4o-mini |
| Cursor | claude-opus-4-6 | claude-sonnet-4-6 | gpt-4o-mini |

Matching uses substring rules in `entries[]` (longest/highest-priority wins).

## Custom catalog

Pass a partial catalog to `evaluateGate`:

```typescript
import { evaluateGate, loadDefaultCatalog, mergeCatalog } from "cost-optimization-model-switcher";

const catalog = mergeCatalog(loadDefaultCatalog(), {
  defaults: {
    cursor: {
      premium: "composer-2.5",
      balanced: "composer-2",
      fast: "cursor-small",
    },
  },
  entries: [
    { match: "my-custom-model", provider: "cursor", tier: "balanced", priority: 200 },
  ],
});

evaluateGate({
  currentModel: "my-custom-model",
  provider: "cursor",
  userMessage: "Summarize this log",
  catalog,
  probes: [{ source: "log_file", bytes: 1_000_000 }],
});
```

## Cursor integration

Cursor can route to Anthropic or OpenAI models. Pass `provider: "cursor"` when the model ID is ambiguous (e.g. shared `gpt-4o-mini` slug):

```typescript
evaluateGate({
  currentModel: "gpt-4o-mini",
  provider: "cursor",
  userMessage: "...",
});
```

Cursor hosts should inject `current_model` and `provider` from the IDE session into the skill context.

## OpenAI integration

Works with ChatGPT, API, or Cursor-wrapped OpenAI models:

```bash
npm run gate -- --model o3 --provider openai \
  --probe log_file:2000000 \
  "Summarize this CI log"
```

## Adding new models

1. Add an `entries` row with `match`, `provider`, `tier`, and `priority`.
2. Update `defaults[provider]` if the tier default should change.
3. Run `npm test`.

Unknown models skip the gate (`cost-gate: skipped (unknown model; add to catalog)`).

## Tool schema fields

Prefer these generic fields in `suggest_model_switch`:

- `provider`
- `current_capability_tier`
- `recommended_capability_tier`
- `recommended_model_id`

`recommended_model` (`opus`/`sonnet`/`haiku`) remains for Anthropic backward compatibility.
