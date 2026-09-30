# Task success criteria (Phase 4)

**Principle:** Complexity is not ground truth. **Task success is.**

**Back:** [Docs index](./README.md) · [TASK_ANALYZER.md](./TASK_ANALYZER.md)

Success criteria live on the **task contract** (`TaskContract.successSpecification`). They are **not** embedded in the router — routing uses requirements; evaluation (future) uses success specs.

## Data

| Artifact | Role |
|----------|------|
| `catalogs/success-criteria.json` | Versioned, task-type criterion definitions |
| `src/success-criteria.ts` | Load catalog, build spec, serialize/parse |

## Criterion shape

```typescript
interface SuccessCriterion {
  id: string;
  description: string;
  type: "deterministic" | "structured" | "rubric" | "llm_judge" | "human";
  required: boolean;
  spec?: Record<string, unknown>; // e.g. future compile/test runner id
}
```

| `type` | Intended evaluator (Phase 4+) |
|--------|-------------------------------|
| `deterministic` | Scripts, compile/test, schema checks |
| `structured` | Required sections, fields, or checklist items |
| `rubric` | Scored human or rule-based rubric |
| `llm_judge` | Reserved — not implemented |
| `human` | User confirmation or clarification |

## Spec IDs

| `specId` | Typical `taskCategory` |
|----------|-------------------------|
| `summarization` | summarization |
| `code_generation` | crud_implementation, refactor |
| `code_review` | pr_review |
| `debugging` | debugging |
| `architecture` | architecture |
| `analytical` | other / framework-style prompts |
| `security` | security |
| `underspecified` | vague prompts (e.g. “Analyze this.”) |

## API

```typescript
import { analyzeTask } from "cost-optimization-model-switcher";

const analysis = analyzeTask({ userMessage: "Summarize this CI log", probes: [...] });
const spec = analysis.contract.successSpecification;
// spec.criteria — inspectable list
// analysis.contract.successCriteria — same array (compat mirror)
```

Serialization for CLI/UI:

```typescript
import {
  serializeSuccessSpecificationJson,
  parseSuccessSpecificationJson,
} from "cost-optimization-model-switcher";
```

## Tests

```bash
npm test -- --test-name-pattern=success criteria
```

## Related

- Evaluation runner (future) should consume `successSpecification`, not router internals.
- [ROUTING.md](./ROUTING.md) — capability matching vs success evaluation.
