# CloudFix — Customer Health Scoring Framework

> **Purpose:** Replace gut-feel churn detection with data-driven signals. Catch at-risk customers before they cancel.

## Health Score Components (100 points total)

| Signal | Weight | Healthy (full pts) | Warning (half pts) | At Risk (0 pts) |
|--------|--------|--------------------|--------------------|------------------|
| **Implementation rate** | 25 pts | >60% applied | 30-60% applied | <30% applied |
| **Engagement (email opens/clicks)** | 20 pts | Opens monthly report | Opens sporadically | No opens in 60+ days |
| **Finder velocity** | 15 pts | New findings each month | Occasional new findings | No new findings in 60+ days |
| **RS coverage trend** (if applicable) | 15 pts | Coverage increasing or stable | Coverage flat | Coverage declining |
| **Support ticket direction** | 10 pts | Feature requests (invested) | Bug reports (tolerant) | Silence (disengaged) |
| **Renewal proximity** | 10 pts | >6 months out | 3-6 months out | <3 months out |
| **Relationship depth** | 5 pts | Multiple contacts engaged | Single contact | No responsive contact |

## Current Customer Scores (estimated from register data)

| Customer | Impl Rate | Engagement | Finders | RS Trend | Support | Renewal | Relationship | **Score** | **Status** |
|----------|-----------|------------|---------|----------|---------|---------|-------------|-----------|------------|
| BCG | 25 | 20 | 15 | 15 | 10 | 10 | 5 | **100** | Green |
| Scale AI | 25 | 20 | 15 | 15* | 10 | 10 | 3 | **98** | Green |
| Karma | 25 | 20 | 15 | 15 | 10 | 10 | 5 | **100** | Green |
| Ellucian | 25 | 15 | 15 | 8* | 10 | 10 | 5 | **88** | Green |
| SESAC | 20 | 15 | 10 | N/A | 10 | 5 | 5 | **65** | Yellow |
| Smile Brands | 15 | 15 | 10 | N/A | 10 | 10 | 5 | **65** | Yellow |
| Zaxby's | 20 | 15 | 10 | 15 | 10 | 10 | 3 | **83** | Green |
| Exiger | 25 | 15 | 10 | 8* | 10 | 10 | 5 | **83** | Green |
| LevaData | 15 | 10 | 10 | N/A | 5 | 10 | 3 | **53** | Yellow |
| SambaSafety | 12 | 15 | 10 | N/A | 10 | 0 | 5 | **52** | Yellow |
| Amgen | 20 | 10 | 10 | 0** | 10 | 10 | 5 | **65** | Yellow |
| Capita UK | 10 | 10 | 10 | N/A | 5 | 10 | 3 | **48** | Yellow |
| DistroKid | N/A | 5 | N/A | N/A | 0 | 0 | 3 | **8** | Red |
| Varicent | 10 | 10 | 5 | 0** | 5 | 5 | 3 | **38** | Yellow |
| Audacy | 5 | 5 | 5 | N/A | 0 | 5 | 3 | **23** | Red |
| Covestro | 10 | 5 | 5 | 0 | 5 | 0 | 3 | **28** | Red |

* RS recently deployed — trend not yet established
** RS stalled or not applicable

## Alert Thresholds

| Score Range | Status | Action Required |
|-------------|--------|-----------------|
| **80-100** | Green | Monthly report + quarterly check-in |
| **50-79** | Yellow | Proactive outreach within 1 week. Investigate cause. |
| **0-49** | Red | Immediate intervention. Offer rescue (free RS, discount, call). |

## n8n Workflow Design

```
1. CRON trigger (weekly, Monday 7 AM UTC)
      │
2. FOR EACH customer:
   │
   ├─ Pull CloudFix data:
   │  • Implementation rate (applied/identified)
   │  • New findings count (last 30 days)
   │  • RS coverage % and trend
   │
   ├─ Pull email engagement (Shortwave/Gmail API):
   │  • Last open/click date
   │
   ├─ Pull support ticket status:
   │  • Open tickets, direction (feature/bug/silence)
   │
   ├─ Check renewal date:
   │  • Days until renewal
   │
   ├─ Calculate health score
   │
   └─ IF score dropped >15 pts in 30 days:
      → Send Google Chat alert: "[Customer] health dropped from X to Y"
      → Include specific signals that changed
      → Suggest action from thresholds above
      │
3. Update Google Sheet (customer health dashboard)
   Score, trend, last updated
```

## Immediate Actions (from current scores)

### Red — Act Now
| Customer | Score | Why | Action |
|----------|-------|-----|--------|
| Audacy | 23 | Stack never phoned home, no engagement | Call Adam Shero — confirm if still interested |
| Covestro | 28 | RS closed, CF status unclear | Verify CF still active, assess if recoverable |
| DistroKid | 8 | No budget until 2026, minimal engagement | Keep warm, plan for 2026 outreach calendar |

### Yellow — This Week
| Customer | Score | Why | Action |
|----------|-------|-----|--------|
| Capita UK | 48 | Constrained by contact centre spend | Check in with David Phillips on business case progress |
| Varicent | 38 | Structural RI issue, AWS co-selling complexity | Review with Dmitry — is there a path forward? |
| SambaSafety | 52 | Renewal due, 37% implementation rate | Push renewal + show remaining $408K upside |
| LevaData | 53 | Small, minimum price, declining spend | Leverage Jigar Patel at Banneker for expansion |
| Amgen | 65 | RS stalled for years, $1.4M potential | Re-engage Tamer Nassar — SSO now resolved |

### Green — Maintain
Standard monthly report, quarterly check-in cadence.
