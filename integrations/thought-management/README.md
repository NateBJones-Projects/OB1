# Thought Management Tools

> Update and delete MCP tools for managing existing thoughts in Open Brain.

## Overview

The core MCP server provides `capture_thought` for writing and `search_thoughts` for reading, but there's no way for your AI client to edit or remove thoughts. This integration adds two tools:

- **`update_thought`** — Edit a thought's content and automatically re-embed and re-classify
- **`delete_thought`** — Remove a thought by ID

These are separate from the core server to keep the base install minimal. Add them when you need your AI to manage thoughts, not just capture them.

## Why You'd Want This

- Fix typos or inaccuracies in captured thoughts
- Reclassify thoughts after reviewing them ("this isn't an idea, it's a task")
- Remove thoughts that are no longer relevant, sensitive, or were captured in error
- Let your AI maintain your second brain over time, not just append to it

## Prerequisites

- Open Brain deployed with the core MCP server
- `OPENROUTER_API_KEY` set in Edge Function secrets
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` available

## Setup

### Option A: Add to existing MCP server

Add these two tool registrations to your `server/index.ts`, after the existing tools:

```typescript
// --- update_thought tool ---
mcpServer.tool(
  "update_thought",
  "Update an existing thought's content. Re-embeds and re-classifies automatically.",
  { id: z.string().uuid(), content: z.string() },
  async ({ id, content }) => {
    const [embedding, metadata] = await Promise.all([
      getEmbedding(content),
      extractMetadata(content),
    ]);
    const { data, error } = await supabase
      .from("thoughts")
      .update({
        content,
        embedding,
        metadata: { ...metadata, source: "mcp", updated: true },
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, content, metadata")
      .single();
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: `Updated thought ${data.id}` }] };
  }
);

// --- delete_thought tool ---
mcpServer.tool(
  "delete_thought",
  "Permanently delete a thought by ID.",
  { id: z.string().uuid() },
  async ({ id }) => {
    const { error } = await supabase
      .from("thoughts")
      .delete()
      .eq("id", id);
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: `Deleted thought ${id}` }] };
  }
);
```

### Option B: Deploy as separate Edge Function

See [`index.ts`](./index.ts) for the full standalone implementation.

## Deployment

1. Create the Edge Function:
   ```bash
   supabase functions new thought-management
   ```
2. Copy `index.ts` into `supabase/functions/thought-management/index.ts`
3. Deploy:
   ```bash
   supabase functions deploy thought-management --no-verify-jwt
   ```
4. Connect in Claude Desktop: Settings → Connectors → Add custom connector → paste your function URL

## Expected Outcome

After setup, your AI client can:
- Search for a thought, realize it's outdated, and update it in place
- Remove duplicate or irrelevant thoughts
- Reclassify thoughts (the update re-runs extractMetadata automatically)

> **Tool hygiene:** This integration adds MCP tools to your AI's context window. As you add more integrations, the total tool count grows. See the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) for strategies on managing your tool surface area.

## Troubleshooting

**Issue: "No rows updated" when updating**
The thought ID may not exist. Use `search_thoughts` first to find valid IDs.

**Issue: Concerned about accidental deletion**
Consider adding a soft-delete pattern (set a `deleted_at` timestamp instead of removing the row). The hard delete shown here is simpler but irreversible.
