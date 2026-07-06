# CRM Engagement — notes, tasks, important dates, interactions, keep-in-touch

The engagement layer for the CRM. CRM core (`schemas/crm-core`) gives you an
editable, human-owned contact record with a propose / accept truth layer. This
schema adds the day-to-day relationship surface around each contact and a
keep-in-touch queue that nudges you when a relationship needs attention.

## What you get

Tables:

- `crm_contact_notes` — relationship notes, with a type
  (`relationship_note` / `private_note` / `context`), a `pinned` flag, and a
  privacy tier.
- `crm_contact_tasks` — lightweight follow-ups, reminders, and todos with a
  status (`open` / `completed` / `snoozed` / `archived`), due date, and
  priority.
- `crm_contact_important_dates` — birthdays, anniversaries, and other dates,
  with annual-recurrence handling. De-duplicated per contact.
- `crm_interactions` + `crm_interaction_contacts` — a manual log of calls,
  meetings, in-person catch-ups, and messages, linked to one or more contacts.
- `crm_contact_suggestion_reviews` — the review history (dismiss / snooze /
  convert-to-task) for keep-in-touch suggestions.

Derived RPCs:

- `crm_contact_relationship_health` — a per-contact summary: overdue tasks,
  due-soon tasks, upcoming dates, last logged interaction, and whether the
  relationship has "gone quiet". Produces a `next_action_kind`, a score, and a
  list of reasons.
- `crm_keep_in_touch_suggestions` — the queue. One suggestion per active
  contact whose health says an action is due, ranked by priority. The latest
  review decides whether a suggestion is still `open`.

Write / read RPCs: `crm_add_contact_note`, `crm_update_contact_note`,
`crm_add_contact_task`, `crm_update_contact_task`,
`crm_add_contact_important_date`, `crm_update_contact_important_date`,
`crm_log_interaction`, `crm_update_interaction`, `crm_contact_interactions`,
`crm_contact_relationship_items`, `crm_update_keep_in_touch_suggestion`.

## The keep-in-touch engine (self-contained)

The suggestion queue is derived **only** from this engagement data plus
`crm_contacts`. For each active contact it computes relationship health from the
contact's own tasks, important dates, and logged interactions, then turns a due
action into a ranked suggestion:

- an **overdue task** → high priority,
- a relationship that has **gone quiet** (no logged interaction in 90 days) →
  high priority,
- a **due-soon task** or an **upcoming date** → medium priority.

There is no Gmail pipeline, no entity graph, and no projection cache in this
path — a fresh Open Brain install with CRM core gets a working queue with
nothing but the rows you enter.

Two behaviours keep the queue honest over time:

- **Versioned suggestion keys.** A suggestion's key includes the source item it
  came from — the driving task's id for an overdue / due-soon task, the
  resolved occurrence for an upcoming date, the last-interaction epoch for a
  reconnect. Dismissing or converting a suggestion therefore only silences
  *that* item. When a genuinely new task goes overdue months later, or a
  reconnected relationship goes quiet again, a fresh key re-enters the queue
  instead of being suppressed by the old review. Always read `suggestion_key`
  back from the queue rather than constructing it by hand.
- **Convert links, never duplicates.** Converting an overdue-task or due-soon
  suggestion links the review to the task it was derived from
  (`metadata.linked_existing_task = true`) rather than minting a second,
  immediately-overdue copy. Only suggestions with no backing task (upcoming
  date, reconnect) create a new follow-up on convert.

## ID contract

Every primary key is a UUID (`gen_random_uuid()`). `contact_id` is
`UUID REFERENCES public.crm_contacts(id) ON DELETE CASCADE`, so deleting a
contact removes its engagement rows. The only memory reference is
`crm_interactions.thought_id`, which is
`UUID REFERENCES public.thoughts(id) ON DELETE SET NULL`. There are no bigint
thought ids, no `brain_thoughts` table, and no view triggers.

## Security and privacy

Row-level security is enabled on every table (default-deny for `anon` /
`authenticated`). Each table additionally revokes all privileges from `PUBLIC`,
`anon`, and `authenticated`, then grants only what `service_role` needs, so a
project that blanket-grants new tables to its API roles cannot leave
relationship data exposed. Every function is `SECURITY INVOKER` with a fixed
`search_path` and is granted to `service_role` only.

Every row carries a `privacy_tier` (`standard` / `sensitive` / `restricted`).
The health and suggestion read paths exclude `restricted` rows by default. The
audit log inherited from CRM core records create / update / delete actions, but
note bodies and interaction summaries are **not** copied into it — only ids,
types, and flags — so the change log never stores free-text relationship
content.

## Prerequisites

- **CRM core applied first.** This schema depends on the `crm-core` schema in
  this repository (folder path `schemas/crm-core`). Apply it before this one.
  Every engagement table references `public.crm_contacts(id)`, and the RPCs
  write to `public.crm_contact_change_log`, both created by CRM core. Applying
  this file without CRM core will fail on the foreign keys — that is intended.
