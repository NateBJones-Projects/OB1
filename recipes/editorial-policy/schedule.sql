-- ============================================================
-- Schedule weekly auditor via pg_cron
-- Run this in your Supabase SQL Editor (one-time setup).
--
-- BEFORE RUNNING:
--   Replace <YOUR-PROJECT-REF> with your Supabase project reference.
--   Store your AUDITOR_ACCESS_KEY in Supabase Vault (step 0 below) so the
--   key is read at fire time instead of being pasted into the job command.
-- ============================================================
--
-- Prerequisites:
--   pg_cron + pg_net extensions enabled.
--   To enable: Database → Extensions → search for pg_cron and pg_net → enable both.
--
-- SECURITY NOTE — why header auth + Vault, not ?key= in the URL:
--   A key embedded in the URL is stored verbatim in cron.job.command (readable
--   by anyone with SQL access) AND appears in Supabase's function-invocation
--   logs on every run. Passing the key as a request header, read from Vault at
--   fire time, keeps it out of both. The auditor accepts the same key via the
--   x-auditor-key header.
--
-- Default timing: Sunday 09:00 UTC. Adjust the cron expression
-- to fit your weekly summary schedule. The auditor should run BEFORE
-- the weekly summary so it has the full week to inspect.
-- ============================================================

-- 0. One-time: store the auditor key in Vault (same value as the
--    AUDITOR_ACCESS_KEY function secret). Run once; to change it later use
--    vault.update_secret rather than re-running create_secret.
-- SELECT vault.create_secret('<YOUR-AUDITOR-KEY>', 'auditor_access_key');

SELECT cron.schedule(
  'weekly-auditor',
  '0 9 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/auditor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-auditor-key', (SELECT decrypted_secret FROM vault.decrypted_secrets
                        WHERE name = 'auditor_access_key')
    ),
    body := jsonb_build_object(
      'days', 30,
      'post_to_slack', true,
      'dry_run', false,
      'prior_audit_count', 4
    ),
    timeout_milliseconds := 150000
  );
  $$
);

-- ============================================================
-- Verify scheduled:
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'weekly-auditor';
--
-- Run history (NOTE: pg_cron records 'succeeded' when the HTTP request was
-- QUEUED, not when the function returned 2xx — check net._http_response for
-- the function-level outcome):
--   SELECT jobname, start_time, status, return_message
--   FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'weekly-auditor')
--   ORDER BY start_time DESC LIMIT 5;
--
-- Manual test (dry run, no Slack post, no audit_report stored):
--   SELECT net.http_post(
--     url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/auditor',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-auditor-key', (SELECT decrypted_secret FROM vault.decrypted_secrets
--                         WHERE name = 'auditor_access_key')
--     ),
--     body := jsonb_build_object('days', 30, 'post_to_slack', false, 'dry_run', true)
--   );
--
-- Remove the schedule (if needed):
--   SELECT cron.unschedule('weekly-auditor');
-- ============================================================
