# Synthesis Capture

> Let your AI save its own synthesis of multiple thoughts as a new thought — the "Query-as-Ingest" pattern. Your brain compounds instead of re-deriving.

## What It Does

Adds two entry points for capturing a synthesis with provenance:

- `capture_synthesis` — MCP tool your AI client can call
- `POST /synthesis` — REST endpoint for scripts, webhooks, and non-MCP clients

When your AI answers a complex question by combining multiple atomic thoughts, this recipe lets it save the answer itself as a new thought whose `derived_from` column points back to every source. Next time you ask a similar question, the synthesis is already there — fewer tokens burned, fewer roundtrips, and a clear audit trail from belief to evidence. This is what Andrej Karpathy calls "Query-as-Ingest": queries stop being read-only and start compounding the brain.

## Prerequisites

- Working Open Brain setup ([Getting Started guide](../../docs/01-getting-started.md))
- **The `provenance-chains` sibling recipe applied (recommended)** — this recipe depends on two things that ship together in that recipe:
  1. Three new columns on `public.thoughts`: `derivation_layer`, `derivation_method`, `derived_from`.
  2. An updated `upsert_thought` RPC that reads those three fields from the top level of `p_payload` (not just from `p_payload.metadata`).

  **On the stock RPC (no `provenance-chains` yet):** inserts still succeed and provenance is preserved in `metadata.provenance.{source_type,derivation_layer,derivation_method,derived_from}` as a mirrored fallback. The top-level provenance columns populated by the patched RPC will be empty, but you can reconstruct the chain from metadata. The anti-loop safety guard (synthesis-of-synthesis rejection) reads the top-level column and is therefore best-effort on stock RPC — see [`DEPENDENCIES.md`](./DEPENDENCIES.md) for the full matrix.

  See [Step 1](#step-1-confirm-the-provenance-columns-exist) for a quick verification query and [Known Limitations](#known-limitations) for the broader dependency graph.
- An `open-brain-mcp` Edge Function deployed from [server/index.ts](../../server/index.ts) — this recipe adds a second tool alongside `capture_thought`.
- An `open-brain-rest` Edge Function deployed (for the REST half). If you only want the MCP tool, skip `rest-endpoint.ts`.
- Supabase CLI linked to your project (for redeploying after you add the handler code).

> [!IMPORTANT]
> This recipe **only persists** a synthesis — it does not generate one. The caller (your AI client, your script) must produce the synthesis prose and pass it in. Keeping the LLM off the hot path keeps the capture path cheap, deterministic, and free of server-side API keys.

> [!NOTE]
> **UUID vs BIGINT IDs.** The stock OB1 schema in the Getting Started guide uses `UUID` primary keys on `public.thoughts`. Some enhanced variants use `BIGINT`. Both handlers in this recipe accept either — source IDs are treated as opaque values and only compared by equality. If your install uses UUIDs, pass them as JSON strings (`"11111111-..."`), not numbers.

## What's In This Folder

| File | Purpose |
|------|---------|
| `mcp-tool-handler.ts` | `capture_synthesis` tool. Paste into your `open-brain-mcp` Edge Function. |
| `rest-endpoint.ts` | `POST /synthesis` handler. Paste into your `open-brain-rest` Edge Function. |
| `metadata.json` | OB1 contribution metadata. |
| `README.md` | This file. |

## Safety Rules

These are enforced identically in both the MCP tool and the REST endpoint. They exist to prevent the brain from compounding its own noise.

| Rule | Why it exists |
|------|---------------|
| **At least 3 source thought IDs** | A "synthesis" of one or two thoughts is usually just a rewrite. Three is the smallest number where combining them genuinely produces new knowledge. |
| **All source IDs must exist in `public.thoughts`** | Silent dangling references poison provenance walks. We fail loud instead. |
| **No source may have `source_type = 'synthesis'`** | Forbids synthesis-of-synthesis. Otherwise the system could recursively compound its own derivations and drift arbitrarily far from real evidence. |
| **At least one source must have `derivation_layer = 'primary'`** | Guarantees every synthesis chain is ultimately rooted in an atomic, captured-from-reality thought — not just a pile of other derivations. |

If any rule fails, the insert is rejected with a 400-class error. Nothing is written.

---

## Setup

### Step 1: Confirm the provenance columns exist

Run this in your Supabase SQL editor:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'thoughts'
  and column_name in ('derivation_layer', 'derivation_method', 'derived_from')
order by column_name;
```

You should see three rows:

| column_name | data_type |
|-------------|-----------|
| `derivation_layer` | `text` |
| `derivation_method` | `text` |
| `derived_from` | `jsonb` |

If any are missing, stop here and apply the `provenance-chains` recipe's migration first.

Done when: All three columns appear in the result.

---

### Step 2: Add the MCP tool handler

Open your local copy of `server/index.ts` (the file you deployed as `open-brain-mcp`). Find the `capture_thought` `registerTool` call. Paste the entire contents of `mcp-tool-handler.ts` directly after it — the block is a single `server.registerTool(...)` call and needs the same scope (`server`, `supabase`, `z`, `getEmbedding`, `extractMetadata` already in scope from OB1's default `server/index.ts`).

Done when: Your `server/index.ts` has both `capture_thought` and `capture_synthesis` tools registered, and `deno check server/index.ts` (or your normal type check) passes.

---

### Step 3: Add the REST endpoint (optional, only if you run `open-brain-rest`)

Open your `open-brain-rest` function. Paste the contents of `rest-endpoint.ts` at the bottom of the file (it exports `handleCaptureSynthesis`). Then wire the route into your router:

**For a `Deno.serve` / `URL`-based router:**

```ts
if (path === "/synthesis" && req.method === "POST") {
  return await handleCaptureSynthesis(req);
}
```

**For a Hono-based router:**

```ts
app.post("/synthesis", (c) => handleCaptureSynthesis(c.req.raw));
```

Done when: Sending `OPTIONS /synthesis` returns a CORS-allowed response and `POST /synthesis` with an empty body returns `{"error": "Invalid JSON in request body"}` (proves the route is wired but validation still works).

---

### Step 4: Redeploy

```bash
supabase functions deploy open-brain-mcp
supabase functions deploy open-brain-rest   # only if you added the REST endpoint
```

Done when: Both deploys report success and the function log shows no startup errors.

---

## Usage

### Example 1: MCP call from Claude Desktop

Ask Claude (in a conversation connected to your Open Brain MCP server):

> "Search my brain for my thoughts on Postgres pgvector performance. Summarize the key takeaways, then capture your summary as a synthesis with provenance back to the source IDs."

Claude will (a) call `search_thoughts`, (b) compose the synthesis, (c) call `capture_synthesis` with the source IDs it used. You should see something like:

```
Captured synthesis #40221 from 5 source thoughts. Future queries on this topic can reuse it directly.
```

### Example 2: REST call via curl

```bash
curl -X POST https://<your-project>.supabase.co/functions/v1/open-brain-rest/synthesis \
  -H "Content-Type: application/json" \
  -H "x-brain-key: $OB1_BRAIN_KEY" \
  -d '{
    "content": "pgvector HNSW index builds are slow the first time but consistently outperform IVFFlat for recall@10 on embedding tables >1M rows.",
    "source_thought_ids": [12033, 14288, 15901, 17442],
    "question": "Is HNSW worth the build cost vs IVFFlat?",
    "topics": ["pgvector", "vector-search", "postgres"]
  }'