- A working Open Brain database (Supabase + pgvector) with the core
  `public.thoughts` table (UUID `id`). `crm_interactions.thought_id` references
  it.
- PostgreSQL with the `pgcrypto` extension available (the schema creates it if
  needed, for `gen_random_uuid()`).
- The ability to run SQL against your project as an admin (the Supabase SQL
  editor, or `psql` with the service role).
- This schema requires **no** external service.

## Apply steps

1. Apply `schemas/crm-core` first if you have not already (see its README).
2. Open the Supabase SQL editor for your project (or connect with `psql`).
3. Paste the full contents of `schema.sql` and run it. It is idempotent
   (`CREATE TABLE / INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`),
   additive only, and safe to re-run.
4. Confirm the six tables exist:
   `select table_name from information_schema.tables where table_name in ('crm_contact_notes','crm_contact_tasks','crm_contact_important_dates','crm_interactions','crm_interaction_contacts','crm_contact_suggestion_reviews') order by 1;`
5. Confirm the RPCs are callable by the service role (the `NOTIFY pgrst` at the
   end of the file reloads the PostgREST schema cache automatically).

## Expected outcome

After applying the schema you can attach notes, tasks, and important dates to a
contact, log off-channel interactions, and read a keep-in-touch queue that tells
you who needs attention and why. Walk the worked example below to see it end to
end. All data here is fictional.

### Worked example

```sql
-- 0. Create a contact (from CRM core). Returns a UUID; substitute it below.
select public.crm_create_contact(
  'Ada Lovelace', 'ada@example.com', 'Acme Corp', 'Engineer', 'human:you'
) as contact_id;            -- e.g. 11111111-1111-1111-1111-111111111111

-- 1. Log an interaction (a phone call five days ago).
select public.crm_log_interaction(
  array['11111111-1111-1111-1111-111111111111'::uuid],
  'call',
  now() - interval '5 days',
  'Discussed the Q3 roadmap.',
  30                         -- duration in minutes
);

-- 2. Add a pinned relationship note.
select public.crm_add_contact_note(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'Met at a conference; interested in graph databases.',
  'relationship_note', true
);

-- 3. Add a follow-up task that is already overdue.
select public.crm_add_contact_task(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'Send the proposal deck', null,
  'follow_up', 'open', now() - interval '2 days', null, 'high'
);

-- 4. Add an upcoming birthday.
select public.crm_add_contact_important_date(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'Birthday', '1990-06-20', 'birthday', 'annual'
);

-- 5. Read the relationship health summary.
select public.crm_contact_relationship_health(
  '11111111-1111-1111-1111-111111111111'::uuid
);
-- → status "needs_attention", next_action_kind "overdue_task",
--   reasons including "overdue_task" and "upcoming_date".

-- 6. Get a keep-in-touch suggestion. Copy the suggestion_key it returns —
--    it is versioned per source item (here, the overdue task's id), so always
--    read it from the queue rather than constructing it by hand.
select suggestion_key, priority, summary, suggested_task_title
from public.crm_keep_in_touch_suggestions();
-- → one high-priority row: "Review overdue follow-up with Ada Lovelace."
--   suggestion_key e.g.
--   keep_in_touch:11111111-...-111111111111:overdue_task:<overdue-task-uuid>

-- 7. Act on it: convert the suggestion. Because this suggestion was derived
--    from an existing overdue task, convert LINKS that task into the review
--    instead of creating a duplicate. Pass the suggestion_key from step 6.
select public.crm_update_keep_in_touch_suggestion(
  '11111111-1111-1111-1111-111111111111'::uuid,
  (select suggestion_key
     from public.crm_keep_in_touch_suggestions(1, 0, 'open',
            '11111111-1111-1111-1111-111111111111'::uuid)),
  'converted_task'
);
-- The suggestion is recorded as reviewed and linked to the existing task
-- (metadata.linked_existing_task = true). For a non-task suggestion
-- (upcoming date or reconnect) convert creates a fresh follow-up task instead.
```

## Notes on what is intentionally not here

- **No Gmail or entity-graph coupling.** The upstream source derived health and
  timelines from a Gmail-coupled entity graph and a projection cache. Those are
  omitted: the engagement surface here is keyed purely on the CRM contact UUID
  and the rows you enter, so it works on any install without a mail pipeline.
- **No person-to-person relationship edges or "how we met".** The upstream
  source modelled typed relationships and an introducer over an `entities` /
  `edges` graph that Open Brain core does not ship. Those are a separate
  follow-up if wanted.
- **The MCP tool surface** (search / get / next-actions / briefing / add-note /
  add-task / log-interaction) is a separate contribution that builds on this
  schema and CRM core.

## More from Nate

Open Brain is built in the open by Nate B. Jones — more practical systems like
this on his [Substack](https://substack.com/@natesnewsletter) and at
[natebjones.com](https://natebjones.com).
