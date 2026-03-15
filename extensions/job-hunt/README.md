# Extension 6: Job Hunt Pipeline

## Why This Matters

Job hunting is an emotional grinder. You think you're failing because you got 3 rejections this week. But your agent can show you that your actual interview conversion rate is 40% — well above average. It can catch that you haven't followed up with the hiring manager at Company X in 8 days. It can normalize compensation across 4 different offer structures so you're comparing apples to apples. The data doesn't lie, and having an agent that can reason across your entire pipeline turns an emotional process into a manageable one.

## Learning Path: Extension 6 of 6

| Extension | Name | Status |
|-----------|------|--------|
| 1 | Household Knowledge Base | Completed |
| 2 | Home Maintenance Tracker | Completed |
| 3 | Family Calendar | Completed |
| 4 | Meal Planning & Recipes | Completed |
| 5 | Professional CRM | Completed |
| **6** | **Job Hunt Pipeline** | **<-- You are here** |

## What It Does

A complete job search management system — companies, postings, applications, interviews, and contacts. The most complex extension in the learning path, with 5 RLS-protected tables and sophisticated cross-extension integration to your Professional CRM (Extension 5). This extension demonstrates advanced multi-table relationships, pipeline tracking, and data analysis patterns.

## What You'll Learn

- Most complex multi-table schema design (5 tables with cascading relationships)
- Pipeline/funnel tracking with status transitions
- Cross-extension integration with Extension 5 (Professional CRM)
- Advanced queries (conversion rates, timeline analysis, upcoming events)
- Bridge tables for linking separate data domains
- Handling nullable foreign keys and optional relationships

## Prerequisites

- Working Open Brain setup
- Extension 5 (Professional CRM) strongly recommended — cross-extension linking depends on it
- Supabase CLI installed and linked to your project
- **Required reading:** [Row Level Security](../../primitives/rls/) primitive

## Credential Tracker

You'll reference these values during setup. Copy this block into a text editor and fill it in as you go.

> **Already have your Supabase credentials from the [Setup Guide](../../docs/01-getting-started.md)?** You just need the same Project ref and Secret key, plus a new MCP Access Key.

