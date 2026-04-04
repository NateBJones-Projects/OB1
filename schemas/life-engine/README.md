# Life Engine Schema

## What It Does

Adds five tables to your Open Brain Supabase project for personal habit tracking and daily wellbeing:

| Table | Purpose |
|-------|---------|
| `life_engine_habits` | Define habits with optional schedule (days of week, reminder time) |
| `life_engine_habit_completions` | Record when each habit is completed |
| `life_engine_checkins` | Daily mood/energy check-ins (1–5 scores + raw text) |
| `life_engine_briefings` | Log of briefing messages sent (morning reminders, evening summaries) |
| `life_engine_evolution` | Weekly self-improvement proposals from an agent, with approval status |

## Use Cases

- **Autonomous agents** — a scheduled agent sends morning habit reminders and records completions
- **Daily check-ins** — capture mood/energy scores from Telegram or any interface
- **Weekly reflection** — an agent analyses patterns and proposes one habit change per week, pending your approval
- **Briefing log** — auditable record of what was sent and when

## Setup

1. Open your [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql)
2. Copy the contents of `schema.sql` and run it
3. Edit the seed habits at the bottom before running (or delete them and add your own)

That's it — no Edge Functions required. The tables are accessed directly by agents via the Supabase service key.

## RLS Notes

Row Level Security is enabled on all tables. Autonomous agents using the service key bypass RLS. If you want to access these tables from a frontend or a non-service-key context, add appropriate RLS policies for your use case.

## Related

- [Life Engine recipe](../../recipes/life-engine/) — standalone workflow using these tables
- [Telegram Capture integration](../../integrations/telegram-capture/) — two-way Telegram interface used with this schema
