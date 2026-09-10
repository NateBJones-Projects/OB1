# Entity Near-Dupe Review

> Surface the entity duplicates that `normalized_name` dedup can't catch — and merge them safely, one human-confirmed pair at a time.

## What It Does

The entity-extraction worker dedupes on `normalized_name`, so exact variants collapse on write. What it **cannot** catch:

- spacing / case / hyphen / slash / domain-dot variants — `Open Brain` vs `open-brain` vs `open-brain-dashboard-pro`
- acronym expansions — `PAE` vs `Prostate Artery Embolization (PAE)`
- username vs proper name — `NateBJones` vs `Nate B Jones`

These accumulate as separate entity rows and **fragment the graph**: one real person's edges and mentions split across two nodes, so `get_neighbors` / `traverse_graph` return half the picture and the entity-wiki compiles duplicate pages.

This recipe installs two things:

- **`ops_entity_near_dupes`** — a read-only view listing candidate pairs (compact-equal after stripping non-alphanumerics, or trigram similarity ≥ 0.6), highest-confidence first, with each side's mention count to help pick the survivor.
- **`ops_merge_entities(survivor, loser, reason)`** — a merge function that repoints `thought_entities` and `edges` from the loser to the survivor (dropping collisions and self-loops), carries the loser's name into `survivor.aliases`, logs the merge to `consolidation_log`, and deletes the loser.

## The one rule: never auto-merge

Near-dupe detection has **real false positives**. `C` and `C++` are 100% trigram-similar *and* compact-equal — and they are different entities. So is `REST API` (a tool) vs `rest-api` (a project) if you treat them as distinct. The view is a **review queue**, not a work list. Every merge is a per-pair human decision.

For AI clients, install the paired **[`merging-entities`](../../skills/merging-entities/)** skill — it encodes exactly this discipline (present candidates, never auto-merge, confirm each, pick the survivor deliberately) so any connected client handles the operation the same way.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- The **`schemas/entity-extraction`** schema applied (provides `entities`, `edges`, `thought_entities`, and `consolidation_log`)
- A populated entity graph (run the `entity-extraction-worker` first)

## Steps

### Step 1: Apply the schema

Run `schema.sql` in the Supabase SQL Editor. It creates the `pg_trgm` extension, a trigram index on `entities.normalized_name`, the review view, and the merge function. Safe to re-run.

### Step 2: Review candidates

```sql
SELECT * FROM ops_entity_near_dupes LIMIT 25;
```

Read the pairs. `compact_equal = true` with the same `entity_type` are usually safe spacing/case variants. Cross-type pairs (`tool` vs `project`) and short names (`C` / `C++`, `Go`, `R`) need a real look. When in doubt, don't.

### Step 3: Merge confirmed pairs

Survivor first — the node you keep (usually the one with more mentions, or the better-formed name):

```sql
SELECT ops_merge_entities(129, 915, 'case/hyphen variant of Open Brain');
-- => {"survivor":129,"merged":"open-brain","mentions_repointed":7,"edges_repointed":4}
```

### Step 4: Verify integrity after a session

```sql
-- no dangling references (expect 0)
SELECT count(*) FROM thought_entities te
  WHERE NOT EXISTS (SELECT 1 FROM entities e WHERE e.id = te.entity_id);
-- audit trail of what you merged
SELECT details, created_at FROM consolidation_log
  WHERE operation = 'dedup_merge' ORDER BY created_at DESC LIMIT 10;
```

## Expected Outcome

- A shrinking `ops_entity_near_dupes` list as you clear obvious variants.
- Consolidated entities: merged names live in `aliases`, edges and mentions all point at one node, zero dangling references.
- A `consolidation_log` audit row per merge, so every merge is reversible-by-reference (you know exactly what was folded into what).

## Troubleshooting

**`ERROR: survivor and loser are the same entity`** — you passed the same id twice; the pair columns are `id_a` and `id_b`.

**A merge dropped more edges than expected** — the loser and survivor asserted the same relation to the same target; the duplicate edge is deduped, not lost. Check `consolidation_log.details`.

**The list is dominated by low-similarity noise (0.6–0.7)** — raise the threshold in the view's `similarity(...) >= 0.6` clause, or filter your query: `WHERE compact_equal OR sim >= 0.85`.

**You merged the wrong pair** — there is no automatic undo, but `consolidation_log` records the loser name and both ids; re-create the entity via a normal capture and let extraction re-link it, or restore from backup. This is exactly why merges are human-confirmed.

## Works Well With

- **[merging-entities skill](../../skills/merging-entities/)** — the behavioral safety protocol every AI client should follow when running this review.
- **`schemas/entity-extraction`** — provides the graph tables and the `consolidation_log` this recipe writes to.
- **[editorial-policy hygiene block](../editorial-policy/)** / **[brain-health-monitor](../brain-health-monitor/)** — both surface `entity_dup_groups` and `entities_zero_edges`; this recipe is how you act on those signals.
