# Daily Digest

> Automated daily summary of your recent thoughts, delivered to your inbox.

## What It Does

Queries your most recent Open Brain thoughts, groups them by type and topic, and delivers a formatted summary. You wake up to a digest of everything your brain captured yesterday.

There are two approaches — pick the one that fits your setup:

| Approach | Infrastructure | Difficulty | Auto-send? |
| -------- | -------------- | ---------- | ---------- |
| **Claude Code Scheduled Task** ([Approach A](#approach-a-claude-code-scheduled-task)) | None — uses MCP tools you already have | Beginner | Draft only (one-tap send) |
| **Supabase Edge Function** ([Approach B](#approach-b-supabase-edge-function)) | Edge Function + pg_cron + Resend | Beginner | Full auto-send |

---

## Approach A: Claude Code Scheduled Task

Zero-infrastructure variant. If you already run Claude Code (or Claude Desktop's Code mode) with Open Brain MCP and Gmail MCP connected, this works today with no deployment.

### Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Claude Code or Claude Desktop (Code mode) with:
  - Open Brain MCP connected
  - Gmail MCP connected (for email delivery)

### How It Works

Claude Code has built-in scheduled tasks (visible in Claude Desktop under the **Scheduled** tab). You install a skill file — a prompt template — that tells Claude what to do on each run:

1. Query Open Brain for thoughts from the last 24 hours
2. Organize them into a scannable digest (grouped by type, with topic/people tags)
3. Create a Gmail draft addressed to you

Claude *is* the LLM — no OpenRouter key needed.

### Steps

![Step 1](https://img.shields.io/badge/Step_1-Install_the_Skill_File-1E88E5?style=for-the-badge)

Copy the skill template into your Claude scheduled tasks directory:

```bash
mkdir -p ~/.claude/scheduled-tasks/daily-digest
cp recipes/daily-digest/daily-digest-skill.md ~/.claude/scheduled-tasks/daily-digest/SKILL.md
```

Then open the file and replace `YOUR_EMAIL@example.com` with your actual email address.

> [!IMPORTANT]
> The skill file is a local prompt — it never gets committed to any repo. Your email stays on your machine.

---

![Step 2](https://img.shields.io/badge/Step_2-Create_the_Scheduled_Task-1E88E5?style=for-the-badge)

In any Claude Code session (or Claude Desktop Code mode), run:

```
/schedule
```

Or create it directly by telling Claude:

> "Create a scheduled task called daily-digest that runs every day at 7am using the skill file at ~/.claude/scheduled-tasks/daily-digest/SKILL.md"

The task will appear in Claude Desktop's **Scheduled** tab.

---

![Step 3](https://img.shields.io/badge/Step_3-Test_Run_and_Approve_Tools-1E88E5?style=for-the-badge)

Click **"Run now"** from the Scheduled tab to do an initial test. On the first run, Claude will ask for permission to use the Open Brain and Gmail MCP tools. Approve them once — future runs will remember.

> [!TIP]
> If you haven't captured any thoughts recently, the digest will say so. Capture a few test thoughts first via `capture_thought` to see the full format.

---

### Expected Outcome

Every morning, a Gmail draft appears in your inbox with:

- A count of thoughts captured in the last 24 hours
- Breakdown by type (observations, tasks, ideas, references, person notes)
- Each thought's content (truncated), source, and topic/people tags
- A summary header with top themes

You review the draft and hit send (or just read it).

### Troubleshooting

**Issue: Scheduled task never fires**
Solution: Claude Code must be running (or Claude Desktop must be open) at the scheduled time. If your machine was asleep, the task fires on next launch.

**Issue: Task pauses waiting for permissions**
Solution: Run it manually once via the Scheduled tab and approve the MCP tool permissions. They persist for future runs.

**Issue: "No thoughts found" every day**
Solution: Check that your Open Brain MCP is connected and has recent data. Run `list_thoughts` manually in a Claude Code session to verify.

**Issue: Gmail draft not appearing**
Solution: Verify your Gmail MCP connector is working. Try `gmail_create_draft` manually in a Claude session to test.

---

## Approach B: Supabase Edge Function

A fully self-contained approach using a Supabase Edge Function, a pg_cron trigger, and [Resend](https://resend.com) for true automated delivery — no Claude session or local machine required. The digest is formatted with plain template code, so **no LLM key is needed**.

The function ([`edge-function/index.ts`](edge-function/index.ts)) queries thoughts from the last 24 hours, groups them by type with a summary header (counts, top topics), and emails the result. Thoughts with `sensitivity_tier` of `personal` or `restricted` (from the [enhanced-thoughts](../../schemas/enhanced-thoughts/) schema) are excluded by default.

### Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Supabase CLI available ([Homebrew/Scoop/standalone binary or `npx supabase`](https://supabase.com/docs/guides/local-development/cli/getting-started); `npm i -g supabase` is not supported)
- [Resend](https://resend.com) account (free tier: 100 emails/day — plenty for one digest)
- `pg_cron` and `pg_net` extensions enabled (Database → Extensions in the Supabase dashboard)

### Credential Tracker

```text
DAILY DIGEST -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:  ____________
  Supabase project ref:  ____________

DELIVERY
  Resend API key:        ____________
  Recipient email:       ____________
  Sender email:          ____________ (optional — needs a verified domain)

SECURITY
  DIGEST_ACCESS_KEY:     ____________ (any random string you generate)

--------------------------------------
```

### Steps

![Step 1](https://img.shields.io/badge/Step_1-Get_a_Resend_Key-1E88E5?style=for-the-badge)

Sign up at [resend.com](https://resend.com) and create an API key.

> [!NOTE]
> Without a verified domain, Resend's default `onboarding@resend.dev` sender can only deliver to **the email address of your own Resend account** — which is exactly what a personal digest needs. To send from your own address instead, verify a domain in Resend and set `DIGEST_FROM_EMAIL` in Step 3.

---

![Step 2](https://img.shields.io/badge/Step_2-Deploy_the_Function-1E88E5?style=for-the-badge)

From your Supabase project directory:

```bash
mkdir -p supabase/functions/daily-digest
cp recipes/daily-digest/edge-function/index.ts supabase/functions/daily-digest/index.ts
supabase functions deploy daily-digest --no-verify-jwt
```

`--no-verify-jwt` is required because pg_cron calls the function without a user JWT — access is gated by the `DIGEST_ACCESS_KEY` secret instead.

---

![Step 3](https://img.shields.io/badge/Step_3-Set_Secrets-1E88E5?style=for-the-badge)

```bash
supabase secrets set \
  RESEND_API_KEY=re_your_key_here \
  DIGEST_TO_EMAIL=you@example.com \
  DIGEST_ACCESS_KEY=$(openssl rand -hex 16)

# Optional — only with a domain verified in Resend:
# supabase secrets set DIGEST_FROM_EMAIL="Open Brain <digest@yourdomain.com>"
```

Note the `DIGEST_ACCESS_KEY` value (`supabase secrets list` shows digests only, not values, so save it in your credential tracker).

---

![Step 4](https://img.shields.io/badge/Step_4-Test-1E88E5?style=for-the-badge)

Dry run first — returns the digest as JSON without sending anything:

```bash
curl -s -X POST \
  "https://YOUR-PROJECT-REF.supabase.co/functions/v1/daily-digest?key=YOUR_DIGEST_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"hours": 24, "dry_run": true}'
```

Then send a real one by dropping `dry_run`:

```bash
curl -s -X POST \
  "https://YOUR-PROJECT-REF.supabase.co/functions/v1/daily-digest?key=YOUR_DIGEST_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"hours": 24}'
```

Check your inbox. The response includes `{"sent": true, "thought_count": N, ...}`.

Optional body parameters: `hours` (1–168, default 24) widens the window; `include_personal: true` includes `personal`/`restricted` sensitivity tiers, which are excluded by default.

---

![Step 5](https://img.shields.io/badge/Step_5-Schedule_It-1E88E5?style=for-the-badge)

Open [`schedule.sql`](schedule.sql), replace `<YOUR-PROJECT-REF>` and `<YOUR-DIGEST-KEY>` with your values, then run it in the Supabase SQL Editor. This adds a pg_cron job that fires daily at 07:00 UTC — adjust the cron expression to land the email in your morning.

Verify it's scheduled:

```sql
SELECT jobname, schedule FROM cron.job WHERE jobname = 'daily-digest';
```

### Expected Outcome

Every morning, an email arrives with:

- A summary header: total thoughts captured in the last 24 hours, breakdown by type, top topics
- Thoughts grouped by type, each with a content preview (truncated to ~200 chars) and topic/people tags
- On a quiet day, a short "no new thoughts" note instead

The function responds to the cron trigger in a few seconds; no LLM calls, so runs are effectively free beyond Supabase's Edge Function quota.

### Troubleshooting

**Issue: `{"error": "unauthorized"}`**
Solution: The `?key=` query parameter doesn't match the `DIGEST_ACCESS_KEY` secret. Re-check the value in `schedule.sql` and your curl command. If you've lost it, set a new one (`supabase secrets set DIGEST_ACCESS_KEY=...`) — no redeploy needed, secrets apply on the next invocation.

**Issue: Resend returns 403 / email never arrives**
Solution: Without a verified domain, the default `onboarding@resend.dev` sender can only deliver to your own Resend account email — make sure `DIGEST_TO_EMAIL` matches it, or verify a domain and set `DIGEST_FROM_EMAIL`. Also check Resend's dashboard → Logs for delivery status, and your spam folder.

**Issue: `thoughts query failed: 401`**
Solution: The function's auto-injected service role key isn't reaching PostgREST — this usually means the function was deployed to a different project than your thoughts database. Run `supabase link --project-ref YOUR-REF` and redeploy.

**Issue: Digest is empty but I captured thoughts yesterday**
Solution: The window is measured from *now*, not calendar days. If the cron fires at 07:00 UTC, it covers 07:00→07:00. Widen the window in `schedule.sql` (`'hours', 36`) or shift the cron time. Also note `personal`/`restricted` thoughts are excluded unless you pass `include_personal: true`.

**Issue: Cron job exists but nothing fires**
Solution: Confirm both `pg_cron` *and* `pg_net` are enabled (the job runs but the HTTP call silently fails without pg_net). Check run history:
```sql
SELECT start_time, status, return_message FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'daily-digest')
ORDER BY start_time DESC LIMIT 5;
```
