# Update Thought MCP

> Standalone MCP Edge Function that adds an `update_thought` tool with optional `if_unchanged_since` optimistic concurrency for multi-writer setups.

## What It Does

The core Open Brain MCP server captures, searches, lists, and summarises thoughts but does not expose an update path. This integration adds a single new tool, `update_thought`, deployable as a separate Supabase Edge Function and registered as its own custom connector alongside your main Open Brain connector.

The tool supports three arguments:

- `content` — when provided, overwrites the thought's text and regenerates its embedding via OpenRouter.
- `metadata_patch` — shallow-merged into the existing `metadata` JSONB. Keys not present in the patch are left alone.
- `if_unchanged_since` — optional ISO 8601 timestamp. When supplied, the update is rejected with `STALE_READ` if the stored `updated_at` has advanced past that reference. Omit for last-write-wins behaviour (backward compatible).

Why it matters: once more than one agent writes to the same Open Brain (Claude Desktop, Codex, a background worker, etc.), last-write-wins silently drops concurrent edits. Optimistic concurrency is the cheapest fix — pass the `updated_at` you read, and the server rejects the write if something changed in between.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Supabase CLI installed (`npm i -g supabase` or your preferred method)
- [Deno](https://deno.land/) runtime available locally for type-checking (optional but recommended)
- OpenRouter API key (only required when your callers pass `content` — needed for re-embedding)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
UPDATE THOUGHT MCP -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:              ____________
  Service role key:         ____________
  OpenRouter API key:       ____________
  MCP access key:           ____________

GENERATED DURING SETUP
  Update Thought URL:       https://<project>.supabase.co/functions/v1/update-thought-mcp
  Custom connector name:    Open Brain — Update

--------------------------------------
```

## Steps

### 1. Create the Edge Function in your project

From the root of your local Open Brain repo (the one you set up during getting-started):

**1. Create the function folder:**

```bash
supabase functions new update-thought-mcp
```

**2. Copy the integration code:**

```bash
curl -o supabase/functions/update-thought-mcp/index.ts \
  https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/integrations/update-thought-mcp/index.ts
curl -o supabase/functions/update-thought-mcp/deno.json \
  https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/integrations/update-thought-mcp/deno.json
```

### 2. Set environment variables

Reuse the same secrets as the core Open Brain server:

```bash
supabase secrets set \
  OPENROUTER_API_KEY="your-openrouter-key" \
  MCP_ACCESS_KEY="your-mcp-access-key"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the platform.

### 3. Deploy

```bash
supabase functions deploy update-thought-mcp --no-verify-jwt
```

### 4. Register the connector in Claude Desktop

Open **Settings → Connectors → Add custom connector** and paste:

```
https://<project>.supabase.co/functions/v1/update-thought-mcp?key=<MCP_ACCESS_KEY>
```

Name it something distinct from your main Open Brain connector (e.g. `Open Brain — Update`) so the tool shows up clearly in your tool list.

### 5. Verify

Ask Claude: `Call the update_thought tool with id = "<uuid-from-your-db>" and metadata_patch = {"reviewed": true}.` You should see a success message and the thought's `updated_at` timestamp advance.

To verify optimistic concurrency:

1. Read a thought and note its `updated_at` (call it T0).
2. Call `update_thought` with `if_unchanged_since = T0` — it succeeds. `updated_at` is now T1.
3. Call `update_thought` again with `if_unchanged_since = T0` — it is rejected with `STALE_READ`.

## Expected Outcome

- A new Edge Function at `https://<project>.supabase.co/functions/v1/update-thought-mcp`.
- A custom connector registered in your AI client that exposes exactly one tool, `update_thought`.
- Updating an existing thought replaces its content, re-embeds it, or merges a metadata patch.
- When `if_unchanged_since` is passed, the server rejects writes that would overwrite a concurrent change with a `STALE_READ` error, giving the caller a clear signal to re-fetch and retry.

The [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) covers how to manage your tool surface area once you add this (and any other) custom connector.

## Troubleshooting

**Issue: Tool call returns `401 Invalid or missing access key`**
Solution: Make sure the `?key=` parameter in your connector URL matches the `MCP_ACCESS_KEY` secret you set with `supabase secrets set`. If you rotate the key, re-deploy the function and update the connector URL.

**Issue: `OPENROUTER_API_KEY is not set on this Edge Function; content updates cannot re-embed.`**
Solution: This appears only when a caller passes `content`. Set the secret (`supabase secrets set OPENROUTER_API_KEY=...`) and re-deploy. Updates that only pass `metadata_patch` work without an embedding provider.

**Issue: Updates always succeed even though I expected `STALE_READ`**
Solution: `if_unchanged_since` is optional. Confirm you are actually passing it, and that the timestamp you read was the thought's `updated_at` (not `created_at`). The default `update_updated_at` trigger from the getting-started guide keeps `updated_at` current on every write.

## Attribution

Adapted from a multi-participant capture design used across live Claude / ChatGPT / Codex sessions. Released here as a standalone integration so any Open Brain user can opt in without touching the core server.
