# Delete Thought MCP

> Standalone MCP Edge Function that adds a `delete_thought` tool — hard-deletes a thought by UUID with a pre-flight fetch and a clear confirmation response.

## What It Does

The core Open Brain MCP server exposes capture/search/list/stats tools but has no delete path. As a result, thoughts accumulate forever — there is no way for an AI client to remove a test entry, a duplicate, or something captured in error without dropping into the Supabase SQL editor.

This integration deploys a second Edge Function that exposes exactly one tool, `delete_thought(id)`. It is a hard delete (the row is removed), with a pre-flight existence check so the caller sees a distinct "not found" outcome rather than a silent success.

**Recovery:** this is a hard delete, not a soft delete. Recovery depends on your Supabase project's database backups (daily backups are available on paid tiers; Point-in-Time Recovery on higher tiers). If you need recoverable deletes, install the companion `schemas/thought-audit` schema and extend this function to write an audit row with the prior content before the delete — see the "Audit hook" section below.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Supabase CLI installed

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
DELETE THOUGHT MCP -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:              ____________
  Service role key:         ____________
  MCP access key:           ____________

GENERATED DURING SETUP
  Delete Thought URL:       https://<project>.supabase.co/functions/v1/delete-thought-mcp
  Custom connector name:    Open Brain — Delete

--------------------------------------
```

## Steps

### 1. Create the Edge Function

From the root of your local Open Brain repo:

**1. Create the function folder:**

```bash
supabase functions new delete-thought-mcp
```

**2. Copy the integration code:**

```bash
curl -o supabase/functions/delete-thought-mcp/index.ts \
  https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/integrations/delete-thought-mcp/index.ts
curl -o supabase/functions/delete-thought-mcp/deno.json \
  https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/integrations/delete-thought-mcp/deno.json
```

### 2. Set environment variables

```bash
supabase secrets set MCP_ACCESS_KEY="your-mcp-access-key"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the Supabase platform.

### 3. Deploy

```bash
supabase functions deploy delete-thought-mcp --no-verify-jwt
```

### 4. Register the connector

In Claude Desktop: **Settings → Connectors → Add custom connector**, paste:

```
https://<project>.supabase.co/functions/v1/delete-thought-mcp?key=<MCP_ACCESS_KEY>
```

Use a distinct connector name (e.g. `Open Brain — Delete`) so the tool is easy to spot in your tool list.

### 5. Verify

Ask Claude: `Call the delete_thought tool with id = "<some-uuid>".`

- For a real UUID: you should see `Deleted thought <id> (prior content length: N chars).`
- For a bogus UUID: `Thought not found: <id>` with `isError: true`.

Double-check the row is gone in the Supabase Table Editor.

## Expected Outcome

- A new Edge Function at `https://<project>.supabase.co/functions/v1/delete-thought-mcp`.
- A custom connector in your AI client that exposes exactly one tool, `delete_thought`.
- Invoking the tool with a valid UUID removes that row from the `thoughts` table and returns a confirmation.
- Invoking with a non-existent UUID returns a clear `Thought not found: <id>` error.

The [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) explains how to manage your tool surface area as you add this and other custom connectors.

## Audit Hook (optional)

If you also install `schemas/thought-audit`, extend this function to write an audit row before the delete so the prior `content`, `metadata`, and `created_at` are preserved in `thought_audit` for recovery or historical audit queries. A minimal sketch:

```ts
// Before the delete call:
await supabase.from("thought_audit").insert({
  thought_id: id,
  action: "delete",
  diff: {
    previous_content: existing.content,
    previous_metadata: existing.metadata ?? null,
  },
  actor_context: { origin: "mcp:delete_thought" },
});
```

Left out of the base integration to keep its dependencies to a single table.

## Troubleshooting

**Issue: Tool call returns `401 Invalid or missing access key`**
Solution: Confirm the `?key=` in your custom connector URL matches the `MCP_ACCESS_KEY` secret set on the Edge Function. If you rotate the key, re-deploy and update the connector URL.

**Issue: `delete_thought error: permission denied for table thoughts`**
Solution: Ensure your service role has DELETE permission on `public.thoughts`. The getting-started guide grants this in Step 2.5 — re-run `grant select, insert, update, delete on table public.thoughts to service_role;` in the SQL editor if it was missed.

**Issue: Tool succeeds but the row is still visible in the Table Editor**
Solution: The Table Editor caches results. Reload the page, or run `select id from thoughts where id = '<uuid>'` directly in the SQL Editor to confirm the row is gone.

## Attribution

Adapted from a multi-participant capture design used across live Claude / ChatGPT / Codex sessions. Released as a standalone integration so any Open Brain user can opt in without modifying the core server.
