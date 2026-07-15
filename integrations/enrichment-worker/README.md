# Enrichment Worker

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@eazene](https://github.com/eazene)**

> Cron-driven Edge Function that enriches un-enriched thoughts (raw imports, skipped or failed classifications) with LLM metadata in place, via an atomic claim RPC. Pairs with Readwise capture stamping and a backfill drain loop.

## What It Does

Some thoughts land in your brain without good metadata: raw imports, captures that used `skip_classification` for speed, and rows whose classification failed and fell back to defaults. This worker finds them and runs them back through the canonical `extractMetadata` cascade (the same one the enhanced MCP server uses), writing `type`, `summary`, `topics`, `tags`, `people`, and `action_items` **in place** — no new rows, no duplicates.

### The queue (`schema.sql`)

`schema.sql` installs two read-only views and one atomic claim RPC (no tables):

- **`thoughts_needing_enrichment`** — the queue surface. A row qualifies when its `metadata.enrichment_status` is `NULL` or one of `pending` / `fallback` / `skipped`, it has taken fewer than 3 attempts, and it is a primary-layer thought.
  - `'skipped'` is included **deliberately**: `skip_classification` at capture time is a speed choice, not a never-enrich choice. A source that wants a permanent exemption must set status `'exempt'` (which this predicate does not match).
  - Derived-layer rows are excluded (`COALESCE(derivation_layer, 'primary') = 'primary'`) — compiled or synthesized artifacts are never re-classified.
- **`thoughts_enrichment_stuck`** — rows that exhausted 3 attempts without completing. Surfaced by the weekly auditor; cleared with the reset one-liner below.
- **`claim_thoughts_for_enrichment(p_batch, p_id)`** — `SECURITY DEFINER` RPC that atomically claims a batch using `FOR UPDATE SKIP LOCKED` and stamps a 10-minute lease (`metadata.enrichment_claimed_at`). Safe under concurrent cron ticks, webhook single-id invokes, and the backfill loop running at once. Batch size is clamped to `1..25`. Pass `p_id` to claim exactly one row (the webhook fast path).

### Merge policy (`merge.ts`) — invariants

The write-back is not a blind overwrite. `merge.ts` holds pure, unit-tested functions that enforce:

- **`source_type` is immutable.** The worker never touches it.
- **Readwise type is pinned.** For `source_type = 'readwise'`, the stored `type` stays `'reference'` (highlights are decontextualized quotes); the classifier's opinion is preserved separately as `metadata.classified_type`, never promoted.
- **Union, never replace (cap 12).** `topics`, `tags`, `people`, and `action_items` are unioned with whatever the row already had, deduped, and capped at 12 — enrichment adds, it does not discard existing curation.
- **Fallback writes tracking keys only.** When the classifier can't produce real metadata for a row, the fallback patch writes *only* bookkeeping (`enrichment_status='fallback'`, incremented `enrichment_attempts`, `enrichment_last_error`, `enrichment_attempted_at`). It never writes placeholder/fallback content over the thought.

### The worker (`index.ts`)

The Edge Function claims a batch, enriches each row, and writes patches back.

- **Params:** `?limit=1..25` (default 20); `?id=<uuid>` for the single-row fast path.
- **Auth:** `x-brain-key` header, `Authorization: Bearer`, or `?key=` — all checked against `MCP_ACCESS_KEY` (fail-closed: no key set ⇒ 401).
- **Circuit breaker.** A provider outage must never strand rows at max attempts. The tick aborts if **any** row returns a run-level error (`no_provider_configured`, `call_budget_exhausted`, `classifier_disabled`) *or* if the first `min(5, claimed)` rows **all** come back fallback (a whole-probe failure with more than one row to judge on). On a break the worker clears the claim lease for every row it claimed-but-never-wrote and consumes **zero** attempts for them.
- **Response.** `{ run_id, claimed, enriched, fallback, circuit_broken, remaining }`. `remaining` is the live count from `thoughts_needing_enrichment`; `remaining = -1` is a sentinel meaning the count query failed (count unknown), **not** "queue empty".

### How rows get onto the queue

- **Readwise capture** (`integrations/readwise-capture`) stamps `enrichment_status='pending'` on ingest and fire-and-forgets a single-`id` invoke of this worker, so new highlights enrich within seconds. `recipes/readwise-import/import-readwise.py` stamps the same on bulk import.
- Anything else that lands with `NULL` / `pending` / `fallback` / `skipped` status is picked up by the 15-minute cron tick or a manual backfill.
- The editorial-policy weekly auditor reports the backlog as `un-enriched: N (M stuck-at-max)`.

### Synthesis artifacts (never enrich these)

Generated / compiled rows — audit reports, morning/weekly briefings, wiki and topic pages, and any other LLM-synthesized output — must **never** be re-classified by this worker. Re-running a synthesis product through `extractMetadata` would overwrite curated synthesis metadata with a generic capture classification. Writers of such rows (via `recipes/editorial-policy/_shared/derived-thought-writer.ts`) stamp two independent guards:

- **`metadata.enrichment_status = 'exempt'`** — the belt. The queue predicate excludes `'exempt'` directly, so it holds even if the provenance columns aren't installed.
- **`derivation_layer = 'derived'` + `derivation_method = 'synthesis'`** — the suspenders (provenance columns).

The queue predicate additionally excludes any row carrying a `metadata.generator` key (`AND NOT (metadata ? 'generator')`) — synthesis writers stamp a `generator` (e.g. `"auditor"`), so this is a third, schema-independent layer of defense.

If you installed this worker after synthesis rows already existed, backfill the exemption once (an enumerated-or-predicate `UPDATE`). Review the match set first, then run it manually — this repo does **not** run it for you:

```sql
-- Backfill: mark pre-existing synthesis artifacts exempt so they never enqueue.
UPDATE thoughts
SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"enrichment_status":"exempt"}'::jsonb
WHERE (
        metadata ? 'generator'                          -- has a synthesis generator key
        OR COALESCE(derivation_layer, 'primary') = 'derived'
        OR metadata->>'type' IN ('audit_report', 'connection_digest',
                                 'morning_briefing', 'weekly_summary',
                                 'wiki_page', 'topic_page', 'dossier')
      )
  AND COALESCE(metadata->>'enrichment_status', '') <> 'exempt';
```

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- **Enhanced MCP server** installed (`integrations/enhanced-mcp`) — this worker vendors its `_shared/` config and helpers, and the drift-guard test compares against it.
- `pg_cron` and `pg_net` extensions enabled (Database → Extensions) for scheduled ticks.
- An LLM key for the `extractMetadata` cascade: `OPENROUTER_API_KEY` (recommended), or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`.
- Supabase CLI installed for deployment; Deno for running the tests.

## Steps

Install in this order — the worker cannot claim rows until the schema exists, and scheduling before the worker is deployed just produces failing ticks:

1. **`schema.sql`** — run in the Supabase SQL Editor to create the views and claim RPC.
2. **Deploy the worker** — deploy the Edge Function and set secrets.
3. **`schedule.sql`** — register the 15-minute pg_cron tick.
4. **`backfill.sh`** — optionally drain any pre-existing backlog immediately.

### 1. Install the Schema

Run `integrations/enrichment-worker/schema.sql` in the Supabase SQL Editor. It creates two views and the `claim_thoughts_for_enrichment` RPC (execute granted to `service_role` only).

### 2. Deploy the Worker

Copy the folder into your Supabase functions directory and deploy. The `_shared/` folder is identical to the enhanced MCP server's — if you already have it deployed, you do not need a second copy.

```bash
cp -r integrations/enrichment-worker supabase/functions/enrichment-worker
cp -r integrations/enhanced-mcp/_shared supabase/functions/_shared

supabase functions deploy enrichment-worker --no-verify-jwt

supabase secrets set \
  MCP_ACCESS_KEY="your-access-key" \
  OPENROUTER_API_KEY="your-openrouter-key"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform. Optional multi-provider fallback: also set `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`.

Smoke-test a single tick:

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/enrichment-worker?limit=5" \
  -H "x-brain-key: your-access-key"
# => {"run_id":"…","claimed":5,"enriched":5,"fallback":0,"circuit_broken":false,"remaining":…}
```

### 3. Schedule the Tick

Edit `schedule.sql`, replacing `<YOUR-PROJECT-REF>` and `<YOUR-MCP-ACCESS-KEY>`, then run it in the SQL Editor. It registers `enrichment-worker-tick` to POST the function every 15 minutes with `?limit=20`.

The access key is passed in the **`x-brain-key` header, deliberately not in the URL**, so it stays out of request URLs and edge-function URL logs. Note that pg_cron still stores the full command text (headers included) in `cron.job` / `cron.job_run_details`; if that residual matters to you, put the key in Supabase Vault and read it in the job body instead.

### 4. Drain the Backlog (optional)

If you had un-enriched thoughts before installing, drain them with the backfill loop instead of waiting for cron:

```bash
./backfill.sh "https://<project-ref>.supabase.co/functions/v1/enrichment-worker" "your-access-key"
```

It calls the worker repeatedly (`?limit=20`) and stops **only** when `remaining` is exactly `0`. Negative or non-numeric `remaining` values are treated as transient count failures (retry after 30s), not completion. A curl failure retries after 60s. On a circuit break it cools down 300s and retries; five consecutive breaks are treated as a sustained provider outage and the script gives up with a non-zero exit. The script never enables `set -x`, so the key is never echoed.

## Expected Outcome

- New Readwise highlights are enriched within seconds of capture (fire-and-forget), with their native `source_type='readwise'` and pinned `type='reference'` intact and the classifier's guess kept as `metadata.classified_type`.
- Every 15 minutes, up to 20 remaining un-enriched thoughts get real `type`, `summary`, `topics`, `tags`, `people`, and `action_items` in place.
- Existing curation (tags/topics/people/action_items you already set) is preserved — enrichment unions, capped at 12 per list.
- Rows that repeatedly fail to classify stop after 3 attempts and surface in `thoughts_enrichment_stuck` and the auditor's `stuck-at-max` count, rather than being retried forever.

## The Vendored `_shared/` Rule

`_shared/config.ts` and `_shared/helpers.ts` are **vendored copies** of `integrations/enhanced-mcp/_shared/`. Keeping the enrichment cascade byte-identical to the MCP server's is the whole point — the two must classify the same way.

- **Never hand-edit** the files in `enrichment-worker/_shared/`. To pick up an upstream change, re-copy from the canonical source:

  ```bash
  cp integrations/enhanced-mcp/_shared/{config.ts,helpers.ts} \
     integrations/enrichment-worker/_shared/
  ```

- `shared_sync_test.ts` is a drift guard: `deno test` fails if the vendored files diverge from `enhanced-mcp/_shared/`. If it fails, re-run the `cp` above — do not edit the vendored copy to make the test pass.

## Tests

```bash
cd integrations/enrichment-worker
deno test --allow-read
```

This runs the merge-policy unit tests (`merge_test.ts`) and the vendored-`_shared/` drift guard (`shared_sync_test.ts`) — 11 tests total, no network required.

## Troubleshooting

**Issue: response has `circuit_broken: true`**
Either a provider is down / misconfigured, or the LLM call budget is exhausted (`call_budget_exhausted`). The tick aborted deliberately without consuming row attempts, so nothing is stranded. Check the affected rows' `metadata.enrichment_last_error`, confirm your `OPENROUTER_API_KEY` (and any fallback keys) are set, and check the Supabase function logs. When the provider recovers, the next tick picks up right where it left off.

**Issue: a row is stuck and won't re-enrich**
It has hit 3 attempts and dropped off the queue (visible in `thoughts_enrichment_stuck`). Reset it by clearing the attempt counter:

```sql
UPDATE thoughts SET metadata = metadata - 'enrichment_attempts' WHERE id = '<uuid>';
```

**Issue: `backfill.sh` never says "queue drained"**
It stops only on `remaining == 0`. If it keeps warning about non-numeric or negative `remaining`, the worker's count query is failing (returning the `-1` sentinel) — check the function logs and that the `thoughts_needing_enrichment` view exists. If it is cooling down repeatedly on circuit breaks, that is a provider outage; it gives up after five consecutive breaks.

**Issue: `deno test` fails on the vendored `_shared/` check**
The vendored copy drifted from `enhanced-mcp/_shared/`. Re-copy per the [vendored `_shared/` rule](#the-vendored-_shared-rule) — never edit the vendored files by hand.

**Issue: worker returns 401**
`MCP_ACCESS_KEY` is unset (auth fails closed) or your `x-brain-key` / bearer / `?key=` value does not match it.

## Architecture

```
enrichment-worker/
  _shared/            # Vendored from enhanced-mcp/_shared (never hand-edit)
    config.ts         # Constants, models, prompt, patterns
    helpers.ts        # Type coercion, embedding, extractMetadata
  schema.sql          # 2 views + claim_thoughts_for_enrichment RPC
  merge.ts            # Pure merge-policy functions (normative)
  merge_test.ts       # Merge-policy unit tests
  index.ts            # Edge Function: claim loop + circuit breaker
  schedule.sql        # 15-min pg_cron tick (x-brain-key header auth)
  backfill.sh         # Backlog drain loop
  shared_sync_test.ts # Drift guard: vendored _shared/ == enhanced-mcp/_shared/
  deno.json           # Deno configuration
  metadata.json       # OB1 contribution metadata
  README.md           # This file
```

This is an optional hygiene enhancement — it is not required for the core Open Brain alpha path. Install it after the enhanced MCP server when you want un-enriched thoughts (raw imports, skipped or failed classifications) brought up to full metadata automatically.
