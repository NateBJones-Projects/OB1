# Brain Health Monitor

> Hourly ops probe that makes cron→function outcomes observable, pages Slack only on critical breaches, and sends a weekly all-green heartbeat so a dead monitor can't masquerade as a healthy brain.

## What It Does

An Open Brain that runs on schedules (auditor, briefings, entity workers, consolidation) has a blind spot: **pg_cron's `job_run_details` records `succeeded` when the HTTP request was *queued* by pg_net — not when your Edge Function returned 2xx.** A function can fail every run for weeks while every cron dashboard shows green. This was observed live: a run whose function body returned `{"succeeded":0,"failed":2}` was logged `succeeded`.

This recipe closes that gap with three pieces:

1. **`schema.sql`** — a logged wrapper (`ops_http_post_logged`) that stores the pg_net request id of every scheduled call; a harvester that copies outcomes out of `net._http_response` before pg_net purges it; read-only failure/health views; an alert-state table (per-alert page cooldown); a snapshots table for trends; and a bounded retention function.
2. **`monitor/index.ts`** — an Edge Function that runs hourly: harvest → evaluate critical checks → page Slack **only on breach** (24h per-alert cooldown) → weekly all-green heartbeat → store a snapshot.
3. **`schedule.sql`** — pg_cron entries for the monitor and the monthly retention purge, plus a template for migrating your existing jobs onto the logged wrapper.

### The checks

| Check | Source | Pages when |
|---|---|---|
| Cron/function failures (24h) | `ops_cron_http_failures` | non-2xx, `"ok":false` body, or no response after a 10-min grace |
| Entity queue poison | `ops_queue_poison` *(skipped if entity-extraction schema absent)* | items `failed`, stalled `processing` >10m, or ≥3 retry attempts |
| Missing embeddings | `ops_null_embeddings` | any thought without an embedding for >1h (semantic-search invisible) |
| Missing fingerprints / duplicate entity groups | `lint_hygiene_summary()` *(skipped unless editorial-policy `hygiene.sql` installed)* | any occurrence — these are structurally prevented on hardened installs, so >0 means a guard regressed |
| Backup staleness | `_backup_receipt` row in `ops_alert_state` *(opt-in — only checked if the row exists)* | receipt older than 36h |

### The dead-man switch

Silence-means-healthy has a failure mode: if the monitor itself dies, silence is indistinguishable from health. So when everything is green, the monitor sends one **weekly heartbeat** (`:stethoscope: all green`). Breach → page within the hour; health → one heartbeat a week; heartbeat missing → the monitor is dead. Every state has a distinguishable signal.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- `pg_cron` + `pg_net` extensions enabled
- Slack bot token (same setup as the editorial-policy auditor)
- Optional: [editorial-policy `hygiene.sql`](../editorial-policy/) for the fingerprint/entity-dedup checks
- Optional: `schemas/entity-extraction` for the queue-poison check

## Steps

### Step 1: Apply the schema

Run `schema.sql` in the SQL Editor. Optional pieces (queue-poison view) skip with a `NOTICE` when their tables are absent. Safe to re-run.

### Step 2: Deploy the monitor

```bash
# from this recipe folder
supabase functions deploy brain-health-monitor --project-ref <YOUR-PROJECT-REF> --no-verify-jwt
```

(`--no-verify-jwt` because the function does its own auth: `x-brain-key` matched against the `MCP_ACCESS_KEY` secret.) Confirm the secrets `MCP_ACCESS_KEY`, `SLACK_BOT_TOKEN`, and `SLACK_CAPTURE_CHANNEL` (or `SLACK_OPS_CHANNEL`) are set.

### Step 3: Schedule it

Run `schedule.sql` (replace the placeholders). It schedules the monitor hourly and the retention purge monthly, both through the logged wrapper.

### Step 4: Migrate your existing jobs onto the logged wrapper

The monitor can only see invocations that go through `ops_http_post_logged`. Recreate each existing `cron.schedule` using the template at the bottom of `schedule.sql` — same schedule, same body, same header auth, just wrapped. Until a job is migrated, its function-level failures remain invisible.

### Step 5: Prove the pager works

Don't trust theory — manufacture a failure:

```sql
SELECT ops_http_post_logged('zz-forced-failure-test',
  'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/nonexistent-function',
  '{"Content-Type":"application/json"}'::jsonb, '{}'::jsonb, 15000);
```

Wait ~30 seconds, invoke the monitor once, and confirm the `:rotating_light:` page arrives in Slack. Then clean up (deletes are in `schedule.sql`'s comments). The first healthy run also sends the initial heartbeat, which proves the green path.

### Step 6 (optional): Wire in your backup

If you run a scheduled backup, have it PATCH the receipt on every success:

```sql
-- seed once (opt-in):
INSERT INTO ops_alert_state (alert_key, last_paged_at, details)
VALUES ('_backup_receipt', now(), '{"note":"seeded"}'::jsonb)
ON CONFLICT (alert_key) DO NOTHING;
```

Your backup job then updates `last_paged_at` via PostgREST after each successful run; the monitor pages if it goes stale (>36h). Seeding at setup time means a backup pipeline that *never works* also pages — a silently broken backup is impossible.

## Expected Outcome

- Hourly monitor runs, visible in `ops_health_snapshots` (one row per run).
- Zero Slack noise while healthy, except one `:stethoscope:` heartbeat per week.
- Any function-level cron failure, poison queue item, embedding gap, or stale backup pages within the hour, once per 24h per alert.

## Troubleshooting

**Monitor returns 401** — `MCP_ACCESS_KEY` secret not set, or the caller isn't sending `x-brain-key`. Note the function refuses all requests when the secret is unset (fail-closed).

**`ops_cron_http_failures` shows `no_response_recorded` for a job that works** — the job was scheduled with bare `net.http_post` (no request-id captured) or pg_net purged the response before a harvest ran. Migrate the job to `ops_http_post_logged` and keep the monitor hourly.

**Every run of a slow function shows `null_status_timeout_or_error`** — raise the `p_timeout_ms` argument for that job in `schedule.sql`; pg_net's default timeout frequently records NULL status for LLM-heavy functions.

**Heartbeat never arrives** — check `cron.job` has `brain-health-monitor` active, then `SELECT * FROM ops_cron_invocations WHERE jobname='brain-health-monitor' ORDER BY id DESC LIMIT 5;` — the monitor logs its own invocations, so its failures are visible in its own failure view (fetch them manually if it's down).

**Slack post fails** — the bot must be invited to the channel; `SLACK_OPS_CHANNEL` falls back to `SLACK_CAPTURE_CHANNEL`.

## Works Well With

- **[editorial-policy](../editorial-policy/)** — its optional `hygiene.sql` provides `lint_hygiene_summary()`, which unlocks this monitor's fingerprint/entity-dedup regression checks; its auditor covers *content* quality weekly while this recipe covers *pipeline* health hourly.
- **[brain-backup](../brain-backup/)** — schedule it externally (Node — not pg_cron-able) and PATCH the `_backup_receipt` for staleness paging.
- **[brain-health-monitoring](../brain-health-monitoring/)** — the `ops_*` dashboard views complement these alerting views; that recipe answers "show me", this one answers "wake me".
- **[content-fingerprint-dedup](../content-fingerprint-dedup/)** — its write-time trigger is what makes the missing-fingerprint check a regression signal rather than a backlog count.
