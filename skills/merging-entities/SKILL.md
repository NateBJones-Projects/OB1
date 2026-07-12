---
name: merging-entities
description: |
  Use when asked to merge, deduplicate, consolidate, or "clean up" duplicate
  entities in the Open Brain knowledge graph, or before calling
  ops_merge_entities, which repoints edges and mentions and then HARD-deletes
  the loser entity with no undo. Also use when reviewing the
  ops_entity_near_dupes candidate view — its pairs include real false positives
  (C vs C++), so never merge from the list without confirming each pair.
author: Ezana Azene
version: 1.0.0
---

# Merging Entities

## Overview

`ops_merge_entities(survivor, loser, reason)` folds one entity into another:
it repoints every `thought_entities` mention and every `edge` from the loser to
the survivor, aliases the loser's name onto the survivor, logs the merge to
`consolidation_log`, and then **hard-deletes the loser row**. There is no undo —
recovery means re-capturing and re-extracting, or restoring from backup.

The candidate view `ops_entity_near_dupes` is a **review queue, not a work
list.** Fuzzy matching has real false positives: `C` and `C++` are 100%
trigram-similar and identical after stripping punctuation, but they are
different entities. Merging the list blindly corrupts the graph.

**Violating the letter of these rules is violating their spirit.**

## When to Use

- The user asks to merge / dedupe / consolidate duplicate entities.
- You are about to call `ops_merge_entities`.
- You are reviewing `ops_entity_near_dupes` and tempted to act on a pair.

The entity worker already dedupes exact `normalized_name` matches automatically.
This skill is only for the *fuzzy* variants it can't catch — and only with a
human in the loop.

## Process

1. **List candidates, do not act on them.** Query `ops_entity_near_dupes`
   (highest-confidence pairs first). Read them. Each row is a *question*, not a
   decision.
2. **Judge each pair — merge only when all three hold:**
   - **Same real-world entity**, not just similar strings. Ask: would a human
     call these the same thing? `Open Brain` / `open-brain` → yes. `C` / `C++`,
     `Go` / `Golang`?/`Go board`?, `R` / `R2` → look harder or skip.
   - **Compatible type** — a `person` and an `organization` with the same name
     may be genuinely different (a founder vs their company). Cross-type pairs
     need a reason, not a reflex.
   - **A confident survivor choice** — the node you KEEP. Default to the one
     with more mentions / edges, but override for the better-formed name
     (keep `Nate B Jones`, not `NateBJones`, even if the username has more
     mentions — the survivor's `entity_type` and `canonical_name` are what
     persist; the loser's name becomes an alias).
3. **Present the merges you intend and confirm with the user.** Show each pair
   (both names, types, mention counts) and which side survives. For a large
   list, propose the clear ones and explicitly flag the judgment calls and the
   ones you are NOT merging (say why — "C vs C++ are distinct languages").
4. **Merge one confirmed pair at a time.** `ops_merge_entities(survivor, loser,
   reason)`, survivor id first. Write a real `reason`.
5. **Verify integrity after the session.** Confirm zero dangling references
   (`thought_entities` / `edges` pointing at a deleted id) and report the
   `consolidation_log` audit rows. Re-query `ops_entity_near_dupes` to show what
   remains.

## This Is Not Reversible — No Exceptions

- The loser row is deleted; its edges/mentions are permanently repointed. No
  undo, no trash. Backups only.
- **Never `SELECT ops_merge_entities(...)` across the whole candidate view in a
  loop.** That is how `C`/`C++` and every other false positive gets destroyed.
- Survivor order matters: `ops_merge_entities(A, B)` keeps A and deletes B.
  Passing them backwards keeps the wrong node's type and name.
- "Consolidate the duplicates" is not permission to merge unconfirmed pairs —
  it is permission to *review* them.

## Red Flags — STOP

- About to merge a pair you have **not** shown to the user, or a whole list at
  once.
- The two names are similar strings but plausibly **different things** (short
  names, versions, acronyms, cross-type pairs): `C`/`C++`, `v1`/`v2`,
  `Apple` the company vs a person named Apple.
- You are unsure which side should survive.
- `compact_equal = true` made you assume "safe" — it is a *signal to check*, not
  a verdict (it is exactly what flags `C`/`C++`).

**All of these mean: pause, show the pair, and confirm which node survives — or
skip it.**

## Rationalizations — and Reality

| Excuse | Reality |
|--------|---------|
| "The whole list is obvious variants." | It contains C vs C++. Read every pair; the list is a queue of questions. |
| "similarity is 1.00, so they're the same." | 1.00 similarity means identical *strings after normalization*, not identical *entities*. |
| "Faster to merge them all than confirm each." | One wrong merge silently deletes a real entity and mis-attributes its whole subgraph. |
| "The user said clean up the duplicates." | That authorizes review, not blind merging. Present the pairs and the ones you're skipping. |
| "I'll just recreate it if I'm wrong." | Re-capture loses the merged node's edges, mention history, and aliases. |

## Output

For each confirmed merge, the function returns
`{survivor, merged, mentions_repointed, edges_repointed}` — report it. End the
session with: which pairs you merged, which you deliberately skipped and why,
and the post-merge integrity check (zero dangling references).

## Notes

- Substrate: the **entity-near-dupe-review** recipe
  (`recipes/entity-near-dupe-review`) installs `ops_entity_near_dupes` and
  `ops_merge_entities`. This skill is the behavioral half.
- Tool/RPC names may carry a connector prefix; use whatever the environment
  exposes to run SQL against your Open Brain database.
- Prefer merging over deleting a duplicate entity by hand — the merge preserves
  the graph; a manual delete orphans edges. Pairs conceptually with
  **deleting-thoughts** / **updating-thoughts** as the graph-side member of the
  destructive-operation safety family.
