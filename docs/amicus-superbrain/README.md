# Amicus Superbrain

**AI-powered practice management for advocates and attorneys.**

One database. One AI connector. Every AI tool you use — Claude, ChatGPT, Cursor, Claude Code — shares the same brain: your matters, contacts, documents, time entries, and email correspondence. All searchable by meaning, not just keywords.

Built on [Open Brain](../../README.md) and Supabase. Deployed as a single MCP server (Supabase Edge Function) that any AI client can connect to.

---

## What It Does

| Capability | Description |
|------------|-------------|
| **Professional CRM** | Track instructing attorneys, firms, interaction history, follow-ups, and opportunities |
| **Matter Management** | Register and manage active legal matters linked to attorneys |
| **Time Tracking** | Log billable hours by matter and task type, with 55 configurable task categories and rate tiers |
| **Email Import** | Pull Outlook emails (via Microsoft Graph API) filtered to CRM contacts, auto-log as interactions |
| **Document Storage** | Upload PDFs, DOCX, and XLSX files to Supabase Storage with automatic text extraction |
| **Semantic Search** | Every email, document, and captured thought is embedded as a 1536-dim vector — search by meaning across everything |
| **AI-Native** | Works from Claude, ChatGPT, Claude Code, Cursor, or any MCP-compatible client via a single connector |

---

## Architecture

```
+------------------+     +------------------+     +------------------+
|   Claude / GPT   |     |   Claude Code    |     |   Any MCP Client |
+--------+---------+     +--------+---------+     +--------+---------+
         |                         |                         |
         +------------+------------+------------+------------+
                      |
              MCP Protocol (HTTPS)
                      |
         +------------+------------+
         |  Amicus Superbrain MCP  |
         |  (Supabase Edge Func)   |
         +------------+------------+
                      |
         +------------+------------+
         |        Supabase         |
         |  +--------------------+ |
         |  | PostgreSQL+pgvector| |
         |  | thoughts           | |
         |  | professional_contacts |
         |  | matters            | |
         |  | time_entries       | |
         |  | task_types         | |
         |  | documents          | |
         |  | contact_interactions |
         |  | opportunities      | |
         |  +--------------------+ |
         |  | Storage (documents)| |
         |  +--------------------+ |
         +--------------------------+
                      |
         +------------+------------+
         |      OpenRouter API     |
         |  (embeddings + LLM)     |
         +--------------------------+
```

---

## Setup Guides

| Guide | Description |
|-------|-------------|
| [01 — Prerequisites](01-prerequisites.md) | Accounts, tools, and credentials you need before starting |
| [02 — Database Setup](02-database-setup.md) | Create all tables, indexes, RLS policies, and functions |
| [03 — MCP Server Deployment](03-mcp-deployment.md) | Deploy the unified Edge Function and connect to AI clients |
| [04 — CRM Setup](04-crm-setup.md) | Add your professional contacts and configure the CRM |
| [05 — Time Tracking Setup](05-time-tracking-setup.md) | Configure task types, rates, and import existing matters |
| [06 — Email Import](06-email-import.md) | Connect Outlook via Microsoft Graph API and import correspondence |
| [07 — Document Management](07-document-management.md) | Upload and search legal documents (PDF, DOCX, XLSX) |
| [08 — MCP Tools Reference](08-tools-reference.md) | Complete reference for all 18 MCP tools |

---

## Quick Start (30 minutes)

If you already have a Supabase project and OpenRouter key:

1. Run the [database schema](02-database-setup.md) in your Supabase SQL Editor
2. [Deploy the MCP server](03-mcp-deployment.md) via Supabase CLI
3. Add the connector URL in Claude or ChatGPT
4. Start capturing — "Add a contact: John Smith, Smith Attorneys, john@smith.co.za"

---

## Who This Is For

- **Advocates** at the South African Bar who need to track matters across multiple instructing attorneys
- **Attorneys** managing a portfolio of litigation and commercial matters
- **Legal practitioners** who want AI assistants that understand their practice context

The system is designed around the South African legal practice model (advocate/attorney relationship, Sage One time tracking integration, ZAR billing rates) but the architecture works for any legal practice.

---

## License

[FSL-1.1-MIT](../../LICENSE.md) — No commercial derivative works.