```text
JOB HUNT PIPELINE -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project ref:           ____________
  Secret key:            ____________

MCP SERVER (new for this extension)
  MCP Access Key:        ____________
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

Copy and paste the contents of `schema.sql` and click Run. This creates five RLS-enabled tables with proper foreign key relationships and cascading deletes.

### 2. Deploy the MCP Server

Follow the [Deploy an Edge Function](../../primitives/deploy-edge-function/) guide using these values:

| Setting | Value |
|---------|-------|
| Function name | `job-hunt-mcp` |
| Download path | `extensions/job-hunt` |

### 3. Connect to Your AI

Follow the [Remote MCP Connection](../../primitives/remote-mcp/) guide to connect this extension to Claude Desktop, ChatGPT, Claude Code, or any other MCP client.

| Setting | Value |
|---------|-------|
| Connector name | `Job Hunt Pipeline` |
| URL | Your **MCP Connection URL** from the credential tracker |

### 4. Test the Extension

Try these commands with Claude:

```
Add a company I'm tracking: TechCorp, enterprise software company, remote-first, San Francisco
```

```
Add a job posting at TechCorp: Senior AI Engineer, $150k-$200k, posted on LinkedIn
```

```
Submit an application for the TechCorp AI Engineer role, used resume v3
```

```
Schedule a phone screen interview for my TechCorp application, tomorrow at 2pm
```

```
Show me my pipeline overview - how many applications, what stages, upcoming interviews
```

```
Link the TechCorp recruiter to my professional CRM
```

## Cross-Extension Integration

**This is the most sophisticated cross-extension integration in the learning path.**

### `link_contact_to_professional_crm` — The Bridge Tool

A recruiter you're talking to during the job search is also a professional contact worth maintaining. Your agent can create the CRM record automatically — the recruiter's name, company, and interaction history carry over. When you land the job (or don't), those contacts don't disappear from your network. They're already in your CRM, ready for the long-term relationship.

**Example workflow:**

1. You add a job contact: "Jessica Lee, TechCorp recruiter, jessica@techcorp.com"
2. You have multiple interactions: phone screen, interview coordination, offer negotiation
3. Your agent uses `link_contact_to_professional_crm` to create a professional_contacts record in Extension 5
4. The `professional_crm_contact_id` field is set, creating a bidirectional link
5. After the job search ends, Jessica is already in your CRM with full context: company, role, all notes from the job search

**How it works technically:**

The tool takes a `job_contact_id` from the `job_contacts` table. It retrieves the contact details and creates a corresponding record in Extension 5's `professional_contacts` table. The `professional_crm_contact_id` field stores the link — this is application-managed rather than a database foreign key, because the two extensions live in separate table domains and you might install one without the other. This means:

- Future interactions in the job hunt also appear in the CRM context
- You can track the relationship long-term in Extension 5
- Your networking doesn't restart from zero after the job search

### Integration with Extensions 1-4

Your agent has even more context when you're job hunting:

- **Extension 1 (Household Knowledge):** Knows your current location, family situation relevant to relocation decisions
- **Extension 2 (Home Maintenance):** Understands timing constraints (e.g., "I can't start until after the roof replacement in May")
- **Extension 3 (Family Calendar):** Can schedule interviews around existing commitments, factor in family obligations
- **Extension 4 (Meal Planning):** Knows your dietary needs for interview lunches, can plan around busy interview days

This is the power of a fully interconnected Open Brain — context flows across domains.

## Available Tools

1. **`add_company`** — Add a company to track (name, industry, website, size, location, remote_policy, notes, glassdoor_rating)
2. **`add_job_posting`** — Add a specific role at a company (company_id, title, url, salary_min, salary_max, requirements, nice_to_haves, source, posted_date)
3. **`submit_application`** — Record a submitted application (job_posting_id, status, applied_date, resume_version, cover_letter_notes, referral_contact)
4. **`schedule_interview`** — Schedule an interview for an application (application_id, interview_type, scheduled_at, duration_minutes, interviewer_name, interviewer_title, notes)
5. **`log_interview_notes`** — Add feedback/notes after an interview, update status to completed (interview_id, feedback, rating 1-5)
6. **`get_pipeline_overview`** — Dashboard summary: counts by application status, upcoming interviews in next N days, recent activity. This is your "how's it going?" tool.
7. **`get_upcoming_interviews`** — List interviews in the next N days with full company/role context
8. **`link_contact_to_professional_crm`** — **CROSS-EXTENSION BRIDGE** — Takes a job_contact_id, creates/links to a professional_contacts record in Extension 5, sets professional_crm_contact_id

## Expected Outcome

After completing this extension, you should be able to:

1. Track companies and roles across your entire job search
2. Manage application status through the pipeline (applied → screening → interviewing → offer → accepted/rejected)
3. Schedule and log interviews with detailed notes and ratings
4. Track contacts (recruiters, hiring managers, interviewers) with CRM integration
5. Get pipeline analytics: conversion rates, stage distribution, interview performance
6. Bridge job search contacts into your long-term professional network

Your agent will be able to answer questions like:
- "Show me my pipeline overview"
- "What interviews do I have this week?"
- "What's my conversion rate from phone screen to technical interview?"
- "Which applications are in the proposal stage?"
- "Who's the recruiter at TechCorp and when did I last talk to them?"
- "Link all my TechCorp contacts to my professional CRM"

## Troubleshooting

For common issues (connection errors, 401s, deployment problems), see [Common Troubleshooting](../../primitives/troubleshooting/).

**Extension-specific issues:**

**"Foreign key violation" errors**
- Ensure parent records exist before creating child records (company → job_posting → application → interview)
- Verify UUIDs are correct and belong to the same user_id
- Deleting a company will cascade-delete all related postings, applications, and interviews

**"Extension 5 not found" when linking contacts**
- Verify Extension 5 (Professional CRM) is installed and its tables exist
- Check that the `professional_contacts` table is accessible
- Ensure both extensions are using the same Supabase project

## Next Steps

**You've completed all 6 extensions!**

At this point, your agent has a comprehensive, interconnected system:

- **Extension 1:** Household knowledge (paint colors, appliances, vendors)
- **Extension 2:** Home maintenance (recurring tasks, service logs)
- **Extension 3:** Family calendar (events, recurring schedules)
- **Extension 4:** Meal planning (recipes, shopping lists, meal schedules)
- **Extension 5:** Professional CRM (contacts, interactions, opportunities)
- **Extension 6:** Job hunt pipeline (companies, applications, interviews)

All wired together through your Open Brain, with cross-extension tools that let context flow between domains.

### What's Next?

1. **Build your own extensions** — Use these 6 as templates for domains specific to your life
2. **Explore primitives** — Dive deeper into [Row Level Security](../../primitives/rls/), [Remote MCP](../../primitives/remote-mcp/), and other patterns
3. **Create compound queries** — Build tools that reason across multiple extensions simultaneously
4. **Share your extensions** — Contribute back to the OB1 community

[Explore Primitives →](../../primitives/)
