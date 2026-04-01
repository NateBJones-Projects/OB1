# 05 — Time Tracking Setup

Configure task types with billing rates, import your active matters, and start logging time.

---

## Step 1: Add Task Types

Task types represent the categories of work you bill for. Each has a name, rate in cents, and rate type (hourly or daily).

### Standard Advocate Task Types

These are the 55 standard task types used in South African legal practice. Adjust rates to match your own fee structure.

```bash
# Set your env vars first
export SUPABASE_URL=https://YOUR_REF.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-key
export DEFAULT_USER_ID=your-uuid
```

Insert via REST API (example batch — repeat for all your task types):

```bash
curl -s "${SUPABASE_URL}/rest/v1/task_types" \
  -X POST \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '[
    {"user_id":"'$DEFAULT_USER_ID'","name":"Administration","rate_type":"hourly","rate_cents":360000},
    {"user_id":"'$DEFAULT_USER_ID'","name":"Consultation","rate_type":"hourly","rate_cents":360000},
    {"user_id":"'$DEFAULT_USER_ID'","name":"Drafting","rate_type":"hourly","rate_cents":360000},
    {"user_id":"'$DEFAULT_USER_ID'","name":"Preparation","rate_type":"hourly","rate_cents":360000},
    {"user_id":"'$DEFAULT_USER_ID'","name":"Perusal","rate_type":"hourly","rate_cents":360000},
    {"user_id":"'$DEFAULT_USER_ID'","name":"Heads","description":"Heads of argument","rate_type":"hourly","rate_cents":360000},
    {"user_id":"'$DEFAULT_USER_ID'","name":"Settle Affidavit","rate_type":"hourly","rate_cents":360000},
    {"user_id":"'$DEFAULT_USER_ID'","name":"Trial HC","description":"High Court trial","rate_type":"daily","rate_cents":3600000},
    {"user_id":"'$DEFAULT_USER_ID'","name":"Arbitration","rate_type":"daily","rate_cents":3600000},
    {"user_id":"'$DEFAULT_USER_ID'","name":"Appeal","rate_type":"daily","rate_cents":3600000}
  ]'
```

### Rate Types

| Type | Meaning | Example |
|------|---------|---------|
| `hourly` | Rate per hour of work | R 3,600/hour |
| `daily` | Day fee (flat rate per day) | R 36,000/day |

Rate is stored in **cents** (e.g., R 3,600 = 360000 cents).

---

## Step 2: Import Active Matters

Matters represent your active cases/projects, each linked to an instructing attorney (CRM contact).

### Via AI Client

```
Add a matter: SAMPSON // LOMBARD, instructed by Anderson Attorneys
```

### Via REST API

```bash
curl -s "${SUPABASE_URL}/rest/v1/matters" \
  -X POST \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id":"'$DEFAULT_USER_ID'",
    "name":"SAMPSON // LOMBARD",
    "customer_name":"Anderson Attorneys",
    "customer_id":"uuid-of-anderson-attorneys-contact",
    "status":"active"
  }'
```

### From Sage One Export

If you export your active projects from Sage One as XLSX, you can use the import pattern from the Outlook email import recipe to bulk-load matters.

---

## Step 3: Log Time

### Via AI Client (recommended)

Tell your AI naturally:

```
Log 3 hours yesterday on the Sampson matter, drafting the founding affidavit
```

The `log_time` tool matches the matter and task type by name (partial match) and creates the entry.

### Via REST API

```bash
curl -s "${SUPABASE_URL}/rest/v1/time_entries" \
  -X POST \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id":"'$DEFAULT_USER_ID'",
    "date":"2026-03-30",
    "matter_id":"uuid-of-matter",
    "task_type_id":"uuid-of-task-type",
    "hours":3,
    "comment":"Drafting founding affidavit"
  }'
```

---

## Querying Time

### Recent entries

Ask your AI: *"Show me my time entries for the last 7 days"*

### By matter

Ask: *"How many hours have I logged on the Sampson matter?"*

### By date range

Ask: *"List my time entries from 1 March to 31 March 2026"*

---

## Time Tracking Tools

| Tool | What It Does |
|------|-------------|
| `log_time` | Log hours to a matter with task type and comment |
| `list_time_entries` | List entries filtered by matter, date range, or recent days |
| `list_matters` | List active matters grouped by instructing attorney |

---

Next: [06 — Email Import](06-email-import.md)
