-- ============================================================
-- Schedule weekly auditor via pg_cron
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
-- Default timing: Sunday 09:00 UTC. Adjust the cron expression
-- to fit your weekly summary schedule. The auditor should run BEFORE
-- the weekly summary so it has the full week to inspect.
-- ============================================================

SELECT cron.schedule(
  'weekly-auditor',
  '0 9 * * 0',
  $$
  SELECT net.http_post(
    -- Auth via x-brain-key header (not ?key= in the URL) so the secret stays out of
    -- request URLs and edge-function URL logs. Note: pg_cron still stores the full
    -- command (headers included) in cron.job/cron.job_run_details; use Supabase Vault
    -- if that residual matters to you.
    url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/auditor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-brain-key', '<YOUR-MCP-ACCESS-KEY>'
    ),
    body := jsonb_build_object(
      'days', 30,
      'post_to_slack', true,
      'dry_run', false,
      'prior_audit_count', 4
    )
  );
  $$
);

-- ============================================================
-- Verify scheduled:
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'weekly-auditor';
--
-- Run history:
--   SELECT jobname, start_time, status, return_message
--   FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'weekly-auditor')
--   ORDER BY start_time DESC LIMIT 5;
--
-- Manual test (dry run, no Slack post, no audit_report stored):
--   SELECT net.http_post(
--     url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/auditor',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-brain-key', '<YOUR-MCP-ACCESS-KEY>'),
--     body := jsonb_build_object('days', 30, 'post_to_slack', false, 'dry_run', true)
--   );
--
-- Remove the schedule (if needed):
--   SELECT cron.unschedule('weekly-auditor');
-- ============================================================
