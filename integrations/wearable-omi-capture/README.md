# Omi Wearable Capture

> **Turn your Omi pendant into a passive feed for your Open Brain.** A Supabase
> Edge Function polls Omi every few minutes and atomizes each conversation — its
> title, every action item, every event, and each ~60-second transcript chunk —
> into individually searchable, individually attributed `thoughts`. It also
> captures Omi's distilled memories as their own edit-aware stream.

---

## What It Does

Omi records your spoken conversations and returns them already structured — a
title, an overview, a category, action items, events, and the raw transcript
segments. This integration is an **adapter** on top of
[`wearable-capture-core`](../wearable-capture-core/): it pulls recent Omi
conversations on a schedule and **atomizes** each one using Omi's _own_
structure, so there's **no per-item LLM classification cost**. The shared core
owns the write path — per-atom dedup on a salted fingerprint, provenance
metadata, embedding via OpenRouter (`openai/text-embedding-3-small`), and the
insert into `thoughts`.

Each non-discarded conversation produces several atoms:

| Atom                                   | Thought type | Attribution                                         |
| -------------------------------------- | ------------ | --------------------------------------------------- |
| title + overview                       | `meeting`    | `machine` (generator `omi`)                         |
| each action item                       | `task`       | `machine` (generator `omi`)                         |
| each event                             | `meeting`    | `machine` (generator `omi`)                         |
| each ~60s / ~600-char transcript chunk | `meeting`    | `self` / `other` / `mixed` / `unknown` (by speaker) |

Capturing the **transcript chunks** is the point of the atomic rework: a
summary-only capture threw away everything actually said inside a long
conversation. Now each chunk is its own row, attributed to whoever spoke it. The
chunk count is soft-warned past ~80 but **never truncated**.

Separately, the adapter captures Omi's **memories** — the distilled facts Omi
accumulates about you (`GET /v1/dev/user/memories`) — as an `omi_memory` stream.
A `manually_added` memory is attributed `self`; a device-inferred one is
`machine`. Memories are **edit-aware**: when Omi edits a memory, the next pass
re-imports it (one batch lookup, then insert-or-patch — never a per-memory table
scan).

Because it's a poller, there's no webhook to register and nothing public to
secure — the function reaches out to Omi, not the other way around.

---

## Prerequisites

- **[Wearable Capture Core](../wearable-capture-core/) installed first.** This
  adapter imports the shared engine from `../_shared/wearable-sync.ts`. Follow
  that integration's README to copy `wearable-sync.ts` into
  `supabase/functions/_shared/` and set `OPENROUTER_API_KEY`. (For convenience,
  this folder bundles an identical copy of the engine in `_shared/` so the
  function typechecks standalone — the `deno.json` import map points the deploy
  path at it for local `deno check`.)
- A working Open Brain setup (Supabase project with the `thoughts` table and
  pgvector).
