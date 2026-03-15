# Extension Name

## Why This Matters

Lead with the human pain point. What real-life scenario makes this extension worth building? Use specific, relatable examples — not tech specs.

## What It Does

1-2 sentences on the practical capability this adds to your Open Brain.

## Learning Path: Extension X of 6

| Extension | What You Build | Status |
| --------- | -------------- | ------ |
| 1. [Household Knowledge Base](../household-knowledge/) | Home facts your agent can recall | |
| 2. [Home Maintenance Tracker](../home-maintenance/) | Scheduling and history for home upkeep | |
| 3. [Family Calendar](../family-calendar/) | Multi-person schedule coordination | |
| 4. [Meal Planning](../meal-planning/) | Recipes, meal plans, shared grocery lists | |
| 5. [Professional CRM](../professional-crm/) | Contact tracking with interaction history | |
| 6. [Job Hunt Pipeline](../job-hunt/) | Application tracking and interview pipeline | |

> Mark your current extension with **<-- You are here**

## What You'll Learn

- Concept or technique 1
- Concept or technique 2
- Concept or technique 3

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Supabase CLI installed and linked to your project
- List any earlier extensions that must be completed first
- List any required primitives with links

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

> **Already have your Supabase credentials from the [Setup Guide](../../docs/01-getting-started.md)?** You just need the same Project URL, Secret key, and Project ref.

```text
EXTENSION NAME -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________
  Project ref:           ____________

GENERATED DURING SETUP
  MCP Access Key:        ____________
  MCP Server URL:        ____________
  MCP Connection URL:    ____________

--------------------------------------
```

## Steps

### 1. Create the Database Tables

Run the SQL in `schema.sql` in your Supabase SQL Editor (`https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql/new`). Copy, paste, click Run.

### 2. Deploy the MCP Server

Follow the [Deploy an Edge Function](../../primitives/deploy-edge-function/) guide using these values:

| Setting | Value |
|---------|-------|
| Function name | `extension-name-mcp` |
| Download path | `extensions/extension-name` |

### 3. Connect to Your AI

Follow the [Remote MCP Connection](../../primitives/remote-mcp/) guide to connect this extension to Claude Desktop, ChatGPT, Claude Code, or any other MCP client.

| Setting | Value |
|---------|-------|
| Connector name | `Extension Name` |
| URL | Your **MCP Connection URL** from the credential tracker |

### 4. Test It

Verification steps and example prompts go here.

## Cross-Extension Integration

Describe how this extension connects to others. What tools bridge between this extension and the rest of the Open Brain ecosystem? This is the proof that extensions compound.

## Expected Outcome

What should be working when you're done? Be specific.

## Troubleshooting

For common issues (connection errors, 401s, deployment problems), see [Common Troubleshooting](../../primitives/troubleshooting/).

**Extension-specific issues:**

**"relation 'table_name' does not exist"**
- The `schema.sql` wasn't run successfully — re-run it in the Supabase SQL Editor

## Next Steps

Link to the next extension in the learning path and briefly describe what it adds.
