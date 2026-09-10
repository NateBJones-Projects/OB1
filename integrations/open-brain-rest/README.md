# Open Brain REST Gateway

`open-brain-rest` is the Supabase Edge Function used by the Next.js dashboard for the non-Agent-Memory OB1 surfaces:

- Dashboard stats and recent thoughts
- Thoughts browse/detail/edit/delete
- Search
- Workflow kanban updates
- Duplicate review
- Audit review
- Add to Brain

Agent Memory stays in `integrations/agent-memory-api`. This gateway only handles the base `thoughts` operational surface.

## Prerequisites

- A working Open Brain Supabase project (see [`docs/01-getting-started.md`](../../docs/01-getting-started.md)).
- The Supabase CLI and Deno installed, for deploying the Edge Function.
- The schemas listed under [Required Database Shape](#required-database-shape) applied to that project.

## Setup

1. Set the function secrets listed under [Required Secrets](#required-secrets).
2. Apply the schemas listed under [Required Database Shape](#required-database-shape).
3. Deploy the function: `supabase functions deploy open-brain-rest`.
4. Point the dashboard's `NEXT_PUBLIC_API_URL` at the deployed function URL.
5. Run the [Smoke Test](#smoke-test) to confirm the endpoints respond.

## Expected outcome

After setup, the dashboard reaches every base-thoughts surface (stats, browse, search, workflow, duplicates, audit) plus the optional CRM contact/proposal routes through this gateway, and the smoke harness passes end to end. If you expose MCP tools alongside this gateway, review your tool surface with the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md).

## Required Secrets

Set these as Supabase function secrets:

| Secret | Use |
| --- | --- |
| `MCP_ACCESS_KEY` | Dashboard/API access key, sent as `x-brain-key` |
| `OPENROUTER_API_KEY` | Embeddings and metadata extraction |
| `SUPABASE_URL` | Provided automatically by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Provided automatically by Supabase |

## Required Database Shape

Apply the base OB1 schema plus:

- `schemas/enhanced-thoughts/schema.sql`
- `schemas/workflow-status/migration.sql`

The function expects `thoughts.id` to be a UUID. The dashboard now treats thought IDs as strings end to end.

## Endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/health` | GET | Auth/API health check |
| `/stats` | GET | Aggregate count, type, and topic stats |
| `/thoughts` | GET | Paginated thought browse with filters |
| `/thought/:id` | GET/PUT/DELETE | Detail, edit, delete |
| `/capture` | POST | Save one thought |
| `/search` | POST | Semantic or text search |
| `/duplicates` | GET | Near-duplicate scan |
| `/thought/:id/connections` | GET | Metadata-overlap connections |
| `/thought/:id/reflection` | GET/POST | Reflection reads/writes when the optional table exists |
| `/ingestion-jobs` | GET | Smart-ingest placeholder for dashboard compatibility |
| `/ingest` | POST | Current v1 fallback captures input as one thought |

### CRM (optional)

These require the `crm-core` (and, for engagement, `crm-engagement`) schemas. On a brain without them the routes return the underlying "function does not exist" error, and the dashboard hides the section via feature detection (`GET /crm/contacts?limit=1`).

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/crm/contacts` | GET/POST | List (search/tier/lifecycle) and create contacts |
| `/crm/contacts/:id` | GET/PATCH | Detail (record + methods + aliases) and guarded field write |
| `/crm/contacts/:id/methods` | POST | Add/update a contact method |
| `/crm/contacts/:id/field-evidence` | GET/POST | Read/attach supporting or contradicting thoughts |
| `/crm/contacts/:id/field-lock` | POST | Freeze/unfreeze a single field |
| `/crm/contacts/:id/history` | GET | Change-log for the contact |
| `/crm/contacts/:id/relationship-items` | GET | Notes + tasks + important-dates bundle |
| `/crm/contacts/:id/notes`, `/crm/notes/:noteId` | POST, PATCH | Note create / edit |
| `/crm/contacts/:id/tasks`, `/crm/tasks/:taskId` | POST, PATCH | Task create / edit |
| `/crm/contacts/:id/important-dates`, `/crm/important-dates/:dateId` | POST, PATCH | Important-date create / edit |
| `/crm/contacts/:id/interactions`, `/crm/interactions`, `/crm/interactions/:id` | GET, POST, PATCH | Interaction log |
| `/crm/contacts/:id/timeline` | GET | Change-log + interactions + evidence, newest first |
| `/crm/proposals`, `/crm/proposals/count` | GET | Proposal inbox + open-count nav badge |
| `/crm/proposals/:id/resolve`, `/crm/proposals/resolve-run` | POST | Accept/reject one proposal, or a whole import run |

Accepting a contact edit or adding a method keeps the contact's searchable **card thought** (`crm_contacts.card_thought_id`) in sync. Write-back reuses the gateway's existing embedding path and is best-effort: it never fails the write, and degrades to a text-searchable card when no `OPENROUTER_API_KEY` is set.

## Deploy

From a Supabase workdir, copy or symlink this folder to `supabase/functions/open-brain-rest`, then deploy:

```bash
supabase functions deploy open-brain-rest --no-verify-jwt --use-api --project-ref YOUR_PROJECT_REF
```

The dashboard should point `NEXT_PUBLIC_API_URL` at:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-rest
```

## Smoke Test

Run the live smoke harness against a deployed function:

```bash
OB1_REST_URL="https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-rest" \
OB1_REST_KEY="YOUR_MCP_ACCESS_KEY" \
node integrations/open-brain-rest/smoke/live-smoke.mjs
```

The smoke creates three temporary rows, verifies health, capture, browse, stats, text search, workflow update, duplicate scan, and audit filtering, then deletes the rows. Pass `--keep` only when you intentionally want to inspect the created rows.

The CRM surface has its own harness (needs the `crm-core` / `crm-engagement` schemas):

```bash
OB1_REST_URL="https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-rest" \
OB1_REST_KEY="YOUR_MCP_ACCESS_KEY" \
node integrations/open-brain-rest/smoke/crm-smoke.mjs
```

It creates one contact, exercises detail, list, patch, methods, notes, tasks, dates, interactions, history, timeline, field lock, and the proposal count, then archives the contact and deletes its card thought.

## Dashboard Demo Seed

To seed the same data story used by the screenshot/PDF/video walkthrough:

```bash
OB1_REST_URL="https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-rest" \
OB1_REST_KEY="YOUR_MCP_ACCESS_KEY" \
node integrations/open-brain-rest/smoke/seed-dashboard-demo.mjs --apply
```

Run without `--apply` first for a dry run. The seed writes through `/capture`, so it exercises the real dashboard gateway and embedding path.

## Notes

- Duplicate review uses a local token-similarity scan in v1. It is intentionally simple and cheap for solo/small-team OB1 deployments.
- Semantic search and capture require `OPENROUTER_API_KEY`.
- Reflection and smart-ingest routes are compatibility surfaces. If the optional tables/workers are missing, the dashboard still works for the core thoughts/workflow/search/audit surfaces.
