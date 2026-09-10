# CRM Core — editable contacts + field-proposal truth layer

A first-class, editable contact book on top of your Open Brain, with a
human-in-the-loop truth model built into the schema itself.

## The truth layer (read this first)

The point of this schema is **who is allowed to change a contact field**.

There are two kinds of writer:

- A **human** — a person editing in a UI, or a trusted manual tool — writes
  straight to the canonical contact record. Their edits win.
- A **machine / agent** — an import, an extraction pass, a projection job —
  does **not** get to overwrite a human-set field. Its write is parked as a
  **proposal**. A human later **accepts** the proposal (which applies it to the
  canonical field and logs it) or **rejects** it (which discards it and logs
  it, leaving the field untouched).

So the canonical record only ever changes when a human edits it directly, or
when a human explicitly accepts a machine proposal. A pending proposal never
mutates the live field. This is the same trust model as the persistent-wiki
regeneration guard: machine writes propose, a human accepts.

Three behaviours fall out of this:

- **Auto-protection.** When a machine origin tries to overwrite a field whose
  recorded provenance is `manual`, `crm_patch_contact_record` diverts the write
  to a proposal instead of applying it.
- **Field locks.** A human can lock a field. A locked field blocks everyone —
  machine writes, bulk manual writes, and even accepting a proposal — until it
  is unlocked. The lock is a deliberate "do not change this" statement.
- **Reject is permanent.** Each proposal has a `proposal_key` that is hashed
  from the contact, field, normalized value, and origin, and is unconditionally
  unique. A rejected proposal blocks an identical re-proposal forever; re-seeing
  the same value only bumps a `seen_count`. That makes re-imports idempotent.

## What you get

Tables:

- `crm_contacts` — the editable contact record (scalar fields plus per-field
  provenance in `field_provenance`).
- `crm_contact_methods` — emails / phones / urls / addresses, each with a
  `current` / `superseded` / `rejected` status so old values stay as history.
- `crm_contact_aliases` — alternate names for duplicate-safe future merges.
- `crm_contact_change_log` — an append-only audit trail. **Contact-method
  values are redacted (`[redacted]`) here**, so the audit log never stores a raw
  email or phone string.
- `crm_field_proposals` — the inbox where machine writers propose.
- `crm_field_evidence` — links a field / method / proposal to the thoughts
  (by UUID) that support or contradict it.

RPCs: `crm_create_contact`, `crm_get_contact`, `crm_patch_contact_record`,
`crm_set_field_lock`, `crm_add_contact_method`, `crm_propose_field`,
`crm_resolve_field_proposal`, `crm_resolve_field_proposals_by_run`,
`crm_add_field_evidence`, `crm_contact_field_evidence`.

## ID contract

Every primary key is a UUID (`gen_random_uuid()`). Every reference to a memory
row is `UUID REFERENCES public.thoughts(id)` — `crm_field_evidence.thought_id`
is a UUID and `crm_field_proposals.evidence_thought_ids` is `UUID[]`. There are
no bigint thought ids, no `brain_thoughts` table, and no view triggers.

## Security model

Row-level security is enabled on every table (default-deny for `anon` /
`authenticated`). Each table additionally revokes all privileges from `PUBLIC`,
`anon`, and `authenticated`, then grants only what `service_role` needs, so a
project that blanket-grants new tables to its API roles cannot leave contact
data exposed. Every function is `SECURITY INVOKER` with a fixed `search_path`
and is granted to `service_role` only. Reach this data through the service role
on a trusted server, never from the browser.

## Prerequisites

- A working Open Brain database (Supabase + pgvector) with the core
  `public.thoughts` table (UUID `id`). The evidence table references it.
- PostgreSQL with the `pgcrypto` extension available (the schema creates it if
  needed, for `gen_random_uuid()` and `sha256`).
- The ability to run SQL against your project as an admin (the Supabase SQL
  editor, or `psql` with the service role).
- This schema does **not** require any external service. Relationship *tiers*
  are a separate schema (`crm-person-tiers`); this schema keeps only a free-text
  `relationship_note` and does not model tiers.

## Apply steps

1. Open the Supabase SQL editor for your project (or connect with `psql`).
2. Paste the full contents of `schema.sql` and run it. It is idempotent
   (`CREATE TABLE / INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`), additive
   only, and safe to re-run.
