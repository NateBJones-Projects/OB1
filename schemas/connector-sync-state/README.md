# Connector Sync State

> One small table so every capture connector knows where it left off and whether its last run failed.

## What It Does

Any connector that pulls from an external source on a schedule — an email importer, a calendar poller, an RSS reader, a webhook receiver, a one-off backfill — needs the same bookkeeping:

- a **cursor** (a resume token or high-watermark) so the next run continues instead of re-reading everything,
- **timestamps** for when it last started, finished, and last succeeded, and
- the **last error** plus a running **error count**, so a connector that has stalled or started failing can be spotted and alerted on.

Writing that bookkeeping table once per connector gets repetitive and inconsistent. This schema gives you one generic table that every connector shares, plus three RPCs that wrap the begin / success / error transitions so a connector never has to hand-write the upsert.

It installs:

- **`public.connector_sync_state`** — one row per `(connector, surface, sync_key)`. The row holds the cursor, the high-watermark, the four lifecycle timestamps, the last error, the error count, and two free-form `jsonb` columns (`counters`, `metadata`) for run statistics or connector-specific config.
- **`connector_sync_begin(connector, surface, sync_key)`** — call at the start of a run. Creates the row on first use, otherwise stamps `last_started_at` and sets `status = 'running'`. Returns the row id.
- **`connector_sync_success(connector, surface, sync_key, cursor_value, high_watermark, counters)`** — call when a run finishes cleanly. Advances the cursor / high-watermark, stamps success, resets `error_count` to `0`, clears `last_error`, and merges `counters`.
- **`connector_sync_error(connector, surface, sync_key, error)`** — call when a run fails. Stamps the error, increments `error_count`, and **leaves the cursor untouched** so the next run retries from the last known-good position instead of skipping the failed window.

### The identity model: connector / surface / sync_key

The natural key is three parts so it fits anything from a trivial poller to a multi-account connector:

- **`connector`** — which connector this is, e.g. `example_email`, `example_calendar`.
- **`surface`** — a named stream within that connector, e.g. `inbox`, `calendar:primary`, `webhook`. Use `'default'` when a connector has only one stream.
- **`sync_key`** — the specific cursor scope within the surface, e.g. an account id, a folder, or a label. Use `'default'` when there is only one.

A surfaced `BIGINT id` is the primary key (so other operational tables can reference a sync-state row cheaply), while the `UNIQUE (connector, surface, sync_key)` constraint is what the RPCs upsert against. This table is keyed by connector identity, not by any thought — it holds no thought id of any kind, and the canonical `public.thoughts.id` (a `UUID`) never appears here.

## Prerequisites

- A working Open Brain setup ([getting-started guide](../../docs/01-getting-started.md)). This schema does not touch `public.thoughts` — it stands alone — but it is meant to support the connectors that feed your brain.
- Access to the Supabase SQL Editor (or the Supabase CLI) with the service role.
- A `service_role` role (Supabase provides this by default). Connectors run server-side with the service-role key — these RPCs are not exposed to `anon`/`authenticated`.

## Steps

1. Open your **Supabase SQL Editor** (Dashboard → SQL Editor).
2. Paste the full contents of [`schema.sql`](./schema.sql) and run it. The script is idempotent — it uses `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `CREATE OR REPLACE FUNCTION`, so re-running it is safe.
3. Confirm the table and RPCs exist:

   ```sql
   SELECT to_regclass('public.connector_sync_state') AS state_table;

   SELECT proname
   FROM pg_proc
   WHERE proname IN ('connector_sync_begin', 'connector_sync_success', 'connector_sync_error')
   ORDER BY proname;
   ```

4. (Optional) Confirm the table is service-role only:

   ```sql
   SELECT grantee, privilege_type
   FROM information_schema.role_table_grants
   WHERE table_name = 'connector_sync_state';
   ```

Or, if you keep migrations in `supabase/migrations/`, apply via the CLI:

```bash
supabase db push
```

## How a Connector Uses It

The lifecycle of one connector run is begin → do the work → success or error:

1. **Begin.** Call `connector_sync_begin(connector, surface, sync_key)`. On the first run it creates the row; on every run it sets `status = 'running'` and `last_started_at`.
2. **Read your resume point.** Read the row's `cursor_value` / `high_watermark` and ask the source API only for items newer than that.
3. **Do the work.** Fetch, transform, and capture into your brain however that connector normally does.
4. **On success**, call `connector_sync_success(...)` with the new `cursor_value` and/or `high_watermark`. This advances the cursor, resets the error count, and clears the last error.
5. **On failure**, call `connector_sync_error(...)` with the error message. The cursor is left as-is so the next run retries from the last good position.

### Minimal connector example (Node)

A dependency-free sketch of a connector that polls an example source and records its state through the RPCs. Configure it entirely through environment variables — no endpoints or keys are hardcoded.

```js
// connector.mjs — run with: node connector.mjs
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL = requireEnv("SUPABASE_URL");          // e.g. https://YOUR-PROJECT.supabase.co
const SERVICE_KEY  = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const CONNECTOR = "example_email";
const SURFACE   = "inbox";
const SYNC_KEY  = "default";

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
  // success/error RPCs return no body; begin returns the row id.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Read the current cursor so we resume instead of re-reading from the start.
