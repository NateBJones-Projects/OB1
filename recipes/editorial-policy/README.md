# Editorial Policy + Weekly Auditor

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@HansBohlmann](https://github.com/HansBohlmann)**

> A 40-rule constitution that governs every synthesis prompt in your Open Brain, plus a weekly auditor that enforces it. Synthesis stops drifting because drift becomes detectable.

## What It Is

Most Open Brain forks fix prompt drift in scattered prompt strings — when the morning briefing inflates a one-line task into a philosophical paragraph, you tweak the briefing's prompt; when the weekly summary smooths over contradictions, you tweak that one. The fixes don't compound, and the same failures keep reappearing under new names.

This recipe replaces that pattern with a single source of truth: a numbered editorial policy (R1.1, R3.5, R10.2, …) that every synthesis prompt cites at the top of its system message, plus a weekly Edge Function that audits compliance and posts critical findings to Slack.

When synthesis drifts, you fix the policy, bump its version, and the rule propagates to every prompt that cites it. Trait-fix discipline you don't have to remember — the auditor remembers for you.

## Why It Matters

Three failure modes the policy + auditor pair catches that scattered prompt-tuning misses:

**Inflation.** A six-word reminder ("Rose's visa follow up is urgent") gets paraphrased into a theme + worth-revisiting reflection + philosophical "prompt for today" — four sections from one source. Without a policy, you keep rediscovering this. With R3.5 ("reminders and tasks stay literal") and R5.5 ("synthesis sections are optional"), the prompt that violates the rule is provably wrong, and the auditor flags it.

**Drift across syntheses.** Your morning briefing summarises yesterday's morning briefing summarises the briefing before. By week three, the brain is talking to itself, not about real captures. R2.2 forbids this; the auditor catches it.

**Smoothed contradictions.** Two captures from different days disagree on a fact (a date, a person's role, a project status). Without a policy, the synthesis layer picks a winner or splits the difference. R6 says surface, don't resolve — and the auditor records contradictions as findings instead of letting them get smoothed over.

## What's In This Recipe

- **`editorial-policy.md`** — the full 40-rule constitution. Copy to your `docs/editorial-policy.md`. Adapt the operator-specific rules (R1.1, R9.2, R9.3) to your name and timezone; keep everything else.
- **`schema.sql`** — adds one helper RPC (`get_recent_audit_reports`) and one partial index on the `thoughts` table. No new tables.
- **`auditor/index.ts`** + **`deno.json`** — Supabase Edge Function that runs weekly, scans recent thoughts, returns structured JSON findings, stores them as `type=audit_report` thoughts, and posts to Slack on critical findings only.
- **`schedule.sql`** — pg_cron entry to fire the auditor weekly.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Supabase Edge Functions enabled with `pg_cron` and `pg_net` extensions
- OpenRouter API key (the auditor uses `gpt-4o-mini` by default — swap to `claude-haiku-4-5` if you want stricter compliance reasoning)
- Slack workspace with a bot token (only required if you want critical findings posted automatically; otherwise the auditor still stores reports silently)

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
EDITORIAL POLICY + AUDITOR -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:               ____________
  Project ref (xxx.supabase.co):  ____________
  Service role key:          ____________
  OpenRouter API key:        ____________
  Slack bot token:           ____________
  Slack capture channel ID:  ____________

GENERATED DURING SETUP
  Auditor access key
    (random 32-char string):  ____________
  Optional digest channel ID
    (defaults to capture):    ____________

--------------------------------------
```

## Steps

### Step 1: Adopt the policy

Copy `editorial-policy.md` to your `docs/editorial-policy.md`. Open it and:

- Edit R1.1 to substitute your name (or leave it as "the operator" — works either way).
- Edit R9.3 to your local timezone.
- Read R10.1 and confirm you'll bump the version when you change the doc — this is the discipline the recipe rests on.

Commit the policy to your repo. Future prompt updates will reference its version number.

### Step 2: Update your existing synthesis prompts to cite the policy

Per R10.2, every synthesis prompt's system message must start with:

```
Follow Open Brain Editorial Policy v{version}. Specific rules referenced below by number.
```

Update your `morning-briefing` and `weekly-summary` prompts to start that way and to cite specific rules where relevant. A minimal example:

```ts
const system = `Follow Open Brain Editorial Policy v1.3.

You are the operator's morning briefing assistant.

Sections (ALL OPTIONAL — see R5.5):
*Action items:* — every captured task or reminder verbatim, one bullet each. (R3.5, R4.4)
*Themes:* — appears ONLY when ≥3 thoughts converge on the same subject. (R5.3)
*Worth revisiting:* — appears ONLY when an older thought genuinely deserves another look. (R3.5)
*One prompt for today:* — appears ONLY when a genuine open question emerges from the data. (R3.5, R5.5)

Hard rules:
- Tasks/reminders go in Action items VERBATIM. Never themes, prompts, or framing language. (R3.5)
- Empty sections are correct when the data is thin. Do not pad. (R5.1, R5.5)
- The input corpus already excludes fragments and previous synthesis outputs (R2.2).
`;
```

Without this step, the auditor has nothing to enforce — the rules need to be live in the prompts.

### Step 3: Add the schema

Run the contents of `schema.sql` in your Supabase SQL Editor. This adds the `get_recent_audit_reports` RPC and a partial index on `audit_report` rows.

### Step 4: Set the auditor secrets

In the Supabase dashboard: **Settings → Edge Functions → Secrets**. Set:

```
AUDITOR_ACCESS_KEY = <a random string you generate, e.g. with `openssl rand -hex 16`>
SLACK_DIGEST_CHANNEL = <optional; defaults to SLACK_CAPTURE_CHANNEL>
POLICY_VERSION = 1.3   # or whatever your editorial-policy.md says
```

### Step 5: Deploy the function

```bash
# From your OB1 working directory:
mkdir -p supabase/functions/auditor
cp <recipe>/auditor/index.ts  supabase/functions/auditor/index.ts
cp <recipe>/auditor/deno.json supabase/functions/auditor/deno.json
supabase functions deploy auditor
```

### Step 6: Schedule the weekly run

Open `schedule.sql`, replace `<YOUR-PROJECT-REF>` and `<YOUR-AUDITOR-KEY>` with your actual values, then run it in the SQL Editor. This adds a pg_cron job that fires every Sunday at 09:00 UTC.

### Step 7: Smoke test

From the SQL Editor, fire a one-off dry run (no Slack post, no audit_report stored):

```sql
SELECT net.http_post(
  url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/auditor?key=<YOUR-AUDITOR-KEY>',
  headers := jsonb_build_object('Content-Type', 'application/json'),
  body := jsonb_build_object('days', 30, 'post_to_slack', false, 'dry_run', true)
);
```

Then check the response in `pg_net`'s response table — you should see structured JSON with `findings: []` (or actual findings if your brain has a few weeks of captures already).

## Expected Outcome

After the first scheduled run, you'll see:

1. A new row in `thoughts` with `metadata.type = 'audit_report'` containing the full structured findings.
2. If the run produced any `severity: critical` findings, a Slack post in your digest channel summarising them with rule citations like `R3.5`, `R6.1`. Otherwise Slack stays quiet — the report is still stored, you can read it later.
3. Each subsequent weekly audit references the prior one via `metadata.previous_audit_id`, forming a longitudinal chain (R8.3).

A typical critical finding looks like:

```
*Critical: 1 contradiction*
• Project X status (R6.1) — capture A says "shipped" (thought_id 9f3…), capture B says "blocked on legal" (thought_id e21…). Surface for resolution.
```

## Troubleshooting

**Issue: Auditor returns 401 Unauthorized**

Solution: the `AUDITOR_ACCESS_KEY` secret isn't set, or the value in your `schedule.sql` doesn't match. Check **Settings → Edge Functions → Secrets** and the `?key=…` param in the cron URL.

**Issue: Auditor runs but finds nothing useful**

Solution: with fewer than ~30 captured thoughts, the auditor has little to work with. Run for 2–3 weeks of real captures before tuning. If the brain has volume but findings are still empty, your synthesis prompts probably aren't citing the policy yet — the auditor only flags rule violations, so it needs the rules to be live.

**Issue: Auditor cries wolf — too many "critical" findings**

Solution: the default model is `gpt-4o-mini`. Switch to a stricter reasoner like `claude-haiku-4-5` in `auditor/index.ts` (search for `"model":` in the OpenRouter call). Also tighten R5 rules — the auditor inherits the policy's notion of severity, so if your policy is permissive, findings will be too.

**Issue: I don't want a Slack post, just the stored report**

Solution: in `schedule.sql`, set `post_to_slack: false` in the cron body. The audit_report still gets stored.

**Issue: I want the audit history queryable from MCP**

Solution: add a `list_audit_reports` tool to your MCP server that calls `get_recent_audit_reports` and returns the structured findings. Trivial wrapper — see your existing MCP tool definitions for the pattern.

## Customisation Notes

- **Severity calibration.** The default rubric is calibrated for low-noise: only ACTIVELY wrong information that the operator would act on this week is critical. Stale dates and historical context are never critical. Adjust the rubric in `buildSystemPrompt` to your taste, but be wary of relaxing it — a noisy auditor gets ignored within two weeks.
- **Audit window.** Defaults to 30 days. Shorten to 7 if you want a tighter weekly view; lengthen to 180 for a quarterly deep-pass.
- **Excluded types.** The auditor excludes `audit_report` (R8.3 chain), `connection_digest`, `fragment`, `dossier`. It deliberately INCLUDES `morning_briefing` and `weekly_summary` because drift in synthesis outputs is exactly what the auditor watches for. Don't add briefings to the excluded set.
- **Multiple operators.** This policy assumes one human operator (R1.1). If you need a multi-user variant, the rules around voice (R9.2) and provenance (R7) need significant rework — that's a different recipe.

## Why a Recipe, Not a Skill or Extension

This is a *recipe* because it combines three things — a policy doc, an SQL helper, and an Edge Function — that only deliver value together. The policy without the auditor is documentation that drifts. The auditor without the policy is a function with nothing to check. Ship them together or skip them both.