- An Omi account with a personal developer API key (shaped `omi_dev_...`).
- An [OpenRouter](https://openrouter.ai) API key — already set if you installed
  the core.
- Supabase CLI installed and logged in.
- `pg_cron` and `pg_net` available in your Supabase project (both ship enabled
  on Supabase; Step 5 turns them on if needed).

**Cost**: Omi's API is included with the device. The only marginal cost is
OpenRouter embeddings (no classification — the adapter reuses Omi's own
structure). Each conversation now yields several atoms instead of one summary,
so expect roughly **$0.05–0.20/month** for typical personal volume — still
embeddings-only.

---

## Credential Tracker

Fill these in as you go — you'll need them in Steps 2 and 5:

| Credential                          | Where it comes from                                                                                          | Value             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------- |
| `OMI_API_KEY`                       | Omi app/dashboard → Developer (Step 2)                                                                       |                   |
| `OPENROUTER_API_KEY`                | [openrouter.ai/keys](https://openrouter.ai/keys)                                                             | (set by the core) |
| `SUPABASE_URL`                      | Auto-injected by Supabase                                                                                    | (skip)            |
| `SUPABASE_SERVICE_ROLE_KEY`         | Auto-injected by Supabase                                                                                    | (skip)            |
| `WEARABLE_SELF_LABELS` _(optional)_ | Comma-separated speaker labels that are _you_ (e.g. your name), merged with the device-generic `you/me/self` |                   |
| `YOUR_PROJECT_REF`                  | Your Supabase project subdomain (Step 5)                                                                     |                   |
| `CRON_SECRET`                       | Invent one in Step 5 (function key for cron)                                                                 |                   |

---

## Steps

### Step 1 — Install the shared engine (prerequisite)

This adapter is built on the **Wearable Capture Core** engine and won't deploy
without it.

Follow [`wearable-capture-core`](../wearable-capture-core/) now if you haven't:

1. Copy `wearable-sync.ts` into `supabase/functions/_shared/wearable-sync.ts`.
2. `supabase secrets set OPENROUTER_API_KEY="sk-or-v1-your-openrouter-key"`.

✅ **Done when:** `supabase/functions/_shared/wearable-sync.ts` exists and
`OPENROUTER_API_KEY` shows in `supabase secrets list`.

---

### Step 2 — Get your Omi API key

1. Open the Omi app (or developer dashboard) and go to the Developer / API
   section.
2. Create a personal API key. It's shaped like `omi_dev_abc123...`.
3. Copy it into your tracker as `OMI_API_KEY`.

> [!WARNING]
> The Omi key is a credential. Don't paste it into code, commits, or screenshots
> — it goes into Supabase secrets only (Step 4).

✅ **Done when:** You have a key beginning `omi_dev_`. You can sanity-check it:

```bash
curl -H "Authorization: Bearer omi_dev_your_key" \
  "https://api.omi.me/v1/dev/user/conversations?include_transcript=true&limit=1&offset=0"
```

A working key returns a JSON **array** (possibly empty `[]`); an invalid key
returns a `401`/`403`.

---

### Step 3 — Drop the function into your Supabase project

From the root of your Supabase project:

```bash
mkdir -p supabase/functions/wearable-omi-capture
```

Create `supabase/functions/wearable-omi-capture/index.ts` with the contents of
[`index.ts`](./index.ts) from this folder. The only external dependency is the
shared core, imported at the deploy path:

```typescript
import {
  atomFingerprint,
  type Attribution,
  fetchWithRetry,
  runWearableSync,
  type SyncResult,
  type WearableAdapter,
  type WearableAtom,
} from "../_shared/wearable-sync.ts";
```

The adapter defines `listSince` (pages Omi newest-first and filters to the time
window, since Omi has no `since` parameter), `recordId` (Omi's conversation id),
and `recordToAtoms` (title + overview, one per action item, one per event, and
one per transcript chunk — skipping `discarded` conversations). `Deno.serve`
runs the conversation pass via the core and then the memory pass, and returns a
combined JSON result.

It accepts optional query parameters for manual testing: `?dry_run=1` (compute,
write nothing), `?since_hours=N` (override the 12-hour window), `?no_memories=1`
(skip the memory stream).

✅ **Done when:** The file exists at
`supabase/functions/wearable-omi-capture/index.ts` and
`deno check index.ts _shared/wearable-sync.ts` is clean (the
`_shared/wearable-sync.ts` from Step 1 must be present for the import to
resolve).

---

### Step 4 — Set the Omi secret

```bash
supabase secrets set OMI_API_KEY="omi_dev_your_key"
# optional: label your own speech so transcript chunks attribute to "self"
supabase secrets set WEARABLE_SELF_LABELS="Your Name,Nickname"
```

`OPENROUTER_API_KEY` is already set from the core (Step 1). `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the Supabase runtime,
so you don't set those yourself.

✅ **Done when:** `supabase secrets list` shows `OMI_API_KEY` and
`OPENROUTER_API_KEY`.

---

### Step 5 — Deploy and schedule it (every 5 minutes)

**5a. Deploy the function**

```bash
supabase functions deploy wearable-omi-capture
```

Your function URL will look like:

```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/wearable-omi-capture
```

(where `YOUR_PROJECT_REF` is the subdomain of your Supabase project). Keep it
handy.

**5b. Schedule it with pg_cron + pg_net**

Run this SQL in the Supabase SQL editor. It runs the function every 5 minutes.
Replace `YOUR_PROJECT_REF` with your project ref and `YOUR_CRON_SECRET` with a
value you invent (any random string — it just needs to match a
function-invocation key your project accepts; use your
`SUPABASE_SERVICE_ROLE_KEY` or an anon key if your function requires JWT, or any
bearer if deployed `--no-verify-jwt`).

```sql
-- Enable the schedulers (no-ops if already enabled).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Poll Omi every 5 minutes.
select cron.schedule(
  'wearable-omi-capture-5m',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/wearable-omi-capture',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer YOUR_CRON_SECRET'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

The function's 12-hour rolling window means a missed run (or a paused schedule)
self-heals on the next pass — overlapping windows are safe because the core
dedups per atom on a salted fingerprint.

To change or remove the schedule later:

```sql
select cron.unschedule('wearable-omi-capture-5m');
```

> [!IMPORTANT]
> `OPENROUTER_API_KEY` must already be set (from the core) or atoms insert with
> a `null` embedding. That's recoverable — a later embedding backfill fills them
> — but set the key now to embed at capture time.

✅ **Done when:**
`select * from cron.job where jobname = 'wearable-omi-capture-5m';` shows the
schedule, and within ~5 minutes new Omi atoms start appearing in `thoughts`.

---

### Step 6 — Verify capture

After a cron run (or invoke the function once manually), confirm rows landed:

```sql
-- conversation atoms
select count(*) from thoughts where metadata->>'wearable_source' = 'omi';
-- memory stream
select count(*) from thoughts where metadata->>'source' = 'omi_memory';
```

For a closer look at what was captured, including atom kind and attribution:

```sql
select
  metadata->>'atom_kind'    as kind,
  metadata->>'attribution'  as attribution,
  left(content, 80)         as preview,
  created_at
from thoughts
where metadata->>'wearable_source' = 'omi'
order by created_at desc
limit 15;
```

You should see a mix of `overview` / `action_item` / `event` /
`transcript_chunk` kinds, with the transcript chunks carrying `self` / `other` /
`mixed` attribution.

✅ **Done when:** the counts are non-zero and growing across cron runs, with
multiple atom kinds tagged `metadata.wearable_source = 'omi'` and an
`omi_memory` stream.

---

## Expected Outcome

Every 5 minutes the function pulls Omi conversations from roughly the last 12
hours, atomizes each, skips atoms it has already captured (deduped per atom on a
salted fingerprint), and writes the new ones. A capture pass returns a combined
result, e.g.:

```json
{
  "conversations": {
    "source": "omi",
    "pulled": 6,
    "recordsImported": 4,
    "atomsInserted": 37,
    "atomsSkipped": 12,
    "failed": 0,
    "attribution": { "machine": 9, "self": 14, "mixed": 11, "unknown": 3 },
    "dryRun": false
  },
  "memories": {
    "pulled": 49,
    "inserted": 3,
    "updated": 1,
    "skipped": 45,
    "failed": 0
  },
  "dryRun": false
}
```

Conversations Omi flagged as `discarded` are silently ignored. Re-runs and
overlapping windows are safe and idempotent — there's no local state file, so a
missed run self-heals on the next pass.

---

## Troubleshooting

**`OMI_API_KEY is required`** The secret isn't set on the deployed function. Run
`supabase secrets set OMI_API_KEY="omi_dev_your_key"` and redeploy.

**`Omi conversations 401` / `403` in the logs** The Omi key is wrong, expired,
or lacks developer access. Re-check it with the `curl` from Step 2, then reset
the secret. Inspect logs with `supabase functions logs wearable-omi-capture`.

**Nothing is captured, but the function returns `200`** Check
`conversations.pulled` / `conversations.atomsInserted` in the JSON result. If
`pulled` is `0`, no Omi conversations started inside the 12-hour window — talk
to your Omi or widen the window with `?since_hours=48`. If `pulled` is non-zero
but `atomsInserted` is `0`, those atoms were already captured (expected on every
run after the first) or the conversations were all `discarded`.

**Transcript chunks aren't attributed to me (`self`)** Omi labels the wearer
with whatever speaker name it resolved. Set `WEARABLE_SELF_LABELS` to the
label(s) Omi uses for you (comma-separated); they're merged with the
device-generic `you` / `me` / `self`.

**Atoms insert but `embedding` is null** `OPENROUTER_API_KEY` isn't set. The
core inserts without an embedding by design (backfill-friendly); set the key
from the core's Step 2 to embed at capture time.

**Duplicate rows for the same conversation** The core dedups per atom on
`sourceType | provider_event_id | atom_index | content`. If you see duplicates,
confirm the cron isn't pointed at an older copy of the function and that
`recordId` returns `c.id` (not a content hash).

**Cron never fires** Confirm `pg_cron` is enabled (`select * from cron.job;`)
and that `net.http_post` rows are being created
(`select * from net._http_response order by created desc limit 5;` shows
responses). A `401` in the response body means your `Authorization` bearer in
the cron SQL doesn't match what the function expects.

---

## Tool Surface Area

This integration **registers no new MCP tools**. It is a capture-only ingestion
path: a scheduled Supabase Edge Function that polls Omi and writes rows into the
existing `thoughts` table via the shared `wearable-sync` engine.

| Component                            | Type                                | What it does                                                                                                                                                                             |
| ------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wearable-omi-capture` Edge Function | Supabase poller (not an MCP server) | On a cron, atomizes recent Omi conversations (title + overview, action items, events, transcript chunks) and captures Omi memories, handing them to the core for dedup + embed + insert. |
| `wearable-sync.ts`                   | Shared Deno module (`_shared/`)     | The engine this adapter is built on — per-atom dedup, provenance, embedding (OpenRouter), insert. See [wearable-capture-core](../wearable-capture-core/).                                |
| `thoughts` table                     | Existing Open Brain primitive       | No schema changes — additive rows only.                                                                                                                                                  |

**External services called:** `api.omi.me/v1/dev` (list conversations +
memories) and `openrouter.ai/api/v1` (embeddings). Both are outbound HTTPS; the
function exposes no inbound webhook beyond its own Supabase URL, which the cron
calls.

**Auditing:** Because this integration adds no MCP tools, there's no MCP tool
surface to audit for it directly. If you install it alongside MCP servers that
read from `thoughts`, audit those per the
[MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md).

---

## Related

- [Wearable Capture Core](../wearable-capture-core/) — the shared engine this
  adapter is built on (**install first**).
- [Limitless Wearable Capture](../wearable-limitless-capture/) — sibling adapter
  for the Limitless Pendant.
- [Telegram Capture](../telegram-capture/) — webhook-based quick capture (push,
  not poll).
- [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) —
  recommended reading for any integration contributor.
- [Contributing guide](../../CONTRIBUTING.md) — required reading before
  submitting changes.
