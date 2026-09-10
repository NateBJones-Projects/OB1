# Policy-Citing Briefings + Weekly Summary

> Two Supabase Edge Functions that turn your raw captures into a **daily morning briefing** and a **weekly summary** — each one cites your Editorial Policy at the top of its prompt (R10.2) and writes its output back into the `thoughts` table as a provenance-tagged derived thought. These are the synthesis prompts the [editorial-policy](../editorial-policy/) recipe's auditor was built to enforce.

## What It Is

The [editorial-policy](../editorial-policy/) recipe ships a 40-rule constitution and a weekly auditor, but it deliberately does **not** ship the synthesis prompts it governs — its Step 2 says "update your `morning-briefing` and `weekly-summary` prompts to cite the policy," assuming you already have them. Most forks don't. This recipe is those two functions, built to the policy from the first line.

- **`morning-briefing`** — every morning, compiles the last 24h of captures into a terse Slack-mrkdwn briefing: *Action items* (verbatim, per R3.5), optional *Themes* (only when ≥3 thoughts converge, R5.3), optional *Worth revisiting*. Stores it as `type=morning_briefing` and posts it to Slack.
- **`weekly-summary`** — every week, steps up an altitude: *Key decisions*, *Open loops*, *Themes*, and *Tensions* (contradictions surfaced with `thought_id`s, never resolved — R6). Stores it as `type=weekly_summary` and posts it to Slack.

Both write back with full provenance (`derived_from`, `derivation_layer='derived'`, `derivation_method='synthesis'`, `policy_version`, `generated_at`), so every briefing is traceable to the exact captures it came from and regenerable from source (R1.2, R7.3).

## Why It Matters

**The synthesis layer is where drift lives.** A briefing that inflates a one-line reminder into a "theme," or a summary that smooths over two conflicting captures, is exactly the failure the editorial policy exists to prevent. Building these functions to cite the policy from the start means:

1. **You get daily/weekly synthesis** that stays literal and terse instead of ballooning into narrative.
2. **The auditor's drift detection turns on.** The editorial-policy auditor deliberately *includes* `morning_briefing` and `weekly_summary` in its audit corpus. The moment these functions ship and cite the policy, the auditor starts checking *them* for rule violations (an inflated task, a resolved contradiction) — the enforcement loop the whole pairing was designed for.

