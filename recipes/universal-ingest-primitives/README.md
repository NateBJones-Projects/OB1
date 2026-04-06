# Universal Ingest Primitives

> Shared structured capture parsing and thought payload preparation for consistent ingestion across all capture paths.

## What It Is

A pair of reusable TypeScript functions that normalize raw user input into a consistent thought payload before writing to the database. Any code path that creates thoughts — MCP tools, REST endpoints, import scripts, smart-ingest — can use these to get consistent type resolution, metadata merging, and structured input parsing without duplicating logic.

## Why It Matters

When a second brain has multiple ingestion paths (MCP capture, REST API, document extraction, Telegram webhook), each path tends to develop its own inline heuristics for resolving thought type, importance, and metadata. Over time these diverge, producing inconsistent data quality. This recipe provides one shared contract so every path produces identically shaped payloads.

The structured capture parser adds a bonus: users can supply type and topic hints inline with their input using a simple bracket syntax, giving them control over classification without requiring a separate UI.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- TypeScript/Deno environment for using the helper functions

## How It Works

### Structured Capture Parser

Accepts an optional bracket syntax for inline type and topic hints:

```
[type] [topic] thought body + optional next step
[type] thought body + optional next step
```

Examples:
- `[decision] [architecture] Use PostgreSQL for the analytics service + Evaluate pgvector by Friday`
- `[lesson] Never run database migrations during peak traffic`
- `[idea] [devops] Automate staging deploys with a webhook`
- `Plain text without brackets passes through unchanged`

The parser recognizes all 8 Open Brain thought types plus common aliases (`ref` → `reference`, `person` → `person_note`, `event` → `meeting`).

### Prepare Thought Payload

Normalizes raw content + caller options into a `PreparedPayload` with consistent fields. Applies a strict override precedence:

1. **Structured capture hint** — parsed from content brackets
2. **Explicit caller override** — `opts.metadata.type`, `opts.metadata.importance`, etc.
3. **Extracted metadata** — from LLM classification (passed in, not computed)
4. **Defaults** — `type: 'idea'`, `importance: 3`, `quality_score: 50`

This is a **pure function** — no network calls, no provider env lookups, no embedded LLM classification. Callers supply precomputed values (embedding, fingerprint, extracted metadata) as optional inputs.

## Common Patterns

### Pattern 1: Simple Capture (No Classification)

```typescript
import { prepareThoughtPayload } from "./prepare-thought-payload.ts";

const payload = prepareThoughtPayload("Just had a great idea for the homepage redesign", {
  source: "mcp",
  source_type: "mcp_capture",
});
// payload.type === "idea" (default)
// payload.importance === 3 (default)
```

### Pattern 2: Structured Input with Hints

```typescript
const payload = prepareThoughtPayload(
  "[decision] [database] Use Supabase over Firebase for pgvector support",
  { source: "telegram" }
);
// payload.type === "decision" (from structured hint)
// payload.importance === 4 (elevated for structured captures)
// payload.metadata.topics === ["database"]
```

### Pattern 3: With LLM-Extracted Metadata

```typescript
const payload = prepareThoughtPayload("Met Sarah about the API redesign", {
  source: "smart_ingest",
  extracted: {
    type: "meeting",
    summary: "API redesign discussion with Sarah",
    topics: ["api-design"],
    people: ["Sarah"],
    confidence: 0.92,
  },
  embedding: myPrecomputedEmbedding,
  content_fingerprint: myPrecomputedFingerprint,
});
```

### Pattern 4: Caller Override Takes Precedence Over Extraction

```typescript
const payload = prepareThoughtPayload("Some content", {
  metadata: { type: "task", importance: 5 },  // caller says task
  extracted: { type: "reference" },            // LLM says reference
});
// payload.type === "task" (caller override wins over extracted)
// payload.importance === 5 (caller override wins over default)
```

## Step-by-Step Guide

1. Copy `parse-structured-capture.ts` and `prepare-thought-payload.ts` into your project's shared utilities folder.

2. Import and use in any ingestion path:

   ```typescript
   import { prepareThoughtPayload } from "./prepare-thought-payload.ts";
   ```

3. Before calling `upsert_thought`, prepare the payload:

   ```typescript
   const payload = prepareThoughtPayload(rawContent, {
     source: "my_source",
     embedding: await myEmbedFunction(rawContent),
     content_fingerprint: await myFingerprintFunction(rawContent),
   });
   ```

4. Pass the payload fields to your database write:

   ```typescript
   await supabase.rpc("upsert_thought", {
     p_content: payload.content,
     p_payload: {
       type: payload.type,
       importance: payload.importance,
       quality_score: payload.quality_score,
       source_type: payload.source_type,
       embedding: payload.embedding,
       metadata: payload.metadata,
       content_fingerprint: payload.content_fingerprint,
     },
   });
   ```

## Expected Outcome

After integrating these primitives:

- All ingest paths produce identically shaped payloads
- Users can supply inline type/topic hints via bracket syntax
- Type resolution follows a predictable, documented precedence order
- New ingest paths get consistent behavior by calling one function

Verify by capturing the same thought through two different paths and confirming identical `type`, `importance`, and `metadata.topics` values.

## Troubleshooting

**Issue: Structured capture not being parsed**
Solution: At minimum, the type bracket is required: `[type] content`. You can optionally add a topic bracket: `[type] [topic] content`. If neither format matches, the input is treated as plain text. Check that the type is one of the 8 canonical types or a recognized alias.

**Issue: Type resolves to "idea" when I expected something else**
Solution: Check the precedence order. If your caller override is empty and there's no structured hint, the default is "idea". Pass the type explicitly in `opts.metadata.type` or `opts.extracted.type`.

**Issue: Content fingerprint is empty in the payload**
Solution: This recipe does not compute fingerprints — it only includes them if you pass `opts.content_fingerprint`. Use the [Content Fingerprint Dedup](../../primitives/content-fingerprint-dedup/) primitive to compute fingerprints before calling `prepareThoughtPayload`.

## Works Well With

- Smart Ingest (see `integrations/smart-ingest` contribution) — uses `prepareThoughtPayload` to normalize extracted thoughts before writing
- Any MCP capture tool or REST endpoint that creates thoughts can adopt these helpers

## Further Reading

- [Content Fingerprint Dedup](../../primitives/content-fingerprint-dedup/) — companion primitive for deduplication
- Ingestion Jobs Schema (see `schemas/ingestion-jobs` contribution) — database schema for tracking extraction lifecycle
