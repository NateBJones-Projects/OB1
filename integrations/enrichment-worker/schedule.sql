-- ============================================================
-- enrichment-worker / schedule.sql
-- Every 15 minutes, drain up to 20 thoughts through the enrichment worker.
-- Run this in your Supabase SQL Editor (one-time setup).
--
-- BEFORE RUNNING:
--   Replace <YOUR-PROJECT-REF> with your Supabase project reference.
--   Replace <YOUR-MCP-ACCESS-KEY> with the value of your MCP_ACCESS_KEY
--   secret (used to gate the function via the x-brain-key header).
-- ============================================================
--
-- Prerequisites:
--   pg_cron + pg_net extensions enabled.
--   To enable: Database → Extensions → search for pg_cron and pg_net → enable both.
--
-- Default timing: every 15 minutes. Each tick enriches up to 20 pending
-- thoughts. Adjust the cron expression / limit to fit your backlog size.
-- ============================================================

SELECT cron.schedule(
  'enrichment-worker-tick',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    -- Auth via x-brain-key header (not ?key= in the URL) so the secret stays out of
    -- request URLs and edge-function URL logs. Note: pg_cron still stores the full
    -- command (headers included) in cron.job/cron.job_run_details; use Supabase Vault
    -- if that residual matters to you.
    url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/enrichment-worker?limit=20',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-brain-key', '<YOUR-MCP-ACCESS-KEY>'),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================
-- Verify scheduled:
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'enrichment-worker-tick';
--
-- Run history:
--   SELECT jobname, start_time, status, return_message
--   FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'enrichment-worker-tick')
--   ORDER BY start_time DESC LIMIT 5;
--
-- Manual test (fires one tick immediately):
--   SELECT net.http_post(
--     url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/enrichment-worker?limit=20',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-brain-key', '<YOUR-MCP-ACCESS-KEY>'),
--     body := '{}'::jsonb
--   );
--
-- Remove the schedule (if needed):
--   SELECT cron.unschedule('enrichment-worker-tick');
-- ============================================================
