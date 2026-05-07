# Daily Brain Digest

Enhanced morning digest with DOK-aware grouping, SPOV status tags, and items needing review.

## Features

- **DOK-aware grouping**: Thoughts organized by Depth of Knowledge level
- **SPOV status tags**: [TRUTH], [MYTH], [OK], [NEEDS REVIEW] for DOK4 entries
- **Needing Your Review**: Highlights broken SPOVs that require attention
- **Source insights**: Shows source context for each entry
- **Statistics and summaries**: Counts and trends over time

## Usage

The skill runs automatically as part of your weekly digest workflow, or can be triggered manually:

1. Uses Open Brain MCP `recall` tool to get recent thoughts (last 7 days)
2. Groups content by DOK level with appropriate formatting
3. Highlights items needing human review
4. Generates a comprehensive email digest

## Output Format

```
=== Weekly Brain Digest — April 14-20, 2026 ===

Summary:
- 12 new insights captured
- DOK2: 5 clusters, DOK3: 4 insights, DOK4: 3 SPOVs
- Top topics: AI, Product Strategy, Personal Development

=== DOK2 — Clusters (5) ===
- **AI Implementation Trends** [Work Project]: Summary of emerging patterns in AI adoption across industries...
- **Competitive Analysis** [Competitive Intel]: Latest developments in market positioning...

=== DOK3 — Insights (4) ===
- **Market Disruption Timing** [Product Strategy]: Analysis suggests Q3 2026 is the inflection point...
- **Team Productivity Patterns** [Personal Dev]: Data reveals 2x output increase when using async...

=== DOK4 — SPOVs (3) ===
- **Remote Work Superiority** [TRUTH]: Contrarian position that distributed teams outperform collocated in knowledge work...
- **AI Will Replace All Programming** [NEEDS REVIEW]: Strong position challenged by recent evidence about human-AI collaboration...

=== Items Needing Your Review ===
❗ **Remote Work Superiority** [BROKEN]: Contradicted by new productivity data from team studies...
```

## Integration

Depends on:
- Open Brain v2 MCP server
- DOK pipeline processing
- Access stats tracking (for determining relevance)

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

- Supabase CLI available ([Homebrew/Scoop/standalone binary or `npx supabase`](https://supabase.com/docs/guides/local-development/cli/getting-started); `npm i -g supabase` is not supported)
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
