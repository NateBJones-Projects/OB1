# Daily Digest

> Automated daily summary of your recent thoughts, delivered via email or Slack.

## What It Does

A Supabase Edge Function that runs on a cron schedule, queries your most recent thoughts, groups them by topic, and sends you a formatted summary. You wake up to a digest of everything your brain captured yesterday — themes, connections, and highlights.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/getting-started.md))
- Supabase CLI installed (`npm i -g supabase`)
- OpenRouter API key (for generating the summary)
- One of: email sending service (Resend, SendGrid free tier) OR existing Slack webhook

## Steps

<!-- TODO: Fill in step-by-step instructions -->

1. Clone this folder to your Supabase project's `supabase/functions/` directory
2. Configure your environment variables (delivery method, API keys)
3. Deploy the edge function: `supabase functions deploy daily-digest`
4. Set up the cron trigger in Supabase (Database → Extensions → pg_cron)
5. Test with a manual invocation
6. Verify you receive the digest

## Expected Outcome

Every morning (or at your configured time), you receive a message containing:
- A count of thoughts captured in the last 24 hours
- Top themes/topics grouped by similarity
- 2-3 "highlight" thoughts that are most unique or interesting
- A brief AI-generated narrative connecting the day's thinking

The digest arrives via your chosen delivery method (email or Slack message).

## Troubleshooting

**Issue: Edge function deploys but never fires**
Solution: Make sure pg_cron extension is enabled and the cron job is configured correctly. Check `select * from cron.job` to verify it exists.

**Issue: Digest arrives but is empty**
Solution: The function queries thoughts from the last 24 hours. If you haven't captured anything recently, there's nothing to summarize. Test by capturing a few thoughts first.

**Issue: Email delivery fails**
Solution: Check your email service API key and sender domain. Resend requires domain verification. For testing, use Slack delivery instead.