3. Confirm the six tables exist:
   `select table_name from information_schema.tables where table_name like 'crm_%' order by 1;`
   You should see `crm_contacts`, `crm_contact_methods`, `crm_contact_aliases`,
   `crm_contact_change_log`, `crm_field_proposals`, `crm_field_evidence`.
4. Confirm the RPCs are callable by the service role (the `NOTIFY pgrst` at the
   end of the file reloads the PostgREST schema cache automatically).

## Expected outcome

After applying the schema you have an editable contact book where human edits
are authoritative and machine writes are queued for human review. Walk the
worked example below to see the propose → resolve flow end to end. All data here
is fictional.

### Worked example: propose → accept

```sql
-- 1. A human creates a contact. display_name gets 'manual' provenance, so it is
--    immediately protected from machine overwrites.
select public.crm_create_contact(
  'Ada Lovelace', 'ada@example.com', 'Acme Corp', 'Engineer', 'human:you'
) as contact_id;            -- returns a UUID, e.g. 11111111-...

-- A human sets the job title manually.
select public.crm_patch_contact_record(
  '11111111-...'::uuid,
  '{"job_title":"Lead Engineer"}'::jsonb,
  'human:you', 'manual'
);                          -- applied: ["job_title"]

-- 2. A machine import tries to change the human-set job title. Because the
--    field's provenance is 'manual', the write is DIVERTED to a proposal — the
--    canonical job_title stays "Lead Engineer".
select public.crm_patch_contact_record(
  '11111111-...'::uuid,
  '{"job_title":"Senior Engineer"}'::jsonb,
  'agent:importer', 'import', 'import-run-001'
);                          -- applied: [], proposed: [{field: job_title, ...}]

-- 3. A human reviews the inbox and ACCEPTS the proposal. Now (and only now) the
--    canonical job_title becomes "Senior Engineer", and the change is logged.
select public.crm_resolve_field_proposal(
  (select id from public.crm_field_proposals
   where status = 'open' order by created_at desc limit 1),
  'accept', 'human:you'
);                          -- status: accepted; canonical field updated + logged
```

### Worked example: propose → reject (and why reject is permanent)

```sql
-- A machine proposes a location that the human disagrees with.
select public.crm_propose_field(
  '11111111-...'::uuid, 'contact_field', 'location',
  'Mars Colony', 'extraction', '{"run_id":"extract-run-002"}'::jsonb
);

-- The human REJECTS it. The canonical location is NOT touched; the proposal is
-- marked rejected and logged.
select public.crm_resolve_field_proposal(
  (select id from public.crm_field_proposals
   where field_key = 'location' and status = 'open' limit 1),
  'reject', 'human:you'
);

-- If the same import runs again and re-proposes "Mars Colony" from the same
-- origin, the proposal does NOT reopen — it stays rejected and only bumps
-- seen_count. The bad value can never be re-proposed.
```

### Worked example: field lock

```sql
-- Lock the organization so nothing — not a machine, not a bulk manual write,
-- not even accepting a proposal — can change it until it is unlocked.
select public.crm_set_field_lock('11111111-...'::uuid, 'organization_name', true, 'human:you');

-- Unlock it again to allow edits.
select public.crm_set_field_lock('11111111-...'::uuid, 'organization_name', false, 'human:you');
```

## Notes on what is intentionally not here

- **No backfill from a personal projection.** The upstream source had a
  `crm_backfill_contacts_from_projection` function and a projection cache that
  read from a Gmail-coupled entity graph. Those are omitted here: they cannot be
  made generic and data-free, and a public schema should not assume a Gmail
  pipeline. Contacts are created directly via `crm_create_contact`, or proposed
  into existence by your own connectors.
- **No relationship tiers.** Tier modelling lives in the separate
  `crm-person-tiers` schema. This schema keeps a plain `relationship_note`.
- **Engagement (notes, tasks, interactions) and the MCP tool surface** are
  separate contributions that build on this core.

## More from Nate

Open Brain is built in the open by Nate B. Jones — more practical systems like
this on his [Substack](https://substack.com/@natesnewsletter) and at
[natebjones.com](https://natebjones.com).
