# Reading List

> Adds a `reading_list` table for tracking books, articles, podcasts, and videos with ratings, review notes, and status tracking (want to read → reading → finished).

## What It Does

Creates a standalone `reading_list` table — books, articles, podcasts, and videos you want to consume, are consuming, or have finished — with a 1–5 rating, free-form review notes, start/finish dates, and JSONB tags. It also installs an auto-updating `updated_at` trigger and a `currently_reading` convenience view.

This is the reading-list schema listed as planned in the repo README. It does **not** modify the core `thoughts` table; if you highlight while you read, pair it with the [readwise-books](../readwise-books/) schema, which caches book-level metadata for highlights stored in `thoughts`.

**Valid types:** `book`, `article`, `podcast`, `video`
**Valid statuses:** `want_to_read`, `reading`, `finished`, `abandoned`

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Access to the Supabase SQL Editor or CLI

## Credential Tracker

```text
READING LIST -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________

--------------------------------------
```

## Steps

![Step 1](https://img.shields.io/badge/Step_1-Run_Migration-1E88E5?style=for-the-badge)

1. Open your **Supabase SQL Editor** (Dashboard > SQL Editor)
2. Paste and run the contents of [`schema.sql`](schema.sql)

Or via the Supabase CLI, save it under `supabase/migrations/` and run:

```bash
supabase db push
```

![Step 2](https://img.shields.io/badge/Step_2-Verify-1E88E5?style=for-the-badge)

1. Verify the table exists with the expected columns:

   ```sql
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_name = 'reading_list'
   ORDER BY ordinal_position;
   ```

2. Insert a test row and read it back through the view:

   ```sql
   INSERT INTO reading_list (title, author, type, status, started_date, tags)
   VALUES ('Thinking, Fast and Slow', 'Daniel Kahneman', 'book', 'reading', CURRENT_DATE, '["psychology"]');

   SELECT * FROM currently_reading;
   ```

![Step 3](https://img.shields.io/badge/Step_3-Use_It-1E88E5?style=for-the-badge)

Common queries:

```sql
-- Finish a book and rate it
UPDATE reading_list
SET status = 'finished', finished_date = CURRENT_DATE, rating = 5,
    review_notes = 'System 1 vs System 2 framing changed how I plan my mornings.'
WHERE title = 'Thinking, Fast and Slow';

-- Want-to-read queue, articles only
SELECT title, author, url FROM reading_list
WHERE status = 'want_to_read' AND type = 'article'
ORDER BY created_at;

-- Everything tagged "ai" rated 4+
SELECT title, type, rating FROM reading_list
WHERE tags @> '["ai"]' AND rating >= 4
ORDER BY rating DESC;

-- Reading history, most recent finishes first
SELECT title, author, rating, finished_date FROM reading_list
WHERE status = 'finished'
ORDER BY finished_date DESC;
```

## Expected Outcome

After running the migration:

- A `reading_list` table exists with columns: `id`, `title`, `author`, `type`, `status`, `rating`, `review_notes`, `url`, `started_date`, `finished_date`, `tags`, `created_at`, `updated_at`
- `type`, `status`, and `rating` are constrained to valid values (`rating` must be 1–5; a `finished_date` can never precede `started_date`)
- Five indexes support the common filters (status, type, rating, tag containment, finish-date timeline)
- Updating any row automatically refreshes its `updated_at` timestamp
- A `currently_reading` view returns in-progress items, most recently started first

> [!TIP]
> The migration is idempotent — safe to run multiple times. `IF NOT EXISTS` / `CREATE OR REPLACE` prevent duplicate objects.

## Troubleshooting

**Issue: `new row for relation "reading_list" violates check constraint`**
Solution: One of the constrained fields has an invalid value. Check that `type` is one of `book | article | podcast | video`, `status` is one of `want_to_read | reading | finished | abandoned`, `rating` is between 1 and 5 (or NULL), and `finished_date` is not earlier than `started_date`.

**Issue: Tag queries return nothing**
Solution: `tags` is a JSONB *array* — insert `'["ai", "productivity"]'`, not `'{"ai": true}'` or a comma-separated string. Query containment with `tags @> '["ai"]'`.

**Issue: `updated_at` isn't changing on UPDATE**
Solution: The trigger may not have been created (e.g. the migration was only partially run). Re-run `schema.sql` — the `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` block is safe to repeat.

**Issue: I want statuses the schema doesn't allow (e.g. `on_hold`)**
Solution: Extend the CHECK constraint:
```sql
ALTER TABLE reading_list DROP CONSTRAINT reading_list_status_check;
ALTER TABLE reading_list ADD CONSTRAINT reading_list_status_check
  CHECK (status IN ('want_to_read', 'reading', 'finished', 'abandoned', 'on_hold'));
```