Unlike the delivery-only `daily-digest` / `weekly-digest` recipes (which send email/Telegram and don't write back), these functions make synthesis a **first-class, append-only layer of the brain** — the time-series of the brain's own understanding (R8.1).

## What's In This Recipe

- **`morning-briefing/index.ts`** + **`deno.json`** — the daily briefing Edge Function.
- **`weekly-summary/index.ts`** + **`deno.json`** — the weekly summary Edge Function.
- **`schedule.sql`** — pg_cron entries for both (adjust the UTC times to your local morning).

No new schema — both use the existing `thoughts` table columns (`content`, `derived_from`, `derivation_layer`, `derivation_method`, `metadata`).

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md)).
- **The [editorial-policy](../editorial-policy/) recipe adopted** — you need `docs/editorial-policy.md` in place and a `POLICY_VERSION` secret set. These functions open their prompts with `Follow Open Brain Editorial Policy v{POLICY_VERSION}…`; without the policy the citation is hollow. (Deploying the auditor too is recommended — it's what enforces these.)
- Supabase Edge Functions with `pg_cron` + `pg_net` enabled.
- OpenRouter API key. Default model is `anthropic/claude-haiku-4-5`.
- Slack workspace with a **bot** token (`xoxb-…`, `chat:write` scope) and a channel ID, since both functions post their output to Slack.

## Credential Tracker

```text
POLICY BRIEFINGS -- CREDENTIAL TRACKER
--------------------------------------
FROM YOUR OPEN BRAIN SETUP
  Project ref (xxx.supabase.co):  ____________
  OpenRouter API key:             ____________  (secret: OPENROUTER_API_KEY)
  Slack bot token (xoxb-):        ____________  (secret: SLACK_BOT_TOKEN)
  Slack channel ID (C…):          ____________  (secret: SLACK_CAPTURE_CHANNEL)
  Policy version:                 ____________  (secret: POLICY_VERSION, e.g. 1.3)

GENERATED DURING SETUP
  Synthesis access key
    (random 32-char string):      ____________  (secret: SYNTHESIS_ACCESS_KEY)
--------------------------------------
```

## Steps

### Step 1: Set the secrets

Most are shared with the editorial-policy recipe and may already be set. The only new one is `SYNTHESIS_ACCESS_KEY` (gates both function URLs):

```bash
supabase secrets set --project-ref <YOUR-PROJECT-REF> \
  SYNTHESIS_ACCESS_KEY=$(openssl rand -hex 16)
# Already set if you did the editorial-policy recipe:
#   OPENROUTER_API_KEY, POLICY_VERSION, SLACK_BOT_TOKEN, SLACK_CAPTURE_CHANNEL
```

### Step 2: Deploy both functions

```bash
# From your OB1 working directory:
mkdir -p supabase/functions/morning-briefing supabase/functions/weekly-summary
cp <recipe>/morning-briefing/* supabase/functions/morning-briefing/
cp <recipe>/weekly-summary/*   supabase/functions/weekly-summary/
supabase functions deploy morning-briefing --no-verify-jwt
supabase functions deploy weekly-summary   --no-verify-jwt
```

`--no-verify-jwt` is correct here: each function gates itself with the `?key=` param (`SYNTHESIS_ACCESS_KEY`), matching the auditor pattern.

### Step 3: Smoke test (dry run — no store, no Slack)

```bash
KEY=<YOUR-SYNTHESIS-KEY>
curl -sS -X POST "https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/weekly-summary?key=$KEY" \
  -H "Content-Type: application/json" \
  -d '{"days":7,"post_to_slack":false,"dry_run":true}'
```

You should get `{"ok":true, ..., "content_words": N, "preview": "*Weekly summary — …"}`. Repeat for `morning-briefing` with `{"days":1,...}`.

### Step 4: Schedule the weekly runs

Open `schedule.sql`, replace `<YOUR-PROJECT-REF>` and `<YOUR-SYNTHESIS-KEY>`, adjust the UTC cron times to your local morning, and run it in the SQL Editor.

## Expected Outcome

- **Daily:** a new `type=morning_briefing` thought and a Slack post with your action items (verbatim) plus any themes.
- **Weekly:** a new `type=weekly_summary` thought and a Slack post with decisions, open loops, themes, and surfaced tensions.
- Each stored thought carries `derived_from` (the source thought UUIDs), so `trace_provenance` and the auditor can reason about it.
- If you run the editorial-policy auditor, its next pass will include these outputs in its corpus and flag any drift (e.g. an inflated task, a resolved contradiction).

## Request/Response

Both functions accept a POST body: `days` (window), `post_to_slack` (bool), `dry_run` (bool). Response includes `stored_id`, `source_count`, `posted_to_slack`, `content_words`, and a `preview`.

## Troubleshooting

**401 Unauthorized** — `SYNTHESIS_ACCESS_KEY` isn't set, or the `?key=` in your call/cron doesn't match it.

**`violates check constraint "thoughts_derivation_method_check"`** — the `thoughts` table constrains `derivation_method` to `NULL` or `'synthesis'`. The functions use `'synthesis'`; if you fork the code, keep that value.

**Empty / thin briefing** — with few captures in the window, thin output is correct (R5.1/R5.4). The functions never invent activity to fill the template.

**Output too long** — the weekly summary is capped to ~250 words with at most 5 bullets per section and a section priority order (Tensions > Key decisions > Open loops > Themes). If your weeks are dense and it still runs long, tighten the cap in `weekly-summary/index.ts` `buildSystemPrompt()`.

**Model wraps output oddly** — the functions strip a stray ```` ``` ```` fence if the model adds one. To swap models, change the `MODEL` constant in each `index.ts`.

## Customisation Notes

- **Windows.** Morning defaults to 1 day, weekly to 7. Pass `days` in the cron body to change.
- **Store-only (no Slack).** Set `post_to_slack: false` in the cron body — the thought is still stored.
- **Separate channel.** Set a `SLACK_DIGEST_CHANNEL` secret to post briefings somewhere other than `SLACK_CAPTURE_CHANNEL`.
- **Sections.** Edit `buildSystemPrompt()` in each function to add/remove sections — but keep the R10.2 header line so the auditor can still hold the output to the policy.
