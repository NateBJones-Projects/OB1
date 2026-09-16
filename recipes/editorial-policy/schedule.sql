-- ============================================================
-- Schedule weekly auditor via pg_cron
-- Run this in your Supabase SQL Editor (one-time setup).
--
-- BEFORE RUNNING:
--   Replace <YOUR-PROJECT-REF> with your Supabase project reference.
--   Replace <YOUR-AUDITOR-KEY> with the value of your AUDITOR_ACCESS_KEY
--   secret (any random string you choose — used to gate the function URL).
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
    url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/auditor?key=<YOUR-AUDITOR-KEY>',
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
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
--     url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/auditor?key=<YOUR-AUDITOR-KEY>',
--     headers := jsonb_build_object('Content-Type', 'application/json'),
--     body := jsonb_build_object('days', 30, 'post_to_slack', false, 'dry_run', true)
--   );
--
-- Remove the schedule (if needed):
--   SELECT cron.unschedule('weekly-auditor');
-- ============================================================
