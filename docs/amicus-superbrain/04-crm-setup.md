# 04 — CRM Setup

Add your professional contacts — instructing attorneys, firms, and key people in your practice.

---

## Adding Contacts

### Via AI Client (Claude/ChatGPT)

Simply tell your AI:

```
Add a professional contact:
  Name: Hamish Anderson
  Company: Anderson Attorneys
  Email: hamish@anderson-law.co.za
  Tags: litigation, Johannesburg
```

The `add_professional_contact` tool handles the rest.

### Via Supabase Dashboard

Insert directly in **Table Editor > professional_contacts**:

| Column | Example |
|--------|---------|
| user_id | your-uuid (from credential tracker) |
| name | Hamish Anderson |
| company | Anderson Attorneys |
| email | hamish@anderson-law.co.za |
| tags | {litigation, johannesburg} |

### Bulk Import via Script

For large contact lists, use the Supabase REST API:

```bash
curl -s "${SUPABASE_URL}/rest/v1/professional_contacts" \
  -X POST \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '[
    {"user_id":"YOUR_UUID","name":"John Smith","company":"Smith Attorneys","email":"john@smith.co.za"},
    {"user_id":"YOUR_UUID","name":"Jane Doe","company":"Doe Inc","email":"jane@doe.co.za"}
  ]'
```

---

## Contact Fields

| Field | Required | Description |
|-------|----------|-------------|
| name | Yes | Full name |
| company | No | Firm or company name |
| title | No | Job title |
| email | No | Email address (used for Outlook import matching) |
| phone | No | Phone number |
| linkedin_url | No | LinkedIn profile URL |
| how_we_met | No | How you know this person |
| tags | No | Array of tags for filtering |
| notes | No | Free-text notes |
| follow_up_date | No | Date for follow-up reminder |

---

## CRM Tools

| Tool | What It Does |
|------|-------------|
| `add_professional_contact` | Add a new contact |
| `search_contacts` | Search by name, company, tags |
| `log_interaction` | Log a meeting, call, email, etc. |
| `get_contact_history` | Full profile + all interactions + opportunities |
| `create_opportunity` | Track a deal or potential engagement |
| `get_follow_ups_due` | List overdue and upcoming follow-ups |
| `link_thought_to_contact` | Link a captured thought to a contact |

---

## Interaction Types

When logging interactions, use one of: `meeting`, `email`, `call`, `coffee`, `event`, `linkedin`, `other`.

The Outlook email import (see [06 — Email Import](06-email-import.md)) automatically logs interactions of type `email` for every imported message.

---

## Follow-ups

Set a follow-up date on a contact:

```sql
UPDATE professional_contacts
SET follow_up_date = '2026-04-15'
WHERE name = 'Hamish Anderson';
```

Then ask your AI: *"What follow-ups are due this week?"* — the `get_follow_ups_due` tool will list them.

---

Next: [05 — Time Tracking Setup](05-time-tracking-setup.md)
