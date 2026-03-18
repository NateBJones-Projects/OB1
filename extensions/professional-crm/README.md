# Extension 5: Professional CRM

## Why This Matters

You ran into someone at a conference six months ago. They mentioned they were looking for exactly what you do. You said you'd follow up. You didn't. That connection is gone — not because you're bad at networking, but because no human can track hundreds of professional relationships in their head. Your agent could have surfaced that contact three days after the conversation and reminded you to follow up. It could tell you, before your next meeting with someone, every interaction you've had and every note you've captured about them.

## Learning Path: Extension 5 of 6

| Extension | Name | Status |
|-----------|------|--------|
| 1 | Household Knowledge Base | Completed |
| 2 | Home Maintenance Tracker | Completed |
| 3 | Family Calendar | Completed |
| 4 | Meal Planning & Recipes | Completed |
| **5** | **Professional CRM** | **<-- You are here** |
| 6 | Job Hunt Pipeline | Not started |

## What It Does

A professional contact management system with interaction logging, opportunity tracking, and follow-up reminders. RLS-protected so your professional network stays private. This extension introduces multi-level relationships (contacts → interactions → opportunities) and cross-extension integration with your core Open Brain thoughts table.

## What You'll Learn

- Applying RLS patterns (practiced in Extension 4)
- Multi-level relationships across three tables
- Pipeline/opportunity tracking with stage management
- Auto-updating timestamps (last_contacted)
- Cross-extension integration with the core Open Brain
- Bridge tools that connect different data domains

## Prerequisites

- Working Open Brain setup
- Extensions 1-4 recommended (RLS concepts from Extension 4 are required knowledge)
- Supabase CLI installed and linked to your project
- **Required reading:** [Row Level Security](../../primitives/rls/) primitive

## Credential Tracker

You'll reference these values during setup. Copy this block into a text editor and fill it in as you go.

> **Already have your Supabase credentials from the [Setup Guide](../../docs/01-getting-started.md)?** You just need the same Project URL, Secret key, and MCP Access Key — reuse the key from your core setup.

```text
PROFESSIONAL CRM -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project ref:           ____________
  Project URL:           ____________
  Secret key:            ____________

MCP SERVER (you'll create these)
  Default User ID:       ____________
  MCP Access Key:        ____________  (same key for all extensions)
  MCP Server URL:        ____________
  MCP Connection URL:    ____________

--------------------------------------
```

## Steps

### 1. Set Up the Database Schema

Run the SQL in `schema.sql` in your Supabase SQL Editor:

```bash
# Navigate to your Supabase project SQL editor
# https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql/new
```

Copy and paste the contents of `schema.sql` and click Run. This creates three RLS-enabled tables with proper foreign key relationships.

### 2. Generate Your User ID

The extension needs a user ID to scope your data. Generate a UUID and save it in your credential tracker:

```bash
# macOS / Linux
uuidgen | tr '[:upper:]' '[:lower:]'

# Or use any UUID generator — the value just needs to be unique to you
```

Set it as an environment variable for your Edge Function:

```bash
supabase secrets set DEFAULT_USER_ID=your-generated-uuid-here
```

> If you already set `DEFAULT_USER_ID` for a previous extension, you can skip this step — all extensions share the same user ID.

### 3. Deploy the MCP Server

Follow the [Deploy an Edge Function](../../primitives/deploy-edge-function/) guide using these values:

| Setting | Value |
|---------|-------|
| Function name | `professional-crm-mcp` |
| Download path | `extensions/professional-crm` |

### 4. Connect to Your AI

Follow the [Remote MCP Connection](../../primitives/remote-mcp/) guide to connect this extension to Claude Desktop, ChatGPT, Claude Code, or any other MCP client.

| Setting | Value |
|---------|-------|
| Connector name | `Professional CRM` |
| URL | Your **MCP Connection URL** from the credential tracker |

### 5. Test the Extension

Try these commands with Claude:

```
Add a professional contact: Sarah Chen, works at DataCorp as VP of Engineering, met at AI Summit 2026
```

```
Log an interaction: had coffee with Sarah Chen yesterday, discussed their RAG pipeline needs, follow up needed
```

```
Show me everyone I need to follow up with this week
```