```

> [!TIP]
> If your install uses UUID IDs (the stock Getting Started schema), pass them as quoted strings instead: `"source_thought_ids": ["b5a...","9f1...","e77..."]`.

Expected response:

```json
{
  "thought_id": 40221,
  "source_count": 4,
  "message": "Captured synthesis #40221 from 4 source thoughts"
}
```

Replay the curl with the same content and source IDs and you'll get the same `thought_id` back — `upsert_thought` de-duplicates by content fingerprint, so syntheses are idempotent.

---

## How to Verify It's Working

Run this after capturing your first synthesis:

```sql
select id, source_type, derivation_layer, derivation_method, derived_from, left(content, 80) as preview
from public.thoughts
where derivation_method = 'synthesis'
order by id desc
limit 5;
```

You should see your new synthesis with `derivation_layer = 'derived'`, `derivation_method = 'synthesis'`, and `derived_from` populated with the source IDs you passed in.

To walk the provenance chain, use the `trace_provenance` MCP tool or `GET /thought/:id/provenance` endpoint from the `provenance-chains` recipe.

## Troubleshooting

### `column "derivation_layer" of relation "thoughts" does not exist`

The `provenance-chains` migration hasn't been applied to this database. Apply it before using this recipe. Re-run the verification query in Step 1 until all three columns are present.

### `Error: source_thought_ids must include at least 3 distinct IDs`

The caller passed fewer than 3 unique IDs. Duplicates are collapsed before the count check, so passing `[101, 101, 102]` reads as 2 distinct IDs and fails. Pass at least 3 genuinely different source thoughts.

### `Error: all source thoughts are derived; at least one must be a primary (atomic) thought`

Every ID you passed points to a row whose `derivation_layer = 'derived'`. That is intentionally blocked to stop recursive synthesis chains. Either include at least one primary thought in the source set, or reconsider whether the inputs you have are really strong enough for a synthesis.

### `Error: source thoughts [...] are themselves syntheses`

One or more source IDs already have `source_type = 'synthesis'`. Anti-loop rule: syntheses can only be built from non-synthesis thoughts. Trace those synthesis IDs back to their own `derived_from` and include the underlying primary thoughts instead.

### `Error: upsert_thought returned no thought ID`

Your `upsert_thought` RPC is returning an unexpected shape. This recipe expects `{ id: <bigint> }` in the result. If you are on a forked RPC, adapt the `(upsertResult as { id?: number })` destructure at the bottom of both handlers to match what your RPC returns.

### MCP tool registered but Claude can't see it

After redeploying, disconnect and reconnect the Open Brain connector in Claude Desktop (Settings → Connectors → disable → re-enable). MCP tool lists are cached on the client side and a reconnect forces a fresh `tools/list` roundtrip.

---

## Known Limitations

See [`DEPENDENCIES.md`](./DEPENDENCIES.md) for full detail. Summary:

1. **Stock `upsert_thought` RPC drops top-level provenance fields.** Until the sibling `provenance-chains` recipe lands with its patched RPC, this recipe mirrors provenance into `metadata.provenance.*` so the data is durable — but the top-level columns (`source_type`, `derivation_layer`, `derivation_method`, `derived_from`) will be unpopulated on stock installs. The anti-loop safety guard reads the top-level column and is therefore best-effort until `provenance-chains` lands.
2. **Stock `search_thoughts` / `list_thoughts` don't expose row IDs.** An AI client following the "search then synthesize" flow in Example 1 cannot read the required `source_thought_ids` from the standard tools — they only return formatted text. Workaround: pass IDs manually from a dashboard or SQL query, or deploy a variant read tool that returns structured JSON. A base update that exposes IDs is tracked as a follow-up; no timeline yet.
3. **Input caps.** `content` is capped at 50KB, `source_thought_ids` at 50 items, `question` at 2000 chars, `topics`/`tags` at 20 entries each. Adjust in both `mcp-tool-handler.ts` (Zod schema) and `rest-endpoint.ts` (imperative checks) together if your use case needs higher bounds.
4. **Embedding soft-fail.** If the embedding patch write fails after the row is saved, both MCP and REST paths return success with a warning message (`embedding_error`). The thought is durable — callers can retry via a `reembed_thought` helper rather than re-capturing.

Search the source files for `TODO(synthesis-capture):` to locate the exact lines where these limitations originate.
