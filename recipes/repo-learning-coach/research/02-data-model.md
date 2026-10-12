---
slug: data-model
title: The Data Model
summary: "The thoughts table is the atomic unit; a small set of supporting tables turn a pile of notes into a linked, searchable, self-maintaining memory."
category: architecture
---

Everything in Open Brain resolves to rows in a handful of tables. Understanding their columns is the fastest way to understand the system.

## `thoughts` — the atomic unit

A thought is one durable memory. Key columns (verified against the live schema):

- `content` (text) — the memory itself.
- `embedding` (`vector`) — the pgvector embedding used for semantic search.
- `content_fingerprint` (text) — a normalized hash used for deduplication (see the write-path doc).
- `metadata` (jsonb) — flexible attributes: tags, source detail, request ids, hygiene results.
- `type`, `source_type`, `status`, `importance`, `quality_score`, `sensitivity_tier` — classification and lifecycle.
- `derivation_layer`, `derivation_method`, `derived_from`, `supersedes` — provenance: whether a thought is primary or synthesized from others, and what it replaces.
- `enriched` (bool), timestamps — pipeline bookkeeping.

Note what is *not* here: no per-user table, no per-client table. A thought is client-agnostic. That is the whole point.

## The supporting cast

- **`entities`** — the nouns extracted from thoughts (people, tools, projects). Columns include `canonical_name`, `normalized_name`, `entity_type`, `aliases`, and `first_seen_at` / `last_seen_at`.
- **`thought_entities`** — the many-to-many join recording which entity is *mentioned* in which thought.
- **`edges`** — typed, weighted, time-bounded relationships *between entities* (see the graph lesson).
- **`thought_edges`** — semantic reasoning relations *between thoughts* (a separate, higher-level layer).
- **`ingestion_jobs` / `ingestion_items`** — the intake pipeline for bulk captures.
- **`entity_extraction_queue`** — work waiting to have its entities pulled out.
- **`consolidation_log`** — a record of the weekly memory-consolidation passes.
- **`ops_*`** — operational telemetry (cron invocations, health snapshots, alert state).

## The mental model

Read the tables as three concentric jobs. The **memory** job is `thoughts`. The **structure** job — turning isolated memories into a graph you can traverse — is `entities`, `thought_entities`, and `edges`. The **maintenance** job — keeping the store healthy over time — is the queues, `consolidation_log`, and `ops_*`. Almost every feature in the repo is an elaboration of one of those three jobs.
