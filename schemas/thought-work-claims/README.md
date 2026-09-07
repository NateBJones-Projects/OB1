# Thought Work Claims

> A blackboard so many workers can chew through the same pool of thoughts in parallel, and no two workers ever grab the same thought.

## What It Does

When you want to process a large set of thoughts — enrich them, re-embed them, score them, consolidate duplicates — one process is slow. The obvious fix is to run several workers at once. The catch: if two workers both `SELECT` the next batch of unprocessed thoughts, they will pick overlapping rows and do the same work twice (or worse, write conflicting results).

This schema is the coordination layer that prevents that. It installs:

- **`public.thought_work_claims`** — one row per `(thought_id, work_type)`. A row means "some worker owns this thought for this kind of work right now."
- **`claim_thoughts(ids, work_type, worker_id, ttl)`** — a worker hands in a batch of candidate thought ids and gets back only the subset it actually won. The rest were already claimed by someone else.
- **`release_thought(...)`** — mark one claim terminal (`succeeded` / `failed`) when the worker finishes it.
- **`release_claims_for_worker(...)`** — on clean shutdown, drop a worker's still-open claims so other workers can pick them up immediately.

`work_type` is a free-form label (for example `enrichment`, `consolidation`, `embedding_backfill`). Claims for different work types are independent: the same thought can be claimed for `enrichment` and `scoring` at the same time by two different pipelines without interfering.

### How a claim stays exclusive (the race guard)

The table's primary key is `(thought_id, work_type)`. `claim_thoughts` inserts candidate rows with `INSERT ... ON CONFLICT (thought_id, work_type) DO NOTHING` and returns only the rows it actually inserted. The unique index is the arbiter: when two workers submit the same id at the same moment, PostgreSQL lets exactly one `INSERT` create the row and the other conflicts out silently. The loser just sees that id missing from its result set and moves on. No row is ever handed to two workers — and there are no advisory locks or `SELECT ... FOR UPDATE` to reason about, because the constraint does the mutual exclusion atomically inside a single statement.

### TTL and stale-claim reaping

A worker can die mid-batch — `SIGKILL`, a dropped connection, an out-of-memory kill — and never release its claims. Without a recovery path those thoughts would be stranded as "claimed" forever.

Every claim carries `ttl_expires_at`. `claim_thoughts` reaps inline on every call: before inserting, it `DELETE`s claims for that `work_type` whose `status` is still `claimed` and whose `ttl_expires_at` is in the past, freeing those slots for a fresh claim. Set the TTL comfortably longer than one unit of work — long enough that a healthy worker always renews or releases before it expires, short enough that a crashed worker's claims free up promptly. The default is 900 seconds (15 minutes).

`succeeded` and `failed` claims are terminal and are **not** reaped by TTL — they stay as a processing record and block re-claim until you clear them yourself.

## Prerequisites

