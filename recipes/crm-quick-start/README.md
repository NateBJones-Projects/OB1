# CRM Quick Start

> Stand up the Open Brain CRM truth layer in one sitting: seed contacts from the people already in your brain, then watch a machine write get parked as a proposal that a human accepts.

## What It Does

The CRM schemas and the CRM tools give you an editable contact book with one rule baked into the database: a human owns the canonical facts, and a machine that tries to overwrite a human-set field gets **proposed** instead of applied. This recipe walks that rule from an empty contact book to a finished, audited change, using nothing but the `open-brain-rest` gateway your dashboard already talks to.

It does two independent things:

- **Backfill** — reads the `person` entities your brain has already extracted and creates a contact for each one, so you start with a populated book instead of a blank slate.
- **Demo** — seeds one fictional contact, has a "machine" try to change a human-set field, shows the write diverted into a proposal, accepts the proposal, and then reads back the change-log row that records the accepted change. That row is the correction receipt: proof the field only moved because a person said so.

A single script, `crm-quick-start.mjs`, runs both.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md)).
- The `schemas/crm-core` schema applied (editable contacts + the field-proposal truth layer). Apply its `schema.sql` first.
- The `schemas/crm-engagement` schema applied (notes, tasks, interactions). It depends on `crm-core`, so apply core first.
- The `integrations/open-brain-rest` gateway deployed. The recipe calls its `/crm/*` routes. See that integration's README for deploy steps.
- Node.js 18 or newer (the script uses the built-in `fetch` — no dependencies to install).
- For `--backfill` only: the `schemas/entity-extraction` schema applied and some `person` entities already extracted, plus your service role key (the backfill reads the `entities` table directly, because the gateway has no entity route).
- Optional but recommended: `OPENROUTER_API_KEY` set on the gateway. Each contact gets a per-contact "card" thought that is re-embedded on every accepted change. With the key set, that card is semantically searchable; without it, the card is still written but stays text-search only. The recipe itself needs no OpenRouter key — the gateway handles embeddings.

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
CRM QUICK START -- CREDENTIAL TRACKER
-------------------------------------

FROM YOUR OPEN BRAIN SETUP
  open-brain-rest URL:       ____________  (OB1_REST_URL)
  MCP access key:            ____________  (OB1_REST_KEY)

BACKFILL ONLY
  Project URL:               ____________  (SUPABASE_URL)
  Service role key:          ____________  (SUPABASE_SERVICE_ROLE_KEY)

-------------------------------------
```

Set these in your shell, or drop them in a `.env.local` in the directory you run the script from (the script reads that file automatically).

## Steps

1. Apply `schemas/crm-core/schema.sql`, then `schemas/crm-engagement/schema.sql`, to your Open Brain project. Both are idempotent.

2. Deploy `integrations/open-brain-rest` if you have not already, and note its function URL and the `MCP_ACCESS_KEY` you gave it.

3. Export the gateway credentials:

   ```bash
   export OB1_REST_URL="https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-rest"
   export OB1_REST_KEY="YOUR_MCP_ACCESS_KEY"
   ```

4. Run the demo. It creates one fictional contact, exercises the propose → accept → receipt flow, then archives the contact and deletes its card thought:

   ```bash
   node crm-quick-start.mjs --demo
   ```

   You should see the six numbered steps print, ending with `Demo passed.` Add `--keep` if you want to leave the contact in place to inspect it in the dashboard.

5. (Optional) Backfill contacts from the people already in your brain. Add the service role key first:

   ```bash
   export SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
   export SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"

   node crm-quick-start.mjs --backfill              # dry run: prints who it would create
   node crm-quick-start.mjs --backfill --apply --limit 25
   ```

   The backfill skips any person whose name already matches an existing contact, so it is safe to re-run.

## Expected Outcome

The `--demo` run prints its progress and ends with `Demo passed.`:

```text
  1. created contact <uuid> (job_title = "Engineer", provenance manual)
  2. machine write to job_title was diverted -> proposed, live field still "Engineer"
  3. found open proposal <uuid> for job_title
  4. human accepted the proposal
  5. canonical job_title is now "Senior Engineer"
  6. correction receipt found: change-log row <uuid> via_proposal=<uuid>
Demo passed. The truth layer proposed, a human accepted, and the receipt is on record.
```

Step 2 is the whole point: the machine write to a human-owned field did **not** land — it became a proposal. Step 6 is the receipt: a `contact.update` row in `crm_contact_change_log` whose `changed_fields.via_proposal` points back at the proposal you accepted. That link is what lets you prove, later, that the field changed through a human decision rather than a silent overwrite.

The `--backfill --apply` run creates one contact per new person entity and reports how many it created versus skipped. Open the dashboard's Contacts page (or call `crm_search_contacts`) and your book is populated.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Set OB1_REST_URL` / `Set OB1_REST_KEY` | Gateway credentials missing | Export `OB1_REST_URL` and `OB1_REST_KEY`, or put them in a `.env.local` in the current directory. |
| `401 Invalid or missing access key` | `OB1_REST_KEY` does not match the gateway | Use the same `MCP_ACCESS_KEY` the `open-brain-rest` function was deployed with. |
| A route errors mentioning a missing relation or function (`crm_contacts`, `crm_field_proposals`) | CRM schemas not applied | Apply `schemas/crm-core/schema.sql` then `schemas/crm-engagement/schema.sql`, then retry. |
| Step 2 asserts "machine write did NOT apply" but the write applied | The seeded `job_title` was not treated as human-owned | Confirm you are on the current `crm-core` schema; `crm_create_contact` stamps seeded fields as `manual`. Re-run against a fresh contact (the demo always creates its own). |
| `No entities table found` on `--backfill` | `entity-extraction` schema not applied | Apply `schemas/entity-extraction`, extract some entities, or skip `--backfill` and run `--demo`. |
| `--backfill` needs `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Backfill reads `entities` directly | Export both. The gateway has no entity route, so the backfill reads PostgREST with the service role. |
| Contact card is not semantically searchable | `OPENROUTER_API_KEY` not set on the gateway | Set it on the `open-brain-rest` function and redeploy. The card still exists without it — it is just text-search only until an accepted change re-embeds it. |

## More from Nate

Open Brain is built in the open by Nate B. Jones — more practical systems like this on his [Substack](https://substack.com/@natesnewsletter) and at [natebjones.com](https://natebjones.com).
