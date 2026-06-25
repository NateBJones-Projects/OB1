# Wiki MCP

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@alanshurafa](https://github.com/alanshurafa)**

> Standalone MCP Edge Function that exposes the persistent-wiki tools — list pages, read a page with its sections, and write a section through the regen guard.

## What It Does

The core Open Brain MCP server captures and searches thoughts but knows nothing about wiki pages. This integration adds three tools as a separate Supabase Edge Function, registered as its own custom connector alongside your main Open Brain connector.

The wiki itself lives in the `schemas/wiki-pages` schema: durable, revision-tracked pages whose sections each carry an owner. A section written by a machine (`origin='generated'`) can be regenerated freely. Once a human edits or locks a section, later machine writes stop overwriting it — they park as a pending draft for a person to review. That rule (the "regen guard") lives in the `wiki_write_section` database function, so every writer obeys it, including this one.

The three tools:

- **`wiki_list_pages`** — list active wiki pages, most recently updated first, each with a section count. Optional `page_kind` filter and `limit` / `offset` paging. Read-only. Use it to discover what pages exist.
- **`wiki_get_page`** — fetch one page by `slug`, including every section's `body_md` and any `pending_generated_md` draft. Read-only. Use it to read a page and to get the `page_id` (a UUID) and section keys you need to write.
- **`wiki_write_section`** — write or refresh a section, identified by `page_id` and `section_key`. It always writes as `origin='generated'` (agents are generators; this cannot be overridden). The database returns an `action`, which this tool surfaces verbatim:
  - `action=created` — a new section was written.
  - `action=updated` — an existing machine-owned section was refreshed in place.
  - `action=pending` — the section is human-owned, so your text was parked as a pending draft for review. **Do not retry on `pending`** — the draft is already queued; a human accepts it separately.

Why it matters: it lets any AI client keep a persistent wiki fresh without ever shredding prose a human has taken ownership of. The machine proposes; a human accepts.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md)).
- The `schemas/wiki-pages` schema applied to your Open Brain database. This integration calls its tables (`wiki_pages`, `wiki_sections`) and its `wiki_write_section` RPC; without it the tools return errors. Apply that schema's `schema.sql` to your project first.
- Supabase CLI installed (`npm i -g supabase` or your preferred method).
- [Deno](https://deno.land/) available locally for type-checking (optional but recommended).

No embedding provider or OpenRouter key is needed — these tools only read and write wiki rows; they do not generate embeddings.

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
WIKI MCP -- CREDENTIAL TRACKER
------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:              ____________
  Service role key:         ____________
  MCP access key:           ____________

GENERATED DURING SETUP
  Wiki MCP URL:             https://<project>.supabase.co/functions/v1/wiki-mcp
  Custom connector name:    Open Brain — Wiki

------------------------------
```

## Steps

### 1. Apply the wiki-pages schema (if you have not already)

This integration depends on the `schemas/wiki-pages` schema. Apply its `schema.sql` to your Open Brain project (via the Supabase SQL editor or `supabase db` tooling) before deploying this function. The schema is idempotent and safe to re-run.

### 2. Create the Edge Function in your project

From the root of your local Open Brain repo (the one you set up during getting-started):

**1. Create the function folder:**

```bash
supabase functions new wiki-mcp
```

**2. Copy the integration code:**

```bash
curl -o supabase/functions/wiki-mcp/index.ts \
  https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/integrations/wiki-mcp/index.ts
curl -o supabase/functions/wiki-mcp/deno.json \
  https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/integrations/wiki-mcp/deno.json
```

### 3. Set environment variables

Reuse the same access key as the core Open Brain server:

```bash
supabase secrets set MCP_ACCESS_KEY="your-mcp-access-key"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the platform.

### 4. Deploy

```bash
supabase functions deploy wiki-mcp --no-verify-jwt
```

### 5. Register the connector in Claude Desktop

Open **Settings → Connectors → Add custom connector** and paste:

```
https://<project>.supabase.co/functions/v1/wiki-mcp?key=<MCP_ACCESS_KEY>
```

Name it something distinct from your main Open Brain connector (e.g. `Open Brain — Wiki`) so the wiki tools show up clearly in your tool list.

### 6. Verify

Ask Claude to run the tools in sequence:

1. `Call wiki_list_pages.` — you should see at least the `getting-started` seed page the schema creates.
2. `Call wiki_get_page with slug = "getting-started".` — note the `page_id` (a UUID) and the section keys.
3. `Call wiki_write_section with page_id = "<that-uuid>", section_key = "intro", body_md = "Updated intro."` — because `intro` is a generated section, you should get `action=updated`.

To see the regen guard park a draft:

1. Edit a section so it becomes human-owned (set its `origin` to `manual`, or `locked` to true, in the database).
2. Call `wiki_write_section` against that section again. The result is now `action=pending` and the live text is left untouched — the draft waits in `pending_generated_md` for a human to accept.

## Expected Outcome

- A new Edge Function at `https://<project>.supabase.co/functions/v1/wiki-mcp`.
- A custom connector registered in your AI client that exposes exactly three tools: `wiki_list_pages`, `wiki_get_page`, and `wiki_write_section`.
- Listing and reading pages returns wiki content with per-section ownership visible.
- Writing a machine-owned section refreshes it in place (`created` / `updated`); writing a human-owned section parks a pending draft (`pending`) without overwriting the live text, so the caller gets a clear "queued for review — do not retry" signal.

The [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) covers how to manage your tool surface area once you add this (and any other) custom connector.

## Troubleshooting

**Issue: Tool call returns an authentication error.**
Solution: Make sure the `?key=` parameter in your connector URL matches the `MCP_ACCESS_KEY` secret you set with `supabase secrets set`. If you rotate the key, re-deploy the function and update the connector URL.

**Issue: `wiki_list_pages` / `wiki_get_page` errors mentioning a missing relation or function.**
Solution: The `schemas/wiki-pages` schema is not applied to this project. Apply its `schema.sql` (Step 1), then retry.

**Issue: `wiki_write_section` keeps returning `action=pending`.**
Solution: This is by design. The target section is human-owned (`origin='manual'` or `locked`), so generated writes park as pending drafts rather than overwriting. Do not retry — a human accepts the draft (for example via the schema's `wiki_accept_pending` RPC), after which writes resume normally.

## Attribution

Ported from a multi-client persistent-wiki design so any Open Brain user can opt in to the wiki tools without touching the core server.

## More from Nate

Open Brain is built in the open by Nate B. Jones — more practical systems like this on his [Substack](https://substack.com/@natesnewsletter) and at [natebjones.com](https://natebjones.com).
