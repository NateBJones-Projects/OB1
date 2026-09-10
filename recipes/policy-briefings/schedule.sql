-- ============================================================
-- Schedule the policy-briefings synthesis functions via pg_cron.
-- Run this in your Supabase SQL Editor (one-time setup).
--
-- BEFORE RUNNING:
--   Replace <YOUR-PROJECT-REF> with your Supabase project reference.
--   Store your SYNTHESIS_ACCESS_KEY in Supabase Vault (step 0 below) so the
--   key is read at fire time instead of being pasted into the job command.
--
-- SECURITY NOTE — why header auth + Vault, not ?key= in the URL:
--   A key embedded in the URL is stored verbatim in cron.job.command (readable
--   by anyone with SQL access) AND appears in Supabase's function-invocation
--   logs on every run. Passing the key as a request header, read from Vault at
--   fire time, keeps it out of both. Both functions accept the same key via
--   the x-synthesis-key header.
-- ============================================================
--
-- Prerequisites:
--   pg_cron + pg_net extensions enabled.
--   Database → Extensions → enable pg_cron and pg_net.
--
-- TIMEZONE NOTE: cron fires in UTC. The times below assume US Central and
-- fire the morning briefing at 7:00am CDT (6:00am CST after DST). Adjust the
-- cron expressions to your own local morning. If you also run the
-- editorial-policy auditor, schedule the weekly summary AFTER the auditor so
-- the auditor inspects the full week before the summary is written.
-- ============================================================

-- 0. One-time: store the synthesis key in Vault (same value as the
--    SYNTHESIS_ACCESS_KEY function secret). Run once; to change it later use
--    vault.update_secret rather than re-running create_secret.
-- SELECT vault.create_secret('<YOUR-SYNTHESIS-KEY>', 'synthesis_access_key');

-- Daily morning briefing — 12:00 UTC (7am CDT). Window: last 1 day.
SELECT cron.schedule(
  'daily-morning-briefing',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/morning-briefing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-synthesis-key', (SELECT decrypted_secret FROM vault.decrypted_secrets
                          WHERE name = 'synthesis_access_key')
    ),
    body := jsonb_build_object('days', 1, 'post_to_slack', true, 'dry_run', false),
    timeout_milliseconds := 120000
  );
  $$
);

-- Weekly summary — Sunday 13:00 UTC (8am CDT), after the 09:00 UTC auditor.
-- Window: last 7 days.
SELECT cron.schedule(
  'weekly-summary',
  '0 13 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/weekly-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-synthesis-key', (SELECT decrypted_secret FROM vault.decrypted_secrets
                          WHERE name = 'synthesis_access_key')
    ),
    body := jsonb_build_object('days', 7, 'post_to_slack', true, 'dry_run', false),
    timeout_milliseconds := 120000
  );
  $$
);

-- ============================================================
-- Verify scheduled:
--   SELECT jobname, schedule, active FROM cron.job
--   WHERE jobname IN ('daily-morning-briefing', 'weekly-summary');
--
-- Manual test (dry run: no store, no Slack post):
--   SELECT net.http_post(
--     url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/weekly-summary',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-synthesis-key', (SELECT decrypted_secret FROM vault.decrypted_secrets
--                           WHERE name = 'synthesis_access_key')
--     ),
--     body := jsonb_build_object('days', 7, 'post_to_slack', false, 'dry_run', true)
--   );
--
-- Remove a schedule:
--   SELECT cron.unschedule('daily-morning-briefing');
--   SELECT cron.unschedule('weekly-summary');
-- ============================================================
