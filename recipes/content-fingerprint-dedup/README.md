# Content Fingerprint Dedup

> SHA-256 content fingerprinting to prevent duplicate thoughts during bulk imports and multi-source capture.

## What It Is

A `content_fingerprint` column on the `thoughts` table that stores a SHA-256 hash of normalized content, backed by a unique index. When you insert a thought, the database checks the fingerprint and either creates a new row or merges into the existing one. This makes every insert idempotent with zero runtime cost.

## Why It Matters

Without dedup, bulk imports create duplicates. If you import the same ChatGPT export twice, you get double the rows. If Slack retries a webhook delivery (which it does on any timeout), you get two rows for the same message. If you capture from both a Chrome extension and the MCP server, overlapping content creates duplicates.

Content fingerprint dedup solves all of that at the database level. Re-running any import produces zero new rows for content that already exists.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- The `thoughts` table must already exist

## How It Works

The dedup chain has three parts:

1. **Normalization** — Before hashing, content is lowercased, trimmed, and has all whitespace collapsed to single spaces. This means "Hello  World" and "hello world" produce the same fingerprint.

2. **Fingerprinting** — The normalized string is hashed with SHA-256, producing a deterministic 64-character hex string.

3. **Upsert** — An `INSERT ... ON CONFLICT (content_fingerprint) DO UPDATE` merges metadata into the existing row instead of creating a duplicate.

```
Input: "  Hello   World  "
  → normalize: "hello world"
  → SHA-256:   "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
  → INSERT or merge into existing row with that fingerprint
```

## Step-by-Step Guide

### Step 1: Add the fingerprint column

Run this in your Supabase SQL Editor:

```sql
ALTER TABLE thoughts ADD COLUMN content_fingerprint TEXT;

CREATE UNIQUE INDEX idx_thoughts_fingerprint
  ON thoughts (content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;
```

The partial index (`WHERE content_fingerprint IS NOT NULL`) means existing rows without fingerprints won't conflict with each other.

### Step 2: Create the upsert RPC

```sql
CREATE OR REPLACE FUNCTION upsert_thought(p_content TEXT, p_payload JSONB DEFAULT '{}')
RETURNS JSONB AS $$
DECLARE
  v_fingerprint TEXT;
  v_result JSONB;
  v_id UUID;
BEGIN
  v_fingerprint := encode(sha256(convert_to(
    lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))),
    'UTF8'
  )), 'hex');

  INSERT INTO thoughts (content, content_fingerprint, metadata)
  VALUES (p_content, v_fingerprint, COALESCE(p_payload->'metadata', '{}'::jsonb))
  ON CONFLICT (content_fingerprint) WHERE content_fingerprint IS NOT NULL DO UPDATE
  SET updated_at = now(),
      metadata = thoughts.metadata || COALESCE(EXCLUDED.metadata, '{}'::jsonb)
  RETURNING id INTO v_id;

  v_result := jsonb_build_object('id', v_id, 'fingerprint', v_fingerprint);
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;
```

Now call it from your Edge Function or import script:

```sql
SELECT upsert_thought('My thought content', '{"metadata": {"source": "chatgpt"}}'::jsonb);
```

### Step 3: Backfill existing rows (optional)

If you already have thoughts in the table, generate fingerprints for them:

```sql
UPDATE thoughts
SET content_fingerprint = encode(sha256(convert_to(
  lower(trim(regexp_replace(content, '\s+', ' ', 'g'))),
  'UTF8'
)), 'hex')
WHERE content_fingerprint IS NULL;
```

For large tables (10K+ rows), batch the backfill to avoid long locks:

```sql
UPDATE thoughts
SET content_fingerprint = encode(sha256(convert_to(
  lower(trim(regexp_replace(content, '\s+', ' ', 'g'))),
  'UTF8'
)), 'hex')
WHERE id IN (
  SELECT id FROM thoughts
  WHERE content_fingerprint IS NULL
  LIMIT 5000
);
-- Repeat until no rows remain
```

## Expected Outcome

After completing this guide:

- Every new thought gets a `content_fingerprint` on insert.
- Inserting the same content twice updates the existing row instead of creating a duplicate.
- Re-running any import produces **0 new rows** for already-imported content.
- The unique index enforces the constraint at the database level — no application code can bypass it.

Verify it works:

```sql
-- Insert twice, get the same ID back
SELECT upsert_thought('Test dedup');
SELECT upsert_thought('Test dedup');

-- Should return 1, not 2
SELECT count(*) FROM thoughts WHERE content LIKE 'Test dedup';
```

## Troubleshooting

**Issue: "duplicate key value violates unique constraint idx_thoughts_fingerprint"**
This means you are inserting directly (not using `upsert_thought`) and the content already exists. Switch to calling `upsert_thought` instead of raw `INSERT`, or add your own `ON CONFLICT` clause.

**Issue: Backfill is slow on large tables**
Use the batched approach from Step 3. Run it in chunks of 5,000 rows. Each batch takes a few seconds on tables up to 100K rows.

**Issue: Two different thoughts produce the same fingerprint**
SHA-256 collisions are practically impossible (1 in 2^128). If you see this, the content is likely identical after normalization. Check for leading/trailing whitespace or casing differences in the original content.

**Issue: content_fingerprint is NULL for some rows**
Rows inserted before fingerprint dedup was added will have NULL fingerprints. Run the backfill query from Step 3.

## Works Well With

- **[Email History Import](../../recipes/email-history-import/README.md)** — Gmail import computes SHA-256 fingerprints on each email. With fingerprint dedup deployed, re-running an import produces zero duplicates.
- All other import recipes (ChatGPT, Google Activity, etc.) become safely re-runnable.
- Webhook-based capture (Slack, Telegram) is protected against retry-induced duplicates.
- Multi-source capture (Chrome extension + MCP server) avoids cross-channel duplicates.

## Scale Reference

This recipe has been tested against **75,000+ thoughts** across 9 sources (ChatGPT, Claude, Gemini, Grok, X/Twitter, Instagram, Google Activity, Limitless, Journals) with zero duplicates in production.

## Further Reading

- [PostgreSQL SHA-256 functions](https://www.postgresql.org/docs/current/functions-binarystring.html)
- [Partial unique indexes](https://www.postgresql.org/docs/current/indexes-partial.html)
- [INSERT ON CONFLICT (upsert)](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT)