- A working Open Brain setup with the canonical `public.thoughts` table ([getting-started guide](../../docs/01-getting-started.md)).
- `public.thoughts.id` is `UUID` (the canonical Open Brain type). If you run a non-canonical `BIGINT` id, see [ID Type Note](#id-type-note).
- Access to the Supabase SQL Editor (or the Supabase CLI) with the service role.
- A `service_role` role (Supabase provides this by default). Workers connect with the service-role key — these RPCs are server-side only and are not exposed to `anon`/`authenticated`.
- Node.js 18+ if you want to run the example worker (it uses the built-in global `fetch`).

## Steps

1. Open your **Supabase SQL Editor** (Dashboard → SQL Editor).
2. Paste the full contents of [`schema.sql`](./schema.sql) and run it. The script is idempotent — it uses `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `CREATE OR REPLACE FUNCTION`, so re-running it is safe.
3. Confirm the table and RPCs exist:

   ```sql
   SELECT to_regclass('public.thought_work_claims') AS claims_table;

   SELECT proname
   FROM pg_proc
   WHERE proname IN ('claim_thoughts', 'release_thought', 'release_claims_for_worker')
   ORDER BY proname;
   ```

4. (Optional) Confirm the table is service-role only:

   ```sql
   SELECT grantee, privilege_type
   FROM information_schema.role_table_grants
   WHERE table_name = 'thought_work_claims';
   ```

Or, if you keep migrations in `supabase/migrations/`, apply via the CLI:

```bash
supabase db push
```

## How to Use It

The claim/work/release loop for one worker is:

1. Find candidate thought ids that still need this `work_type` (your own query — e.g. thoughts missing an enrichment field).
2. Call `claim_thoughts(candidate_ids, work_type, worker_id, ttl)`. Keep only the ids it returns.
3. Do the work for each claimed id.
4. Call `release_thought(id, work_type, worker_id, 'succeeded')` (or `'failed'` with an error string) per id.
5. On shutdown, call `release_claims_for_worker(work_type, worker_id)` to free anything still in flight.

Run as many copies of the worker as you like — give each a distinct `worker_id` — and they will divide the pool with no overlap.

### Minimal Node worker example

This is a complete, dependency-free worker using the service-role key and Supabase's PostgREST RPC endpoint. It claims a batch, "processes" each thought (replace `processThought` with your real work), and releases each result. Configure it entirely through environment variables — no endpoints or keys are hardcoded.

```js
// worker.mjs — run with: node worker.mjs
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional env: WORK_TYPE, WORKER_ID, CLAIM_SIZE, TTL_SECONDS

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = requireEnv("SUPABASE_URL");           // e.g. https://YOUR-PROJECT.supabase.co
const SERVICE_KEY  = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const WORK_TYPE    = process.env.WORK_TYPE  ?? "enrichment";
// WORKER_ID MUST be globally unique across every running worker. A bare PID is
// not safe: containers frequently share PIDs (often PID 1), so two workers on
// different hosts can collide on the same id — and release_claims_for_worker()
// matches purely on worker_id, so one worker's shutdown would then delete the
// other's in-flight claims. The default below adds hostname + a random suffix.
// If you set WORKER_ID yourself, guarantee uniqueness the same way.
const WORKER_ID    = process.env.WORKER_ID
  ?? `${WORK_TYPE}-${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const CLAIM_SIZE   = Number(process.env.CLAIM_SIZE  ?? 20);
const TTL_SECONDS  = Number(process.env.TTL_SECONDS ?? 900);

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Your own query for thoughts that still need this work_type. Returns UUIDs.
// Here we just pull recent thoughts as a placeholder.
//
// CRITICAL: exclude thoughts that already have a row in thought_work_claims for
// this work_type. A claim row sticks around after release in a terminal
// ('succeeded'/'failed') state, and it keeps occupying the (thought_id,
// work_type) primary key — so claim_thoughts() will keep skipping it. If this
// query does NOT filter those rows out, the loop re-fetches the same newest
// page forever, claim_thoughts() returns nothing, and the worker backs off
// indefinitely instead of paging back to older, still-unclaimed thoughts.
//
// We use a PostgREST embedded resource as a NOT-EXISTS filter: select thoughts
// and left-join the claims for this work_type, then keep only thoughts whose
// joined claim is null (no claim of any status). `claims` is the table's
// auto-detected embedding via the thought_id foreign key.
async function findCandidates(limit) {
  const params = new URLSearchParams({
    select: "id,claims:thought_work_claims(thought_id)",
    "claims.work_type": `eq.${WORK_TYPE}`,
    "claims.thought_id": "is.null", // keep only thoughts with NO claim row
    order: "created_at.desc",
    limit: String(limit),
  });
  const url = `${SUPABASE_URL}/rest/v1/thoughts?${params}`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`candidate query failed: ${res.status}`);
  return (await res.json()).map((row) => row.id);
}

// Replace this with the real work (enrich, embed, score, consolidate, ...).
async function processThought(id) {
  // ... do something with the thought ...
  return { ok: true };
}

async function main() {
  // Release this worker's open claims on Ctrl-C so others can reclaim them.
  let shuttingDown = false;
  const cleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const freed = await rpc("release_claims_for_worker", {
      p_work_type: WORK_TYPE,
      p_worker_id: WORKER_ID,
    });
    console.log(`released ${freed} open claim(s) on shutdown`);
    process.exit(0);
  };
  process.on("SIGINT", cleanup);

  while (!shuttingDown) {
    const candidates = await findCandidates(CLAIM_SIZE);
    if (candidates.length === 0) break;

    // claim_thoughts returns ONLY the ids this worker won.
    const claimed = await rpc("claim_thoughts", {
      p_thought_ids: candidates,
      p_work_type: WORK_TYPE,
      p_worker_id: WORKER_ID,
      p_ttl_seconds: TTL_SECONDS,
    });
    if (claimed.length === 0) {
      // Everything we saw was already claimed by another worker. Back off.
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    for (const id of claimed) {
      try {
        await processThought(id);
        await rpc("release_thought", {
          p_thought_id: id,
          p_work_type: WORK_TYPE,
          p_worker_id: WORKER_ID,
          p_status: "succeeded",
        });
      } catch (err) {
        await rpc("release_thought", {
          p_thought_id: id,
          p_work_type: WORK_TYPE,
          p_worker_id: WORKER_ID,
          p_status: "failed",
          p_error: String(err).slice(0, 500),
        });
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Start several workers (each derives a distinct, globally unique `WORKER_ID` from
its hostname, PID, and a random suffix), and they will split the queue between
them:

```bash
SUPABASE_URL="https://YOUR-PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" \
WORK_TYPE="enrichment" CLAIM_SIZE=20 \
node worker.mjs &

SUPABASE_URL="https://YOUR-PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" \
WORK_TYPE="enrichment" CLAIM_SIZE=20 \
node worker.mjs &
```

### Sizing the TTL against the whole batch

`claim_thoughts` stamps **every** id in a batch with the same `ttl_expires_at`
at claim time, but the worker processes them serially. The TTL therefore has to
outlast the time to process the *entire* batch, not just one thought — the last
id in a `CLAIM_SIZE`-long batch is not touched until the previous ones finish,
and its clock has been ticking the whole time.

If `CLAIM_SIZE × per-thought time` exceeds `TTL_SECONDS`, the trailing ids
expire while still held. The next `claim_thoughts` call reaps them as stale and
hands them to another worker, which reprocesses them — duplicate work, and a
later `release_thought` from the original holder returns `false` because it no
longer owns the row. Keep the relationship safe with either lever:

- **Set the TTL to cover the whole batch:** `TTL_SECONDS ≥ CLAIM_SIZE × (worst-case seconds per thought) × safety factor`. With the defaults (`CLAIM_SIZE=20`, `TTL_SECONDS=900`) that allows ~45s per thought before risk.
- **Or claim smaller batches:** lower `CLAIM_SIZE` so a batch always finishes well inside the TTL.

There is no mid-batch renewal RPC in this schema by design — keeping the claim
path a single atomic statement is what makes the race guard simple to reason
about. If your per-thought work is long or highly variable, prefer small batches
(even `CLAIM_SIZE=1`) so each claim's TTL only has to cover one unit of work.

### Inspecting and clearing claims

```sql
-- What is currently claimed, and by whom?
SELECT thought_id, worker_id, status, claimed_at, ttl_expires_at
FROM public.thought_work_claims
WHERE work_type = 'enrichment'
ORDER BY claimed_at DESC;

-- Re-run a batch: clear terminal rows so those thoughts become claimable again.
DELETE FROM public.thought_work_claims
WHERE work_type = 'enrichment' AND status IN ('succeeded', 'failed');
```

## Expected Outcome

After running the migration:

- A table `public.thought_work_claims` exists with `thought_id UUID REFERENCES public.thoughts(id)`, a `(thought_id, work_type)` primary key, a `status` check constraint, RLS enabled, `SELECT, INSERT, UPDATE, DELETE` granted to `service_role` only, and all privileges explicitly revoked from `anon` and `authenticated`.
- Two indexes exist: `idx_twc_status_ttl` (the reaper / work-type queries) and the partial `idx_twc_worker` (a worker's open claims).
- Three RPCs exist — `claim_thoughts`, `release_thought`, `release_claims_for_worker` — each `SECURITY INVOKER`, executable by `service_role` only.
- Running two workers against the same `work_type` divides the pool with no overlap: each thought is processed exactly once.
- A claim whose worker dies is automatically reclaimable after its TTL expires, on the next `claim_thoughts` call for that `work_type`.
- No column on `public.thoughts` is altered or dropped — the change is purely additive.
- PostgREST's schema cache is reloaded (`NOTIFY pgrst, 'reload schema'`).

## ID Type Note

This schema assumes `public.thoughts.id` is `UUID`, the canonical Open Brain type, so `thought_id` is `UUID` and the RPC arrays are `UUID[]`. If you run a non-canonical install where `thoughts.id` is `BIGINT`, change `thought_id UUID` to `thought_id BIGINT` in the table, and change every `UUID` / `UUID[]` in the three function signatures (and the `SETOF UUID` return of `claim_thoughts`) to `BIGINT` / `BIGINT[]` before running it. No other change is required.

## Rollback

To remove the claim system entirely:

```sql
DROP FUNCTION IF EXISTS public.claim_thoughts(UUID[], TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS public.release_thought(UUID, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.release_claims_for_worker(TEXT, TEXT);
DROP TABLE IF EXISTS public.thought_work_claims;

NOTIFY pgrst, 'reload schema';
```

Dropping the table removes all in-flight and historical claim records. It does not touch `public.thoughts`.

## Troubleshooting

**Issue: every `claim_thoughts` call returns an empty array.**
Either everything is already claimed (check the table), or all your candidate rows are in a terminal `succeeded`/`failed` state from a previous run. Clear terminal rows for that `work_type` to make those thoughts claimable again (see [Inspecting and clearing claims](#inspecting-and-clearing-claims)).

**Issue: claimed thoughts never free up after a crashed worker.**
The TTL reaper only runs when `claim_thoughts` is next called for that `work_type`. If no worker is calling it, nothing reaps. Run any worker (or call `claim_thoughts` with an empty/any id array) to trigger a reap, or shorten the TTL.

**Issue: `release_thought` returns `false`.**
The row is not held by that `worker_id` in `claimed` status — it may have been TTL-reaped (TTL too short for the work), already released, or claimed by a different worker. Lengthen the TTL so it outlasts one unit of work.

**Issue: workers keep backing off and never reach older unprocessed thoughts.**
Your candidate query is re-fetching the same newest rows every loop, and they are all already in `thought_work_claims` (claimed or terminal). Because terminal rows keep occupying the `(thought_id, work_type)` primary key, `claim_thoughts` skips them forever. Make `findCandidates` exclude thoughts that already have a claim row for this `work_type` (the example uses a `thought_work_claims` embedding filtered to `thought_id=is.null`) so the query pages past them to genuinely unclaimed thoughts.

**Issue: the same thought gets processed twice under one `work_type`.**
The batch took longer to process than the TTL, so trailing ids in the batch expired mid-flight and were reaped and reclaimed by another worker. Raise `TTL_SECONDS` to cover the whole batch or lower `CLAIM_SIZE` (see [Sizing the TTL against the whole batch](#sizing-the-ttl-against-the-whole-batch)).

**Issue: PostgREST still does not see the new RPCs.**
The migration emits `NOTIFY pgrst, 'reload schema'`. If it does not take effect, reload from Dashboard → Project Settings → API → Reload schema.

## More from Nate

Open Brain is built in the open by Nate B. Jones — more practical systems like this on his [Substack](https://substack.com/@natesnewsletter) and at [natebjones.com](https://natebjones.com).
