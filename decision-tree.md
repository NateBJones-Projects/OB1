# CloudFix — Approach Selection Decision Tree

> **Rule:** Don't spin. Pick the first match and go. You can always switch — but starting beats optimizing.

## What kind of task is this?

```
1. "I need to FIND something"
   ├─ About a customer?        → Shortwave (search email history first)
   ├─ About AWS spend/data?    → CloudFix dashboard or Supabase query
   ├─ About a deal/contract?   → Salesforce (closed deals) or Shortwave (open deals)
   ├─ About a workflow?        → n8n (check the workflow directly)
   └─ About anything else?     → Ask an LLM — it's faster than searching

2. "I need to DO something for a customer"
   ├─ Respond to a question?   → Check CloudFix dashboard for data, then email
   ├─ Send a monthly update?   → Pull CloudFix savings → draft in LLM → send via Shortwave
   ├─ Onboard new prospect?    → Send CF stack link → set Shortwave reminder for 1 week
   └─ Rescue a churn risk?     → Offer free RightSpend → email + set follow-up reminder

3. "I need to BUILD or AUTOMATE something"
   ├─ Repeating manual task?   → Build n8n workflow
   ├─ One-time data extraction?→ Ask LLM to write a script or use Supabase query
   ├─ Website change?          → Feed to LLM coding agent → WordPress/GitHub
   └─ Not sure if worth it?    → If you've done it twice, automate it. Once? Do it manually.

4. "I need to WRITE something"
   ├─ Customer email?          → LLM first draft → personalize → send
   ├─ Report (finance/boss)?   → Export data → LLM to format → Google Sheets if needed
   ├─ RFP/proposal?            → LLM outline → fill in specifics → review
   └─ Support article?         → Write it directly (you know the product best)

5. "I need to ANALYZE something"
   ├─ Customer AWS spend?      → CloudFix dashboard + Supabase query
   ├─ Sales pipeline?          → Shortwave (open) + Salesforce (closed) — it's all there
   ├─ Business trend?          → Ask LLM with context from Open Brain
   └─ Product performance?     → CloudFix finder data → pattern hunt

6. "I don't know what to do today"
   ├─ Check Shortwave todo list
   ├─ Check Google Chat alerts
   ├─ Check if any customer hasn't had outreach this month
   └─ Pick the one with a deadline or revenue attached — that one first
```

## Quick Reference: Tools by Purpose

| Need | Tool | Why |
|------|------|-----|
| Customer history | Shortwave | Your inbox IS your CRM |
| AWS/savings data | CloudFix + Supabase | Source of truth for all technical data |
| Closed deals | Salesforce | Only place those live |
| Drafting/writing | LLM | Fast first drafts, always |
| Automation | n8n | 25 workflows already running |
| Customer signals | Google Chat alerts | Daily pulse — if it stops, check n8n |
| Personal memory | Open Brain | Institutional knowledge that survives you |
| Partner context | Email history (Wes at Insight) | No other record exists |

## The Anti-Procrastination Protocol

When you're spinning on HOW to start something:

1. **Identify the task type** (find / do / build / write / analyze) — 10 seconds
2. **Pick the first tool that matches** — 5 seconds
3. **Open that tool immediately** — don't think, just open it
4. **Start typing** — the first sentence doesn't matter, the second one will be better

If you're still stuck after 2 minutes: ask an LLM to help you think through the approach. That's not cheating — it's using the right tool.
