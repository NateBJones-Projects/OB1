# Fingerprint Dedup Backfill

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@alanshurafa](https://github.com/alanshurafa)**

*Reviewed and merged by the Open Brain maintainer team — thank you for building the future of AI memory!*

</div>

> Backfill content fingerprints on existing thoughts and safely remove duplicates discovered during the process.

## What It Does

If you imported thoughts before the [Content Fingerprint Dedup](../../primitives/content-fingerprint-dedup/) primitive was in place, those rows will have a NULL `content_fingerprint`. This recipe computes fingerprints for all existing rows and then identifies and removes duplicates — rows whose content already exists in the table under a properly fingerprinted copy.

Two scripts work together:

1. **`backfill-fingerprints.mjs`** — Scans all NULL-fingerprint rows and patches each one with a computed SHA-256 fingerprint. Resumable via state file.

2. **`delete-duplicates.mjs`** — Finds NULL-fingerprint rows whose content already has a fingerprinted copy in the table. Defaults to **report-only mode** (no deletions). Pass `--delete` to actually remove duplicates.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- [Content Fingerprint Dedup](../../primitives/content-fingerprint-dedup/) primitive applied (so `content_fingerprint` column exists)
- Node.js 18+

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
FINGERPRINT DEDUP BACKFILL -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase URL:            ____________
  Service role key:        ____________

--------------------------------------
```

## Steps

**1. Clone or download this recipe**

Copy the recipe folder to your local machine.

**2. Configure credentials**

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```bash
cp .env.example .env
# Edit .env with your Supabase URL and service role key
```

**3. Run the backfill**

This computes and patches fingerprints for all rows where `content_fingerprint` is NULL:

```bash
node backfill-fingerprints.mjs
```

The script processes rows in batches of 1000, saving progress to `backfill-state.json` after each batch. If interrupted, it resumes from where it left off.

**4. Generate a duplicate report**

Before deleting anything, see what would be removed:

```bash
node delete-duplicates.mjs --report-only
```

This scans remaining NULL-fingerprint rows, computes their fingerprints, and reports how many are duplicates of existing fingerprinted rows — without deleting anything.

**5. Remove duplicates (when ready)**

Once you've reviewed the report and are satisfied:

```bash
node delete-duplicates.mjs --delete
```

> [!CAUTION]
> The `--delete` flag permanently removes rows. Make sure you've reviewed the report first. The script also backfills fingerprints on any genuine orphan rows (those with no existing duplicate).

## Expected Outcome

After running both scripts:

- Every row in the `thoughts` table has a non-NULL `content_fingerprint`
- No duplicate content exists (each unique fingerprint appears once)
- The `content_fingerprint` unique constraint is now fully enforceable

Verify with:

```sql
-- Count remaining NULL fingerprints (should be 0)
select count(*) from thoughts where content_fingerprint is null;

-- Check for duplicate fingerprints (should return 0 rows)
select content_fingerprint, count(*) as copies
from thoughts
where content_fingerprint is not null
group by content_fingerprint
having count(*) > 1
limit 10;
```

## How the Fingerprint Is Computed

The normalization matches the [Content Fingerprint Dedup](../../primitives/content-fingerprint-dedup/) primitive exactly:

1. Trim whitespace and collapse runs of whitespace to single spaces
2. Lowercase
3. Strip trailing punctuation (`.!?;:,`)
4. Strip possessives (`'s` and `\u2019s`)
5. Strip trailing `s` from the last word if the word has 4+ characters
6. SHA-256 hex digest of the result

This means "The dog's toys." and "the dogs toy" produce the same fingerprint.

## Troubleshooting

**Issue: Script reports many "duplicate" PATCH errors (409 / 23505)**
Solution: This means the computed fingerprint already exists on another row. The backfill script counts these but skips them — this is expected behavior. Run the cleanup script afterward to remove the duplicates.

**Issue: Script hangs or times out on large tables**
Solution: The scripts use cursor-based pagination and save state after each batch. If a request times out, the script retries after 5 seconds. For very large tables (100K+), expect the backfill to take 10-30 minutes.

**Issue: `content_fingerprint` column doesn't exist**
Solution: Apply the [Content Fingerprint Dedup](../../primitives/content-fingerprint-dedup/) primitive first. The column must exist before running these scripts.

**Issue: Want to reset and start over**
Solution: Delete the state file (`backfill-state.json` or `cleanup-state.json`) and run the script again. It will start from the beginning.
