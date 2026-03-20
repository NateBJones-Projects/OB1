# Market Signals

> Track customer pain points, feature requests, and competitive gaps so your agent can surface what to build next.

## What It Does

Adds a `market_signals` table to your Supabase database that accumulates product intelligence from Reddit, forums, LinkedIn, conversations, and support channels. Each signal is typed (pain point, feature request, competitor gap, workflow complaint, willingness to pay), scored by intensity, and tagged with topics — so your agent can reason across hundreds of signals to find patterns you'd miss reading posts one at a time.

The real value is **time-bridging**: one complaint means nothing, but the same complaint from 20 different people over 3 months means "build this."

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))

## Credential Tracker

```text
MARKET SIGNALS -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________

--------------------------------------
```

## Steps

![Step 1](https://img.shields.io/badge/Step_1-Run_the_Migration-1E88E5?style=for-the-badge)

1. Open your Supabase SQL Editor
2. Run the SQL migration:

<details>
<summary>📋 <strong>SQL: Create market_signals table</strong> (click to expand)</summary>

```sql
CREATE TABLE market_signals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  signal text NOT NULL,
  source_url text,
  source_type text DEFAULT 'reddit',
  product text DEFAULT 'default',
  signal_type text NOT NULL CHECK (
    signal_type IN (
      'pain_point',
      'feature_request',
      'competitor_gap',
      'workflow_complaint',
      'willingness_to_pay'
    )
  ),
  category text,
  intensity int CHECK (intensity BETWEEN 1 AND 5) DEFAULT 3,
  frequency_note text,
  people text[] DEFAULT '{}',
  topics text[] DEFAULT '{}',
  raw_quote text,
  created_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'
);

-- Row Level Security: service_role only
ALTER TABLE market_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON market_signals
  FOR ALL USING (auth.role() = 'service_role');

-- Grant permissions to service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.market_signals TO service_role;

-- Performance indexes
CREATE INDEX idx_signals_product ON market_signals(product);
CREATE INDEX idx_signals_type ON market_signals(signal_type);
CREATE INDEX idx_signals_category ON market_signals(category);
CREATE INDEX idx_signals_created ON market_signals(created_at DESC);
CREATE INDEX idx_signals_topics ON market_signals USING GIN(topics);
```

</details>

✅ **Done when:** You can run `SELECT * FROM market_signals;` in the SQL Editor and get an empty result set (no errors).

![Step 2](https://img.shields.io/badge/Step_2-Test_an_Insert-1E88E5?style=for-the-badge)

Run a test insert to confirm everything works:

```sql
INSERT INTO market_signals (signal, signal_type, category, intensity, raw_quote, topics)
VALUES (
  'Users frustrated by unclear classification pathways',
  'pain_point',
  'classification',
  4,
  'I spent 3 weeks trying to figure out if my device is Class II or III',
  ARRAY['classification', 'FDA', '510k']
);

SELECT id, signal, signal_type, intensity, topics, created_at
FROM market_signals;
```

✅ **Done when:** You see your test signal returned with all fields populated.

> [!TIP]
> Delete the test row after confirming: `DELETE FROM market_signals;`

## Expected Outcome

After running the migration, your database has:

- **`market_signals` table** with 14 columns for capturing product intelligence
- **RLS enabled** — only your service role key can read/write (no anonymous access)
- **5 indexes** for fast filtering by product, signal type, category, date, and topics
- **CHECK constraint** on `signal_type` ensuring only valid types are inserted

## Column Reference

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Auto-generated primary key |
| `signal` | text | The pain point or request — summarized clearly |
| `source_url` | text | Where you found it (Reddit post, forum thread, etc.) |
| `source_type` | text | `reddit`, `forum`, `linkedin`, `review`, `competitor`, `conversation`, `support` |
| `product` | text | Which of your products this signal is relevant to |
| `signal_type` | text | `pain_point`, `feature_request`, `competitor_gap`, `workflow_complaint`, `willingness_to_pay` |
| `category` | text | Domain category — customize for your product area |
| `intensity` | int (1-5) | How strongly expressed: 1 = passing mention, 5 = furious rant |
| `frequency_note` | text | Your assessment: "first mention" or "seen this 10+ times" |
| `people` | text[] | Who mentioned it (username, company, or "anonymous") |
| `topics` | text[] | Freeform tags for cross-referencing |
| `raw_quote` | text | Exact customer words — the gold for understanding real pain |
| `created_at` | timestamptz | When the signal was captured |
| `metadata` | jsonb | Flexible — upvote counts, thread context, market size hints |

## How to Use It

### Capture Signals

**Through your agent (conversational capture):**

Tell your agent things like:
- *"I just saw a Reddit post where someone spent 3 weeks figuring out device classification. Save that as a pain_point signal."*
- *"Someone on LinkedIn said they'd pay $500/year for automated QMS document control. That's a willingness_to_pay signal."*

**Directly via SQL:**

```sql
INSERT INTO market_signals (signal, source_url, source_type, signal_type, category, intensity, topics, raw_quote)
VALUES (
  'Teams want automated QMS document version control',
  'https://reddit.com/r/qualitymanagement/...',
  'reddit',
  'feature_request',
  'QMS',
  4,
  ARRAY['QMS', 'document-control', 'automation'],
  'We spend 2 hours a week just managing document versions. Would kill for something automated.'
);
```

### Query Patterns

Ask your agent questions like these once you have 30+ signals:

1. **"What are the top 5 pain points customers have right now?"** — Clusters signals by theme, ranks by frequency × intensity.
2. **"Has anyone said they'd pay for something we could build?"** — Filters for `willingness_to_pay` signals — your highest-value leads.
3. **"What are people complaining about that no competitor solves?"** — Filters for `competitor_gap` — your blue ocean opportunities.
4. **"Does our roadmap match what customers actually want?"** — Cross-references signals against your project decisions in the `thoughts` table.

### The Four Principles in Action

**Time-Bridging:** Individual signals are noise. The table accumulates them over weeks and months so your agent can say *"QMS document control has been the #1 pain point for 8 weeks — 23 mentions across 4 sources."*

**Cross-Category Reasoning:** Connect signals to your `thoughts` table. When you decide to build something, your agent can validate: *"You chose to build PDF export, but the top signal cluster is classification confusion. Want to reconsider?"*

**Proactive Surfacing:** Set a weekly agent scan. Without being asked, your agent can flag: *"3 new willingness-to-pay signals this week — all about regulatory submission tracking."*

**Judgment Line:** Your agent surfaces patterns and evidence. **You** decide what to build, how to price it, and which market to go after. The agent shows 20 people want feature X — you decide if feature X is worth your time.

## Troubleshooting

**Issue: INSERT fails with "violates check constraint"**
Solution: Make sure `signal_type` is exactly one of: `pain_point`, `feature_request`, `competitor_gap`, `workflow_complaint`, `willingness_to_pay`. These are case-sensitive.

**Issue: Query returns empty results but data exists**
Solution: You're likely querying with the anon key instead of the service role key. RLS restricts this table to `service_role` only. Check your Supabase client configuration.

**Issue: GIN index error on `topics`**
Solution: Make sure you're inserting topics as a proper PostgreSQL array: `ARRAY['tag1', 'tag2']` in SQL, or `["tag1", "tag2"]` via the Supabase client library.
