# CloudFix — Automated Value-Delivered Report

> **Purpose:** Replace the manual monthly customer outreach with an automated, data-rich report that makes savings visible. Directly addresses the churn pattern where customers say "we can't see new value."

## Report Structure (per customer, monthly)

```
Subject: Your CloudFix Monthly Savings Report — [Month Year]

---

Hi [First Name],

Here's your CloudFix savings summary for [Month]:

## Savings This Month
- **Total savings identified:** $X,XXX
- **Total savings applied:** $X,XXX ([XX]% implementation rate)
- **New recommendations:** XX findings across [service list]

## What Changed Since Last Month
- [New finder type] found $X,XXX in savings
- [Service] spend changed by +/-$X,XXX
- Coverage: [XX]% ESR (was [XX]% last month)

## Top 3 Opportunities Still Available
1. [Recommendation] — $X,XXX/yr savings
2. [Recommendation] — $X,XXX/yr savings  
3. [Recommendation] — $X,XXX/yr savings

[If RightSpend customer:]
## RightSpend Update
- RI/SP coverage: [XX]%
- Net new savings this month: $X,XXX
- Annual run-rate savings: $X,XXX

---

Questions? Reply to this email or book a call: [link]
```

## n8n Workflow Design

### Trigger
- **Schedule:** 1st of each month, 6 AM UTC
- **Data pull:** CloudFix API / Supabase query per customer

### Workflow Steps

```
1. CRON trigger (monthly, 1st)
      │
2. Get customer list from Supabase
   (active CF customers with email contacts)
      │
3. FOR EACH customer:
   │
   ├─ Query CloudFix/Supabase for:
   │  • Current month savings (identified + applied)
   │  • Previous month savings (for comparison)
   │  • New recommendations count and top 3
   │  • ESR coverage percentage
   │  • New finder types released
   │  • [If RS] RI/SP coverage, net new savings
   │
   ├─ LLM node: Generate personalized summary
   │  (feed data + customer context from Open Brain)
   │
   ├─ Format email (HTML template)
   │
   └─ Send via Gmail/Shortwave SMTP
      │
4. Log send to Google Sheet (audit trail)
      │
5. Set Shortwave reminder: follow up in 7 days if no reply
```

### Data Sources Required

| Data Point | Source | Query |
|------------|--------|-------|
| Savings identified | CloudFix/Supabase | Per customer, per month |
| Savings applied | CloudFix/Supabase | Per customer, per month |
| Implementation rate | Calculated | Applied / Identified |
| New recommendations | CloudFix/Supabase | New findings this month |
| ESR coverage | CloudFix/Supabase | Current % |
| Previous month comparison | CloudFix/Supabase | Month-over-month delta |
| RI/SP coverage (RS) | RightSpend data | Current % |
| Customer contact info | Supabase/Open Brain | Primary contact email |
| Customer context | Open Brain | For personalization |

### Customer-Specific Adjustments

| Customer | Notes |
|----------|-------|
| BCG | Include RS detail prominently — Jorge reviews monthly |
| Ellucian | Highlight Jira integration results — Matthew is engineering-led |
| Karma | Lead with RS savings jumps — John loves seeing the numbers |
| Amgen | Focus on multi-tenant aggregation — complex environment |
| Capita UK | Acknowledge contact centre limitation, show what IS deliverable |
| Scale AI | Early stage — emphasize quick wins and RI coverage improvement |

### Implementation Priority

1. **Phase 1 (this week):** Manual version — pull data from CloudFix, draft in LLM, send via Shortwave. Proves the value before automating.
2. **Phase 2 (next 2 weeks):** Semi-automated — n8n pulls data and generates draft, you review and send.
3. **Phase 3 (month 3):** Fully automated — n8n sends directly, you get a copy and handle replies.

### Why This Works

The churn pattern is: "we can't see new value." This report makes value **impossible to miss**. Every month the customer sees:
- Exact dollar amounts saved
- What changed (environments evolve, AWS changes, new finders)
- What's still on the table (FOMO on remaining savings)

It turns your monthly outreach from "just checking in" into a **proof of continued value delivery**.
