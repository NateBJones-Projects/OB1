-- ============================================================
-- brain-health-monitor: cron observability + alert state
-- Run this in your Supabase SQL Editor (one-time setup, safe to re-run).
--
-- Core idea: pg_cron's job_run_details records 'succeeded' when the HTTP
-- request was QUEUED by pg_net — not when your Edge Function returned 2xx.
-- A function can fail every run for weeks while cron shows green. This
-- schema stores the request id of every scheduled call so outcomes can be
-- joined back deterministically, harvests them before pg_net purges its
-- response table, and gives the monitor function alert-dedup state.
--
-- Requires: pg_cron + pg_net extensions (Database → Extensions).
-- Optional pieces (entity queue view) are guarded and skip with a NOTICE.
-- ============================================================

-- Every scheduled invocation, with the pg_net request id captured.
CREATE TABLE IF NOT EXISTS ops_cron_invocations (
  id bigserial PRIMARY KEY,
  jobname text NOT NULL,
  request_id bigint NOT NULL,
  invoked_at timestamptz NOT NULL DEFAULT now(),
  -- harvested from net._http_response before pg_net's TTL purges it
  status_code int,
  response_preview text,
  harvested_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ops_cron_invocations_time
  ON ops_cron_invocations (invoked_at DESC);

-- Wrapper every scheduled job should call instead of bare net.http_post.
CREATE OR REPLACE FUNCTION ops_http_post_logged(
  p_jobname text, p_url text, p_headers jsonb, p_body jsonb,
  p_timeout_ms integer DEFAULT 120000
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_req bigint;
BEGIN
  v_req := net.http_post(url := p_url, headers := p_headers, body := p_body,
                         timeout_milliseconds := p_timeout_ms);
  INSERT INTO ops_cron_invocations (jobname, request_id) VALUES (p_jobname, v_req);
  RETURN v_req;
END $$;

-- Copy outcomes out of net._http_response (pg_net purges it) into the log.
CREATE OR REPLACE FUNCTION ops_harvest_responses() RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_n int;
BEGIN
  UPDATE ops_cron_invocations i
  SET status_code = r.status_code,
      response_preview = left(coalesce(r.content, r.error_msg, ''), 300),
      harvested_at = now()
  FROM net._http_response r
  WHERE r.id = i.request_id AND i.harvested_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- Failures in the last 24h: bad status, function-reported failure, or no
-- response harvested after a 10-minute grace period.
CREATE OR REPLACE VIEW ops_cron_http_failures AS
SELECT jobname, request_id, invoked_at, status_code, response_preview, failure
FROM (
  SELECT *,
    CASE
      WHEN harvested_at IS NULL AND invoked_at < now() - interval '10 minutes'
        THEN 'no_response_recorded'
      WHEN harvested_at IS NOT NULL AND status_code IS NULL
        THEN 'null_status_timeout_or_error'
      WHEN status_code IS NOT NULL AND status_code NOT BETWEEN 200 AND 299
        THEN 'http_' || status_code
      WHEN response_preview LIKE '%"ok":false%'
        THEN 'function_reported_not_ok'
      ELSE NULL
    END AS failure
  FROM ops_cron_invocations
  WHERE invoked_at > now() - interval '24 hours'
) x
WHERE failure IS NOT NULL;

-- Thoughts invisible to semantic search.
CREATE OR REPLACE VIEW ops_null_embeddings AS
SELECT id, created_at, metadata->>'source' AS source, left(content,120) AS preview
FROM thoughts WHERE embedding IS NULL
ORDER BY created_at DESC;

-- Entity queue poison / stalled items (requires schemas/entity-extraction).
DO $$
BEGIN
  IF to_regclass('public.entity_extraction_queue') IS NOT NULL THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW ops_queue_poison AS
      SELECT thought_id, status, attempt_count,
             left(coalesce(last_error,''),160) AS last_error, queued_at, started_at
      FROM entity_extraction_queue
      WHERE status = 'failed'
         OR (status = 'processing' AND started_at < now() - interval '10 minutes')
         OR (status = 'pending' AND attempt_count >= 3);
    $v$;
  ELSE
    RAISE NOTICE 'entity_extraction_queue absent — ops_queue_poison view skipped';
  END IF;
END $$;

-- Alert dedup: one row per alert_key; the monitor pages only past a cooldown.
-- Reserved keys: '_heartbeat' (weekly all-green), '_backup_receipt' (opt-in —
-- seed it if you run a scheduled backup and want staleness paging).
CREATE TABLE IF NOT EXISTS ops_alert_state (
  alert_key text PRIMARY KEY,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  last_paged_at timestamptz,
  details jsonb
);

-- Longitudinal health snapshots (a separate table on purpose — operational
-- exhaust must not pollute the thoughts table or feed synthesis).
CREATE TABLE IF NOT EXISTS ops_health_snapshots (
  id bigserial PRIMARY KEY,
  taken_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL
);

-- Bounded retention for operational exhaust (schedule monthly; see schedule.sql).
CREATE OR REPLACE FUNCTION ops_retention_purge()
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_cron int; v_http int; v_inv int; v_snap int;
BEGIN
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '30 days';
  GET DIAGNOSTICS v_cron = ROW_COUNT;
  DELETE FROM net._http_response WHERE created < now() - interval '7 days';
  GET DIAGNOSTICS v_http = ROW_COUNT;
  DELETE FROM ops_cron_invocations WHERE invoked_at < now() - interval '90 days';
  GET DIAGNOSTICS v_inv = ROW_COUNT;
  DELETE FROM ops_health_snapshots WHERE taken_at < now() - interval '180 days';
  GET DIAGNOSTICS v_snap = ROW_COUNT;
  RETURN jsonb_build_object('cron_run_details', v_cron, 'http_responses', v_http,
                            'cron_invocations', v_inv, 'health_snapshots', v_snap);
END $$;
