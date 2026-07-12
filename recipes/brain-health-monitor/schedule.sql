-- ============================================================
-- Schedule the brain-health-monitor via pg_cron (hourly at :07).
-- Run this in your Supabase SQL Editor (one-time setup).
--
-- BEFORE RUNNING:
--   Replace <YOUR-PROJECT-REF> with your Supabase project reference.
--   Store your MCP access key in Vault once (step 0) so the key is read
--   at fire time — never embed keys in ?key= URLs (they persist in
--   cron.job.command and in invocation logs).
-- ============================================================

-- 0. One-time (skip if you already keep mcp_access_key in Vault):
-- SELECT vault.create_secret('<YOUR-MCP-ACCESS-KEY>', 'mcp_access_key');

-- The monitor schedules itself through ops_http_post_logged so its own
-- invocations are observable too.
SELECT cron.schedule('brain-health-monitor', '7 * * * *', $$
  SELECT ops_http_post_logged('brain-health-monitor',
    'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/brain-health-monitor',
    jsonb_build_object('Content-Type','application/json',
      'x-brain-key', (SELECT decrypted_secret FROM vault.decrypted_secrets
                      WHERE name = 'mcp_access_key')),
    '{}'::jsonb, 60000);
$$);

-- Bounded retention for operational exhaust — monthly, 1st at 02:00 UTC.
SELECT cron.schedule('monthly-retention-purge', '0 2 1 * *',
  'SELECT ops_retention_purge();');

-- ============================================================
-- Migrate your EXISTING jobs onto the logged wrapper so their function-level
-- outcomes become observable (example — repeat per job, keeping each job's
-- schedule/body/timeout):
--
--   SELECT cron.schedule('weekly-auditor', '0 9 * * 0', $$
--     SELECT ops_http_post_logged('weekly-auditor',
--       'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/auditor',
--       jsonb_build_object('Content-Type','application/json',
--         'x-auditor-key', (SELECT decrypted_secret FROM vault.decrypted_secrets
--                           WHERE name = 'auditor_access_key')),
--       jsonb_build_object('days',30,'post_to_slack',true,'dry_run',false), 150000);
--   $$);
--
-- Verify:
--   SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
-- Prove the pager works (don't trust theory) — manufacture one failure:
--   SELECT ops_http_post_logged('zz-forced-failure-test',
--     'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/nonexistent-function',
--     '{"Content-Type":"application/json"}'::jsonb, '{}'::jsonb, 15000);
--   -- wait ~30s, invoke the monitor, confirm the Slack page, then clean up:
--   DELETE FROM ops_cron_invocations WHERE jobname = 'zz-forced-failure-test';
--   DELETE FROM ops_alert_state WHERE alert_key = 'cron_failure:zz-forced-failure-test';
-- ============================================================