```
Create an opportunity: DataCorp consulting project, linked to Sarah Chen, in conversation stage, estimated $50k
```

## Cross-Extension Integration

**This is where extensions start to compound in power.**

### `link_thought_to_contact` — The Bridge Tool

Your core Open Brain captures thoughts all day long. Some of those thoughts mention people. This tool bridges the gap — your agent sees a thought about someone and can surface it before your next meeting with them.

**Example workflow:**

1. You capture a thought: "Ran into Sarah Chen at the AI meetup — she's looking for someone to help with their RAG pipeline."
2. Your agent uses `link_thought_to_contact` to add this to Sarah's contact record (stored in the contact's notes or tags)
3. Next time you look up Sarah or have a follow-up due, that thought appears in context
4. Before your next meeting with Sarah, your agent surfaces: "Last interaction: coffee 2 weeks ago. Note from recent thought: looking for RAG pipeline help."

**How it works technically:**

The tool takes a `thought_id` (from the core Open Brain `thoughts` table) and a `contact_id` (from `professional_contacts`). It retrieves the thought content and appends it to the contact's notes with a timestamp and reference. This creates a bidirectional link — the contact record gains context, and the thought gains a professional relationship tag.

### Integration with Extension 6 (Job Hunt Pipeline)

If you build Extension 6, the `link_contact_to_professional_crm` tool works in reverse — recruiters and hiring managers from your job search automatically become professional contacts. Your networking doesn't stop when the job search ends. Those relationships persist in your CRM, ready for the long-term connection.

## Available Tools

1. **`add_professional_contact`** — Add a contact (name, company, title, email, phone, linkedin_url, how_we_met, tags, notes)
2. **`search_contacts`** — Search by name, company, or tags with ILIKE
3. **`log_interaction`** — Log a touchpoint (contact_id, interaction_type, summary, follow_up_needed, follow_up_notes). Auto-updates contact's last_contacted timestamp.
4. **`get_contact_history`** — Get a contact's full profile + all interactions ordered by date
5. **`create_opportunity`** — Create an opportunity/deal linked to a contact (title, description, stage, value, expected_close_date)
6. **`get_follow_ups_due`** — List contacts with follow_up_date in the past or next N days
7. **`link_thought_to_contact`** — **CROSS-EXTENSION BRIDGE** — Takes a thought_id and contact_id, retrieves the thought from your core Open Brain, and links it to the contact record

## Expected Outcome

After completing this extension, you should be able to:

1. Maintain a professional contact database with rich context
2. Log every interaction with timestamps and follow-up tracking
3. Track opportunities through a pipeline (identified → in_conversation → proposal → negotiation → won/lost)
4. Connect thoughts from your Open Brain to specific contacts
5. Get proactive follow-up reminders before relationships go cold

Your agent will be able to answer questions like:
- "Who do I need to follow up with this week?"
- "Show me my full history with Sarah Chen"
- "What opportunities are in the proposal stage?"
- "Find contacts I met at conferences who work in AI"
- "Which thoughts have I captured about John's project?"

## Troubleshooting

For common issues (connection errors, 401s, deployment problems), see [Common Troubleshooting](../../primitives/troubleshooting/).

**Extension-specific issues:**

**"Foreign key violation" when logging interactions**
- Ensure the contact exists before logging an interaction
- Verify the `contact_id` UUID is correct
- Check that the contact belongs to the same user_id

**"Thought not found" when linking**
- Verify the thought_id exists in your core Open Brain `thoughts` table
- Check that the user has permission to access that thought

## Next Steps

**Extension 6: Job Hunt Pipeline** — The most complex build in the learning path. You'll create a complete job search management system with 5 RLS-protected tables (companies, postings, applications, interviews, contacts) and bridge it back to this CRM. You'll learn advanced pipeline tracking, conversion rate analysis, and cross-extension integration at scale.

[Continue to Extension 6 →](../job-hunt/README.md)

> **32 tools and counting.** With 5 extensions connected, your AI is holding ~32 tool definitions in context. If you're noticing the AI picking the wrong tool or ignoring some entirely, the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) has prompt kits that audit your tools, suggest merges, and help you scope servers by workflow (capture vs. query vs. admin).
