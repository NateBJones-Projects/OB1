# Daily Digest

> Automated daily summary of your recent thoughts, delivered to your inbox.

## What It Does

Queries your most recent Open Brain thoughts, groups them by type and topic, and delivers a formatted summary. You wake up to a digest of everything your brain captured yesterday.

There are two approaches — pick the one that fits your setup:

| Approach | Infrastructure | Difficulty | Auto-send? |
| -------- | -------------- | ---------- | ---------- |
| **Claude Code Scheduled Task** (below) | None — uses MCP tools you already have | Beginner | Draft only (one-tap send) |
| **Supabase Edge Function** (planned) | Edge Function + pg_cron + email service | Intermediate | Full auto-send |

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

## Approach B: Supabase Edge Function (Planned)

A fully self-contained approach using a Supabase Edge Function, pg_cron trigger, and an email service (Resend or SendGrid) for true automated delivery without Claude running. This approach is not yet implemented — contributions welcome.

### Prerequisites (planned)

- Supabase CLI installed (`npm i -g supabase`)
- OpenRouter API key (for generating the summary)
- Email service: Resend or SendGrid (free tier)

### Credential Tracker (for future Edge Function approach)

```text
DAILY DIGEST -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:  ____________
  Supabase Secret key:   ____________
  OpenRouter API key:    ____________

DELIVERY METHOD
  Email service (Resend/SendGrid): ____________
  API key:                         ____________
  Sender email:                    ____________

--------------------------------------
```