async function readCursor() {
  const url =
    `${SUPABASE_URL}/rest/v1/connector_sync_state` +
    `?select=cursor_value,high_watermark` +
    `&connector=eq.${CONNECTOR}&surface=eq.${SURFACE}&sync_key=eq.${SYNC_KEY}`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const rows = res.ok ? await res.json() : [];
  return rows[0] ?? { cursor_value: null, high_watermark: null };
}

async function run() {
  await rpc("connector_sync_begin", {
    p_connector: CONNECTOR,
    p_surface: SURFACE,
    p_sync_key: SYNC_KEY,
  });

  try {
    const { cursor_value } = await readCursor();

    // Replace this with your real fetch: pull items newer than cursor_value,
    // capture them into your brain, and return the new cursor + a count.
    const { nextCursor, fetched } = await fetchSince(cursor_value);

    await rpc("connector_sync_success", {
      p_connector: CONNECTOR,
      p_surface: SURFACE,
      p_sync_key: SYNC_KEY,
      p_cursor_value: nextCursor,
      p_high_watermark: new Date().toISOString(),
      p_counters: { fetched },
    });
  } catch (err) {
    await rpc("connector_sync_error", {
      p_connector: CONNECTOR,
      p_surface: SURFACE,
      p_sync_key: SYNC_KEY,
      p_error: String(err).slice(0, 1000),
    });
    throw err;
  }
}

// Placeholder — your connector's real source call goes here.
async function fetchSince(cursor) {
  return { nextCursor: cursor ?? "page-1", fetched: 0 };
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

```bash
SUPABASE_URL="https://YOUR-PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" \
node connector.mjs
```

### Pairing with Brain Health Monitoring

This table is the data source for connector alerting. The companion **Brain Health Monitoring** recipe (`recipes/brain-health-monitoring/`, [OB1 #194](https://github.com/NateBJones-Projects/OB1/pull/194)) adds operational views over your brain; point a health view or a scheduled check at `connector_sync_state` to surface connectors that are stalled or failing. Two queries do most of the work:

```sql
-- Connectors whose last run errored, worst offenders first.
SELECT connector, surface, sync_key, last_error, error_count, last_error_at
FROM public.connector_sync_state
WHERE status = 'error'
ORDER BY error_count DESC, last_error_at DESC;

-- Stalled connectors: succeeded once, but nothing fresh in over a day.
SELECT connector, surface, sync_key, last_success_at
FROM public.connector_sync_state
WHERE last_success_at < now() - interval '1 day'
ORDER BY last_success_at ASC;
```

Wrap either as a view (or a `brain-health-monitoring` ops view) and alert when it returns rows: a non-empty first query means a connector is erroring; a non-empty second means one has gone quiet.

## Expected Outcome

After running the migration:

- A table `public.connector_sync_state` exists with a surfaced `BIGINT id` primary key, a `UNIQUE (connector, surface, sync_key)` constraint, a `status` check constraint (`pending` / `running` / `success` / `error`), RLS enabled, and `SELECT, INSERT, UPDATE, DELETE` granted to `service_role` only.
- Three indexes exist: `idx_connector_sync_state_connector_surface`, `idx_connector_sync_state_status`, and the GIN `idx_connector_sync_state_metadata_gin`.
- Three RPCs exist — `connector_sync_begin`, `connector_sync_success`, `connector_sync_error` — each `SECURITY INVOKER`, executable by `service_role` only.
- A connector that calls begin → success advances its cursor and resets its error count; a connector that calls begin → error increments its error count and leaves the cursor untouched for retry.
- No column on `public.thoughts` is altered or dropped — this schema is standalone and additive, and stores no thought ids.
- PostgREST's schema cache is reloaded (`NOTIFY pgrst, 'reload schema'`).

## Rollback

To remove the sync-state system entirely:

```sql
DROP FUNCTION IF EXISTS public.connector_sync_begin(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.connector_sync_success(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB);
DROP FUNCTION IF EXISTS public.connector_sync_error(TEXT, TEXT, TEXT, TEXT);
DROP TABLE IF EXISTS public.connector_sync_state;

NOTIFY pgrst, 'reload schema';
```

Dropping the table removes all connector cursors and run history. It does not touch `public.thoughts`.

## Troubleshooting

**Issue: a connector keeps re-reading from the beginning every run.**
It is not persisting a cursor. Make sure the run calls `connector_sync_success` with a non-null `p_cursor_value` (or `p_high_watermark`), and that the next run reads it back before fetching. `connector_sync_error` deliberately leaves the cursor unchanged, so a connector stuck in a failure loop will keep retrying the same window — fix the underlying error.

**Issue: `error_count` never resets.**
`error_count` is reset to `0` only by `connector_sync_success`. If a connector is erroring on every run, the count climbs until a clean run succeeds — that is the signal a health check should alert on.

**Issue: two surfaces of the same connector overwrite each other's cursor.**
They are sharing a `(connector, surface, sync_key)` key. Give each independent stream a distinct `surface` or `sync_key` (for example one row per account id) so each keeps its own cursor.

**Issue: PostgREST does not see the new RPCs.**
The migration emits `NOTIFY pgrst, 'reload schema'`. If it does not take effect, reload from Dashboard → Project Settings → API → Reload schema.
