# 08 — MCP Tools Reference

Complete reference for all 18 tools in the Amicus Superbrain MCP server.

---

## Thoughts (4 tools)

### `search_thoughts`

Semantic search across all captured thoughts, imported emails, and document content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | string | Yes | What to search for (natural language) |
| limit | number | No | Max results (default: 10) |
| threshold | number | No | Similarity threshold 0-1 (default: 0.5) |

**Examples:**
- *"What did Hamish say about the Lombard affidavit?"*
- *"Find thoughts about prescription in delict"*
- *"Search for anything about SABC arbitration"*

---

### `list_thoughts`

List recent thoughts with optional filters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| limit | number | No | Max results (default: 10) |
| type | string | No | Filter: observation, task, idea, reference, person_note |
| topic | string | No | Filter by topic tag |
| person | string | No | Filter by person mentioned |
| days | number | No | Only from the last N days |

---

### `capture_thought`

Save a new thought with automatic embedding and metadata extraction.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| content | string | Yes | The thought to capture |

**Examples:**
- *"Remember that Trent Richmond wants the Cream Magenta heads by Friday"*
- *"Note: Judge Nel indicated she wants supplementary submissions by 15 April"*

---

### `thought_stats`

Summary statistics — total thoughts, type breakdown, top topics, people mentioned.

No parameters.

---

## Documents (3 tools)

### `upload_document`

Upload a PDF, DOCX, or XLSX file. Text is extracted, embedded, and made searchable.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| file_base64 | string | Yes | Base64-encoded file content |
| filename | string | Yes | Original filename with extension |
| matter_name | string | No | Matter to link to (partial match) |
| contact_name | string | No | Contact to link to (partial match) |
| description | string | No | Brief description |
| tags | string[] | No | Tags for categorization |

---

### `search_documents`

Search document registry by metadata (not content — use `search_thoughts` for content).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| matter_name | string | No | Filter by matter name |
| contact_name | string | No | Filter by contact |
| filename | string | No | Filter by filename |
| file_type | string | No | Filter: pdf, docx, xlsx |
| limit | number | No | Max results (default: 20) |

---

### `list_documents`

List all documents, grouped by matter.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| matter_name | string | No | Filter by matter |
| limit | number | No | Max results (default: 50) |

---

## CRM (7 tools)

### `add_professional_contact`

Add a new contact to your professional network.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | Yes | Full name |
| company | string | No | Firm/company |
| title | string | No | Job title |
| email | string | No | Email (used for Outlook import matching) |
| phone | string | No | Phone number |
| linkedin_url | string | No | LinkedIn URL |
| how_we_met | string | No | How you know them |
| tags | string[] | No | Tags |
| notes | string | No | Notes |

---

### `search_contacts`

Search contacts by name, company, title, notes, or tags.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | string | No | Search term (partial match across fields) |
| tags | string[] | No | Filter by tags |

---

### `log_interaction`

Log a touchpoint with a contact. Auto-updates `last_contacted`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| contact_id | string | Yes | Contact UUID |
| interaction_type | string | Yes | meeting, email, call, coffee, event, linkedin, other |
| summary | string | Yes | What happened |
| occurred_at | string | No | ISO 8601 timestamp (default: now) |
| follow_up_needed | boolean | No | Whether follow-up is needed |
| follow_up_notes | string | No | Follow-up details |

---

### `get_contact_history`

Full profile: contact details, all interactions (newest first), and linked opportunities.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| contact_id | string | Yes | Contact UUID |

---

### `create_opportunity`

Track a deal or potential engagement.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| title | string | Yes | Opportunity name |
| contact_id | string | No | Linked contact UUID |
| description | string | No | Details |
| stage | string | No | identified, in_conversation, proposal, negotiation, won, lost |
| value | number | No | Estimated value |
| expected_close_date | string | No | YYYY-MM-DD |
| notes | string | No | Notes |

---

### `get_follow_ups_due`

List contacts with follow-ups overdue or due within N days.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| days_ahead | number | No | Days to look ahead (default: 7) |

---

### `link_thought_to_contact`

Append a thought's content to a contact's notes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| thought_id | string | Yes | Thought UUID |
| contact_id | string | Yes | Contact UUID |

---

## Time Tracking (3 tools)

### `log_time`

Log billable hours. Looks up matter and task type by name (partial match).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| date | string | Yes | YYYY-MM-DD |
| matter_name | string | Yes | Matter name (partial match OK) |
| task_name | string | Yes | Task type (e.g., "Drafting", "Consultation") |
| hours | number | Yes | Hours worked |
| comment | string | No | Description of work done |

**Examples:**
- *"Log 5 hours yesterday on Russell, drafting particulars of claim"*
- *"Record 2 hours on Expand Live v SABC, consultation, meeting with Warren Bedil"*

---

### `list_time_entries`

List time entries with filters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| matter_name | string | No | Filter by matter |
| days | number | No | Only last N days |
| date_from | string | No | Start date (YYYY-MM-DD) |
| date_to | string | No | End date (YYYY-MM-DD) |
| limit | number | No | Max results (default: 50) |

---

### `list_matters`

List active legal matters, grouped by instructing attorney.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| customer_name | string | No | Filter by attorney/firm name |
| status | string | No | active, closed, on_hold (default: active) |
| limit | number | No | Max results (default: 50) |

---

## Natural Language Usage

You don't need to remember tool names or parameters. Just talk naturally to your AI:

| You say | Tool used |
|---------|-----------|
| *"What do I know about the Sampson matter?"* | `search_thoughts` |
| *"List my matters with Errol Goss"* | `list_matters` |
| *"Log 3 hours on Russell, drafting"* | `log_time` |
| *"Show me my time for this week"* | `list_time_entries` |
| *"Add a contact: Sarah Chen, DataCorp"* | `add_professional_contact` |
| *"What follow-ups are overdue?"* | `get_follow_ups_due` |
| *"Upload this affidavit to the Sampson matter"* | `upload_document` |
| *"Find all documents for Richmond Attorneys"* | `search_documents` |
