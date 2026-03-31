# Reflection MCP Tools

> MCP tool handlers for capturing and searching structured reasoning traces.

## What It Does

Adds three MCP tool handlers to an Open Brain MCP server for working with the `reflections` table. These tools let AI agents capture deliberation processes and search past reasoning by semantic similarity.

## Prerequisites

- Working Open Brain MCP server
- **Reflections schema applied** — run `schemas/reflections/migration.sql` before using these tools
- OpenAI API key (or compatible embedding provider) for generating embeddings

## Tools

### 1. `capture_reflection`

Capture a new reasoning trace linked to a thought.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `thought_id` | `string` (uuid) | No | ID of the related thought |
| `trigger_context` | `string` | Yes | What prompted this reflection |
| `options` | `array` | No | Options or paths considered |
| `factors` | `array` | No | Factors, constraints, or trade-offs weighed |
| `conclusion` | `string` | Yes | The decision or insight reached |
| `confidence` | `number` | No | Confidence score from 0.0 to 1.0 |
| `reflection_type` | `string` | No | One of: `decision`, `analysis`, `evaluation`, `planning`, `retrospective` |
| `metadata` | `object` | No | Arbitrary structured metadata |

**Behavior:**
- Generates an embedding from the concatenation of `trigger_context` and `conclusion`.
- Calls `upsert_reflection` RPC to insert the row.
- Returns the new reflection ID.

### 2. `get_reflection`

Fetch a single reflection by its ID.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | `string` (uuid) | Yes | Reflection ID |

**Behavior:**
- Queries `public.reflections` by primary key.
- Returns the full reflection record including all fields and linked `thought_id`.

### 3. `search_reflections`

Semantic search over past reasoning traces.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | `string` | Yes | Natural language search query |
| `reflection_type` | `string` | No | Filter by type: `decision`, `analysis`, `evaluation`, `planning`, `retrospective` |
| `limit` | `number` | No | Max results (default: 8, max: 50) |
| `min_similarity` | `number` | No | Minimum cosine similarity threshold (default: 0.3) |

**Behavior:**
- Generates an embedding from the query string.
- Calls `match_reflections` RPC with the embedding and filters.
- Returns matching reflections ordered by similarity.

## Integration Pattern

These tool handlers are designed to be registered alongside the existing Open Brain MCP tools. Add them to your MCP server's tool list and route incoming tool calls to the appropriate handler.

```typescript
import { captureReflection, getReflection, searchReflections } from "./reflection-tools.ts";

// In your MCP server tool registration:
server.registerTool("capture_reflection", {
  // ... schema definition
}, async (params) => {
  return captureReflection(params, supabase, openaiApiKey);
});
```

Each handler:
1. Validates input parameters
2. Generates embeddings via your configured provider (for `capture_reflection` and `search_reflections`)
3. Calls the corresponding Supabase RPC or query
4. Returns structured JSON with `{ success, data?, error? }`

## When to Use Reflections

Reflections are most valuable when an agent or user faces a non-trivial choice. Good candidates:

- **Decisions** — "Should we use PostgreSQL or DynamoDB?" with trade-offs documented
- **Analyses** — Breaking down a complex problem into factors and evaluating each
- **Evaluations** — Assessing quality, risk, or fit of a candidate or approach
- **Planning** — Mapping out options for a future action and selecting an approach
- **Retrospectives** — Looking back at an outcome and recording what was learned

Reflections are not meant for routine captures. Use `capture_thought` for simple observations and facts; use `capture_reflection` when there is genuine deliberation worth preserving.

## Expected Outcome

After integrating these tools:

- `capture_reflection` creates reasoning traces that are semantically searchable
- `search_reflections` finds past reasoning by meaning, not just keywords
- `get_reflection` retrieves full deliberation detail for a specific reflection
- AI agents can recall why past decisions were made, improving consistency

## Troubleshooting

**Issue: `upsert_reflection failed: function public.upsert_reflection does not exist`**
Solution: The reflections schema has not been applied. Run `schemas/reflections/migration.sql` in your Supabase SQL Editor first.

**Issue: `Failed to generate query embedding`**
Solution: Check that your OpenAI API key (or compatible provider key) is configured and has available credits.

**Issue: `search_reflections` returns no results**
Solution: Reflections need embeddings to be searchable. Ensure `capture_reflection` successfully generates an embedding (requires a working embedding provider). Check the `embedding` column: `SELECT id, embedding IS NOT NULL AS has_embedding FROM reflections;`
