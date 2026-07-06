# CRM MCP

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@alanshurafa](https://github.com/alanshurafa)**

> Standalone MCP Edge Function that exposes the CRM truth-layer tools — search and read contacts, see who needs attention, prepare a briefing, and add notes, tasks, interactions, and field edits. Agent writes propose; a human accepts.

## What It Does

The core Open Brain MCP server captures and searches thoughts but knows nothing about your contacts. This integration adds nine CRM tools as a separate Supabase Edge Function, registered as its own custom connector alongside your main Open Brain connector.

The CRM itself lives in two schemas: `schemas/crm-core` (the editable, human-owned contact record plus a field-proposal truth layer) and `schemas/crm-engagement` (notes, tasks, important dates, interactions, and a keep-in-touch queue). The distinctive piece is the truth layer: a human edits the canonical contact fields directly, but a machine never overwrites a human-set field. An agent write to a human-curated field is diverted into a *proposal* that a person accepts or rejects. That rule lives in the `crm_patch_contact_record` database function, so every writer obeys it — including this one.

### The nine tools

Read tools:

- **`crm_search_contacts`** — search the contact book by name, email, organization, job title, or location. Returns each contact's `contact_id` (a UUID) for use with the other tools. Restricted-tier contacts are excluded by default.
- **`crm_get_contact`** — fetch one contact's full profile by `contact_id`: the canonical record, contact methods, aliases, relationship items (notes / tasks / important dates), recent interactions, and a derived relationship-health summary.
- **`crm_next_actions`** — the keep-in-touch queue: contacts with overdue or due-soon tasks, upcoming important dates, or relationships that have gone quiet. Use it to decide who to reach out to next.
- **`crm_prepare_briefing`** — a concise relationship briefing for one contact before you reach out: who they are, health, open tasks, upcoming dates, recent interactions, and any keep-in-touch suggestion. Composed entirely from visible CRM data.

Write tools (see the propose note below):

- **`crm_add_note`** — attach a relationship note to a contact.
- **`crm_add_task`** — add a follow-up task or reminder. It feeds relationship health and the keep-in-touch queue.
- **`crm_log_interaction`** — log a real call, meeting, in-person, or message with one or more participants. Unknown or archived participants are skipped (reported back), not fatal.
- **`crm_resolve_proposal`** — accept or reject a pending field proposal. This is the human decision point of the truth layer.
- **`crm_set_field`** — patch scalar contact fields. Because the caller is a machine, it writes with `origin='extraction'`: a write over a human-set field is **diverted to a proposal**, not applied directly.

### Write tools propose; a human resolves

`crm_set_field` always patches as a machine (`origin='extraction'`). The database decides what happens to each field:

- `applied` — the field was empty or agent-owned, so the value was written in place.
- `proposed` — the field is human-curated (`origin='manual'`), so your value was queued as a proposal. **Do not retry on `proposed`** — the proposal is already waiting for a human to accept it (via `crm_resolve_proposal`).
- `conflicts` — the field is locked, so it was left untouched until a human unlocks it.

`crm_add_note`, `crm_add_task`, and `crm_log_interaction` write engagement rows (notes / tasks / interactions), not canonical identity fields, so they apply directly through their guarded RPCs. `crm_resolve_proposal` is the human accept/reject decision: accepting applies the proposed value and stamps it as human-blessed; rejecting discards it permanently.

Why it matters: any AI client can keep your relationship surface fresh — note what was said, schedule the follow-up, log the call — without ever silently rewriting the identity facts you curated. The machine proposes; a human accepts.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md)).
- The `schemas/crm-core` schema applied to your Open Brain database (editable contacts + field proposals; provides `crm_get_contact`, `crm_patch_contact_record`, `crm_resolve_field_proposal`, and friends). Apply its `schema.sql` first. Reference: `schemas/crm-core/schema.sql` in this repository.
- The `schemas/crm-engagement` schema applied as well (notes, tasks, important dates, interactions, keep-in-touch; provides `crm_add_contact_note`, `crm_add_contact_task`, `crm_log_interaction`, `crm_contact_relationship_items`, `crm_contact_relationship_health`, `crm_contact_interactions`, `crm_keep_in_touch_suggestions`). It depends on `crm-core`, so apply core first. Reference: `schemas/crm-engagement/schema.sql` in this repository.
- Supabase CLI installed (`npm i -g supabase` or your preferred method).
- [Deno](https://deno.land/) available locally for type-checking (optional but recommended).

Without both schemas applied, the tools return errors mentioning a missing relation or function.

No embedding provider or OpenRouter key is needed — these tools only read and write CRM rows; they do not generate embeddings.

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
CRM MCP -- CREDENTIAL TRACKER
-----------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:              ____________
  Service role key:         ____________
  MCP access key:           ____________

GENERATED DURING SETUP
  CRM MCP URL:              https://<project>.supabase.co/functions/v1/crm-mcp
  Custom connector name:    Open Brain — CRM

-----------------------------
```

## Steps

### 1. Apply the CRM schemas (if you have not already)

This integration depends on `schemas/crm-core` and `schemas/crm-engagement`. Apply `schemas/crm-core/schema.sql` first, then `schemas/crm-engagement/schema.sql`, to your Open Brain project (via the Supabase SQL editor or `supabase db` tooling) before deploying this function. Both schemas are idempotent and safe to re-run.

### 2. Create the Edge Function in your project

From the root of your local Open Brain repo (the one you set up during getting-started):

**1. Create the function folder:**

```bash
supabase functions new crm-mcp
```

**2. Copy the integration code:**

```bash
curl -o supabase/functions/crm-mcp/index.ts \
  https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/integrations/crm-mcp/index.ts
curl -o supabase/functions/crm-mcp/deno.json \
  https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/integrations/crm-mcp/deno.json
```

### 3. Set environment variables

Reuse the same access key as the core Open Brain server:

```bash
supabase secrets set MCP_ACCESS_KEY="your-mcp-access-key"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the platform.

### 4. Deploy

```bash
supabase functions deploy crm-mcp --no-verify-jwt
```

### 5. Register the connector in Claude Desktop

Open **Settings → Connectors → Add custom connector** and paste:

```
https://<project>.supabase.co/functions/v1/crm-mcp?key=<MCP_ACCESS_KEY>
```

Name it something distinct from your main Open Brain connector (e.g. `Open Brain — CRM`) so the CRM tools show up clearly in your tool list.

### 6. Verify

Create a test contact (fictional) in the Supabase SQL editor, then ask Claude to exercise the tools:

```sql
select public.crm_create_contact('Ada Lovelace', 'ada@example.com', 'Analytical Engines', 'Mathematician');
```

1. `Call crm_search_contacts with query = "Ada".` — you should see the contact and its `contact_id` (a UUID).
2. `Call crm_get_contact with that contact_id.` — note the record, methods, and health summary.
3. `Call crm_add_task with that contact_id, title = "Send follow-up note".` — the task appears in the contact's items.
4. `Call crm_next_actions.` — the new task surfaces as a keep-in-touch suggestion.

To see the truth layer divert a write to a proposal:

1. `Call crm_set_field with that contact_id, patch = { "job_title": "Countess of Lovelace" }.` — because `job_title` was set by a human (the SQL above), the response is `proposed=[job_title]`, not `applied`. The live field is unchanged.
2. Find the proposal id (`select id from public.crm_field_proposals where status = 'open';`), then `Call crm_resolve_proposal with that proposal_id and decision = "accept".` — now the field updates and is re-stamped as human-blessed.

## Expected Outcome

- A new Edge Function at `https://<project>.supabase.co/functions/v1/crm-mcp`.
- A custom connector registered in your AI client that exposes exactly nine tools: `crm_search_contacts`, `crm_get_contact`, `crm_next_actions`, `crm_prepare_briefing`, `crm_add_note`, `crm_add_task`, `crm_log_interaction`, `crm_resolve_proposal`, and `crm_set_field`.
- Reading contacts returns the record, relationship items, and a health summary.
- Adding notes, tasks, and interactions writes engagement rows immediately.
- `crm_set_field` against a human-curated field returns `proposed` (queued for review) instead of overwriting it; a human accepts or rejects it with `crm_resolve_proposal`.

The [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) covers how to manage your tool surface area once you add this (and any other) custom connector.

## Troubleshooting

**Issue: Tool call returns an authentication error.**
Solution: Make sure the `?key=` parameter in your connector URL matches the `MCP_ACCESS_KEY` secret you set with `supabase secrets set`. If you rotate the key, re-deploy the function and update the connector URL.

**Issue: A tool errors mentioning a missing relation or function (e.g. `crm_contacts` or `crm_keep_in_touch_suggestions`).**
Solution: One or both CRM schemas are not applied to this project. Apply `schemas/crm-core/schema.sql` then `schemas/crm-engagement/schema.sql` (Step 1), then retry.

**Issue: `crm_set_field` keeps returning `proposed` instead of applying.**
Solution: This is by design. The target field is human-curated (`origin='manual'`), so machine writes queue a proposal rather than overwriting. Do not retry — review the proposal and accept it with `crm_resolve_proposal` (or accept it in your dashboard), after which the field updates.

## Attribution

Ported from a multi-client CRM truth-layer design so any Open Brain user can opt in to the CRM tools without touching the core server.

## More from Nate

Open Brain is built in the open by Nate B. Jones — more practical systems like this on his [Substack](https://substack.com/@natesnewsletter) and at [natebjones.com](https://natebjones.com).
