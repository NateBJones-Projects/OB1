# Entity Extraction Schema

> Tables, trigger, and queue for **automatic** entity and relationship extraction from thoughts. Complements the community [`recipes/ob-graph/`](../../recipes/ob-graph/) manual graph layer — this is the extraction side.

## Positioning

`ob-graph` gives you a clean 2-table manual graph (`graph_nodes`, `graph_edges`) that you build up via MCP calls. It's the right choice if you want to sketch relationships by hand.

`entity-extraction` is the other half of the story: automatic extraction from the `thoughts` content you already have. It adds a typed entity table, an edges table with evidence + confidence, a queue for async processing, and a trigger that enqueues new thoughts for you. Pair it with the companion `integrations/entity-extraction-worker/` edge function (opens in a separate PR) to actually run the extraction.

The two schemas are independent — you can install either, both, or neither. They don't share tables or functions.

## What It Does

- **`entities`** — Canonical nodes: people, projects, topics, tools, organizations, places. Deduplicates by normalized name within each type.
- **`edges`** — Typed relationships (`co_occurs_with`, `works_on`, `uses`, `related_to`, `member_of`, `located_in`) with support counts and confidence scores.
- **`thought_entities`** — Evidence-bearing links: which thought mentions which entity, in what role, with what extraction confidence, from which source.
- **`entity_extraction_queue`** — Async work queue. Tracks attempt counts, errors, and content fingerprints so the worker can skip no-op updates.
- **`consolidation_log`** — Audit trail for dedup merges, metadata fixes, and bio synthesis.
- A trigger on `thoughts` enqueues new/updated rows automatically, skipping system-generated artifacts and fingerprint no-ops.

## Prerequisites

- Working Open Brain setup (see [`docs/01-getting-started.md`](../../docs/01-getting-started.md))
- Supabase project with the `thoughts` table, `match_thoughts`, and `upsert_thought`
- The `content_fingerprint` column on `thoughts` (from Step 2.6 of getting-started)
- **Optional but recommended:** [`schemas/enhanced-thoughts/`](../enhanced-thoughts/) for the `type` / `sensitivity_tier` / `source_type` columns the extraction worker uses for gating

## Credential Tracker

```text
ENTITY EXTRACTION -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________

--------------------------------------
```

## Steps

1. Open your Supabase dashboard and navigate to the **SQL Editor**
2. Create a new query and paste the full contents of `schema.sql`
3. Click **Run** to execute the migration
4. Open **Table Editor** and confirm five new tables appear: `entities`, `edges`, `thought_entities`, `entity_extraction_queue`, `consolidation_log`
5. Navigate to **Database > Functions** and verify the `queue_entity_extraction` function exists
6. Navigate to **Database > Triggers** on the `thoughts` table and verify `trg_queue_entity_extraction` is attached
7. Test the trigger by capturing a new thought (via the MCP server or direct insert) and checking the queue:

   ```sql
   SELECT count(*) FROM entity_extraction_queue WHERE status = 'pending';
   -- Should return at least 1 after capturing a thought
   ```

8. *(Optional — existing brains only)* To backfill the extraction queue with pre-existing thoughts, uncomment and run the backfill section at the bottom of `schema.sql`
9. Install the companion [`integrations/entity-extraction-worker/`](../../integrations/entity-extraction-worker/) edge function to actually process the queue (separate PR)

## Expected Outcome

After running the migration:

- Five new tables with appropriate columns, constraints, and defaults.
- Eight indexes for efficient querying: entity type and normalized name lookups, edge traversal by source/target/relation, thought-entity joins, and a partial index on pending queue items.
- One trigger function (`queue_entity_extraction`) that automatically enqueues thoughts for extraction on insert or content/metadata change, with guards for system-generated artifacts and no-op fingerprint changes.
- One trigger (`trg_queue_entity_extraction`) attached to the `thoughts` table firing after insert or update of content/metadata.
- Service role has full access to all five tables and their sequences. Anonymous and authenticated roles have read access for MCP tools and REST API queries.
- New thoughts are automatically queued for entity extraction. Pre-existing thoughts require the optional backfill step.

## How This Differs From `ob-graph`

| Aspect | `recipes/ob-graph/` | `schemas/entity-extraction/` (this PR) |
|---|---|---|
| Build mode | Manual via MCP calls | Automatic extraction from thought content |
| Tables | 2 (`graph_nodes`, `graph_edges`) | 5 (`entities`, `edges`, `thought_entities`, `entity_extraction_queue`, `consolidation_log`) |
| Key type | UUID | BIGSERIAL |
| Primary use | Sketch entities by hand, query graph paths | Turn accumulated thoughts into a queryable entity index |
| Paired with | 10 MCP tools for building/querying | `integrations/entity-extraction-worker/` + `graph_search` in enhanced-mcp |

Install whichever matches your workflow. They don't conflict.

## Troubleshooting

**Issue: "relation already exists" warnings**
Solution: These are safe to ignore. The `CREATE TABLE IF NOT EXISTS` syntax prevents errors but may log informational notices. The migration is fully idempotent.

**Issue: trigger not firing on new thoughts**
Solution: The trigger fires `AFTER INSERT OR UPDATE OF content, metadata` on the `thoughts` table. Confirm the trigger exists by querying `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.thoughts'::regclass;`. If missing, re-run the trigger section of the migration.

**Issue: queue not populating for existing thoughts**
Solution: The trigger only fires on new inserts or updates. For pre-existing thoughts, run the optional backfill query at the bottom of `schema.sql`. This safely inserts with `ON CONFLICT DO NOTHING`.

**Issue: "column content_fingerprint does not exist" error in trigger**
Solution: The trigger function reads `NEW.content_fingerprint` from the thoughts table. This column is created during Step 2.6 of the getting-started guide. If missing, apply that step first, then re-run this migration.

**Issue: entities table has duplicate entries**
Solution: The `UNIQUE (entity_type, normalized_name)` constraint prevents exact duplicates. If you see near-duplicates (e.g., "JavaScript" and "javascript"), these have different canonical names but the same normalized name should be caught. The extraction worker is responsible for consistent normalization.
