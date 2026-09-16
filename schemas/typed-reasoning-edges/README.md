# Typed Reasoning Edges

> A `thought_edges` table for semantic reasoning relations between thoughts (supports, contradicts, evolved_into, supersedes, depends_on, related_to), plus temporal validity columns (`valid_from`, `valid_until`, `decay_weight`) on the existing entity `edges` table so relationships can decay over time.

## What It Does

Open Brain's knowledge graph (from the [`entity-extraction` schema (PR #197)](https://github.com/NateBJones-Projects/OB1/pull/197)) currently only has entity-to-entity edges like `co_occurs_with` or `works_on`. This schema adds the second half: semantic reasoning edges **between thoughts**, so the graph can express "thought A supports thought B" or "thought C supersedes thought D." It also bolts temporal validity onto the existing entity edges so old relationships can be aged out without losing history.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- [`entity-extraction` schema (PR #197)](https://github.com/NateBJones-Projects/OB1/pull/197) applied (this schema extends its `edges` table)
- (Recommended) the companion [`recipes/typed-edge-classifier/`](../../recipes/typed-edge-classifier/) to populate `thought_edges` automatically

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
TYPED REASONING EDGES -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________

--------------------------------------
```

## Steps

1. Open your Supabase dashboard and navigate to the **SQL Editor**
2. Create a new query and paste the full contents of `schema.sql`
3. Click **Run** to execute the migration. It will hard-fail with a clear message if `public.thoughts` or `public.edges` is missing, so set up those tables first.
4. Open **Table Editor** and confirm the new `thought_edges` table appears with the following columns:
   - `id`, `from_thought_id`, `to_thought_id`, `relation`, `confidence`, `decay_weight`, `valid_from`, `valid_until`, `classifier_version`, `support_count`, `metadata`, `created_at`, `updated_at`
5. Confirm the existing `edges` table now also has `valid_from`, `valid_until`, `decay_weight` columns (SQL Editor → `SELECT column_name FROM information_schema.columns WHERE table_name = 'edges';`)
6. Verify the indexes were created:

   ```sql
   SELECT indexname FROM pg_indexes
   WHERE tablename IN ('thought_edges', 'edges')
   ORDER BY tablename, indexname;
   ```

7. Install [`recipes/typed-edge-classifier/`](../../recipes/typed-edge-classifier/) to start populating the new table (or do manual INSERTs if you prefer)

## Expected Outcome

After running the migration:

- One new table: `thought_edges`, with a `CHECK` constraint on the `relation` vocabulary (`supports`, `contradicts`, `evolved_into`, `supersedes`, `depends_on`, `related_to`), numeric range checks on `confidence` and `decay_weight`, and a self-loop guard (`from_thought_id <> to_thought_id`).
- Four indexes on `thought_edges`: outgoing `(from_thought_id, relation)`, incoming `(to_thought_id, relation)`, "currently valid" partial index (`valid_until IS NULL`), and a decay-sweep index on `valid_until`.
- Three new columns on `edges`: `valid_from`, `valid_until`, `decay_weight`, plus a range-check constraint and two new indexes for temporal queries.
- An `updated_at` trigger on `thought_edges`.
- Row Level Security enabled on `thought_edges`: **`service_role` only** — `authenticated` and `anon` have no access. This matches the posture of `public.thoughts` in [`docs/01-getting-started.md`](../../docs/01-getting-started.md). See [RLS posture](#rls-posture-service-role-only) below.

## RLS posture (service-role only)

`thought_edges` is readable and writable **only by `service_role`**. We deliberately do **not** grant `SELECT` to `authenticated`.

**Why.** Each row carries `from_thought_id`, `to_thought_id`, and `metadata.rationale`. Together those expose derived relationships between private thoughts. Since the underlying `public.thoughts` table is service-role-only in stock Open Brain, exposing `thought_edges` to `authenticated` via PostgREST would leak derived private-thought relationships that the base table intentionally hides. The only safe posture is to mirror `public.thoughts`.

If you ever want authenticated clients to read reasoning edges directly (skipping the MCP server / service-role path), that must be an **explicit product decision** with a per-user `USING` policy that filters by ownership, not a blanket `SELECT`.

The temporal-validity columns added to the existing `public.edges` table do **not** add any new GRANTs — they inherit the posture of `edges` from `schemas/entity-extraction/` unchanged.

## Relation Vocabulary

| Relation | Meaning | Example |
|---|---|---|
| `supports` | A strengthens / provides evidence for B | "sleep 8h" → supports → "morning energy" |
| `contradicts` | A disagrees with or disproves B | "ran 5mi Tuesday" → contradicts → "took a rest day Tuesday" |
| `evolved_into` | A was replaced by a refined/updated B | "v1 API draft" → evolved_into → "v2 API shipped" |
| `supersedes` | A is the newer replacement for B (decisions/versions) | "decided to use Supabase" → supersedes → "decided to use Firebase" |
| `depends_on` | A is conditional on B being true | "deploy Friday" → depends_on → "tests pass" |
| `related_to` | Generic fallback when no specific label fits | (catch-all; use sparingly) |

Direction matters for every label except `related_to` — the classifier recipe stores direction via `from_thought_id` / `to_thought_id` ordering.

## Design Tensions (unresolved)

This schema surfaces two design tensions that reviewers should weigh in on. **Neither is resolved in this PR on purpose** — they're flagged so dev-review / co-evolve can pick a direction, rather than having an author silently lock in a choice.

### Tension 1: `thought_edges` as a new table vs. polymorphic `edges`

The existing `edges` table (from `schemas/entity-extraction/`) has `from_entity_id` and `to_entity_id`, both FKs to `entities.id`. It **cannot** hold thought-to-thought relations without one of:

- **(A)** A new `thought_edges` table with its own `from_thought_id` / `to_thought_id` columns referencing `public.thoughts(id)` — what this PR ships.
- **(B)** Make `edges` polymorphic by adding nullable `from_thought_id` / `to_thought_id` alongside the entity FKs, and reuse one table for both.

**Why (A) in this PR.** Cleaner constraints (both FK columns are `NOT NULL`, no `CHECK (xor(entity_id, thought_id))`), clean indexes, and the two tables are conceptually different: entity edges are aggregated across many thoughts (they have `support_count` because the same relation accrues evidence over time), whereas a thought edge is a specific claim about two specific thoughts.

**Counter-argument for (B).** Every graph traversal query that wants to span both kinds of edge has to `UNION` two tables. If a future feature really does blur the line (e.g. "thought A supports entity B"), the polymorphic design falls out for free.

Reviewers: is (A) the right call? Or should we bite the bullet on (B) before the table has any data in it?

### Tension 2: Overlap with the upcoming `provenance-chains` PR's `supersedes` column

The sibling `provenance-chains` PR (branch `contrib/alanshurafa/provenance-chains`, not yet merged to `main`) stores `supersedes` as a column on `public.thoughts` — i.e. `thoughts.supersedes UUID REFERENCES thoughts(id)`. This PR's `thought_edges` table stores `supersedes` as an edge type. That's duplication.

The intended resolution:

- **`thought_edges` is the source of truth** for reasoning relations **between** thoughts. It holds evidence (`confidence`, `support_count`, `metadata.rationale`), temporal bounds (`valid_from`, `valid_until`), and classifier version, and it supports all six relations uniformly.
- **`thoughts.supersedes`** (from `provenance-chains`) is a **denormalized pointer** for fast "what's the newest version of this decision?" lookup without joining to `thought_edges`. Per the `provenance-chains` contract, the pointer lives on the **newer** thought and references the prior thought it replaces (`newer.supersedes = older`).
- Both should be **kept in sync by the classifier**. When the classifier inserts a `supersedes` edge `(from=newer, to=older)`, it also sets `thoughts.supersedes = older` on the **newer** thought (i.e. PATCHes the FROM-side row).

Open question flagged for reviewers: **should the classifier actually do that mirroring, or only the edge?**

- Pro mirroring: single query works for the common case.
- Con mirroring: two places to update means two places to get wrong, and the classifier now depends on the `provenance-chains` schema being applied.

This PR **recommends** the classifier mirror (see the classifier recipe README), but marks it `TBD` in both READMEs and does not lock the behavior in until dev-review signs off. The classifier ships with the mirror behind a `--mirror-supersedes` flag that is **off by default**.

## Troubleshooting

**Issue: `ERROR: typed-reasoning-edges requires the public.edges table from schemas/entity-extraction/`**
Solution: Apply the [`entity-extraction` schema (PR #197 — schema.sql)](https://github.com/NateBJones-Projects/OB1/pull/197/files) first, then re-run this migration. The prereq check is there on purpose — without the entity `edges` table, the temporal-validity `ALTER TABLE` would fail mid-migration and leave you in a half-applied state.

**Issue: `ERROR: insert or update on table "thought_edges" violates foreign key constraint`**
Solution: The `from_thought_id` / `to_thought_id` you tried to insert doesn't exist in `public.thoughts`. Either the thought was deleted between classifier fetch and insert, or you're using a numeric ID where a UUID is expected — the FK is UUID because stock Open Brain's `thoughts.id` is UUID.

**Issue: `ERROR: new row for relation "thought_edges" violates check constraint "thought_edges_relation_check"`**
Solution: You tried to insert a relation that isn't in the allowed set. Either expand the `CHECK` constraint (and the classifier vocabulary) with a new migration, or remap your input to one of the six supported labels.

**Issue: Duplicate `ERROR: duplicate key value violates unique constraint "thought_edges_from_thought_id_to_thought_id_relation_key"`**
Solution: An edge with the same `(from, to, relation)` already exists. For callers that want "insert or bump support_count + refresh temporal bounds" in one atomic write, call the `public.thought_edges_upsert(...)` RPC exposed at `POST /rpc/thought_edges_upsert` — it uses `ON CONFLICT DO UPDATE` against the unique `(from_thought_id, to_thought_id, relation)` constraint. The typed-edge-classifier recipe does this by default. If you're inserting manually and don't want accumulation, either use `ON CONFLICT DO NOTHING` or handle the duplicate yourself.

**Issue: I want a different vocabulary than the six labels.**
Solution: Drop the `relation` `CHECK` constraint and either (a) replace it with a broader list, or (b) remove it entirely and let the classifier enforce vocabulary at write time. The text column is flexible; the `CHECK` is a guardrail against typos, not a hard design commitment.
