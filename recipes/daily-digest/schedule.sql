-- ============================================================
-- Schedule the daily digest via pg_cron
-- Run this in your Supabase SQL Editor (one-time setup).
--
-- BEFORE RUNNING:
--   Replace <YOUR-PROJECT-REF> with your Supabase project reference.
--   Replace <YOUR-DIGEST-KEY> with the value of your DIGEST_ACCESS_KEY
--   secret (any random string you choose — used to gate the function URL).
-- ============================================================
--
-- Prerequisites:
--   pg_cron + pg_net extensions enabled.
--   To enable: Database → Extensions → search for pg_cron and pg_net → enable both.
--
-- Default timing: 07:00 UTC daily. Adjust the cron expression to
-- land the email in your morning (e.g. '0 12 * * *' for 7am US Eastern).
-- ============================================================

SELECT cron.schedule(
  'daily-digest',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/daily-digest?key=<YOUR-DIGEST-KEY>',
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'hours', 24
    )
  );
  $$
);

-- ============================================================
-- Verify scheduled:
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'daily-digest';
--
-- Run history:
--   SELECT jobname, start_time, status, return_message
--   FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'daily-digest')
--   ORDER BY start_time DESC LIMIT 5;
--
-- Manual test (returns the digest as JSON instead of emailing it):
--   SELECT net.http_post(
--     url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/daily-digest?key=<YOUR-DIGEST-KEY>',
--     headers := jsonb_build_object('Content-Type', 'application/json'),
--     body := jsonb_build_object('hours', 24, 'dry_run', true)
--   );
--
-- Remove the schedule (if needed):
--   SELECT cron.unschedule('daily-digest');
-- ============================================================
