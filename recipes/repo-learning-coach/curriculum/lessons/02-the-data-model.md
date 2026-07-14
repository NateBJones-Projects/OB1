---
slug: the-data-model
title: The Data Model
stage: Foundations
difficulty: Intro
order: 2
estimatedMinutes: 20
summary: "Learn the thoughts table as the atomic unit and the supporting tables that turn isolated notes into a linked, searchable, self-maintaining store."
goals:
  - Describe a thought row and the roles of its content, embedding, and metadata columns.
  - Explain why thoughts is deliberately client-agnostic.
  - Group the supporting tables into the memory, structure, and maintenance jobs.
relatedResearch:
  - data-model
  - system-overview
quiz:
  title: Check the data model
  passingScore: 70
  questions:
    - prompt: What does the embedding column on a thought store, and what is it for?
      options:
        - A backup copy of the content, for recovery.
        - A pgvector vector representation used for semantic similarity search.
        - The list of entities mentioned in the thought.
        - The client that wrote the thought.
      correctOption: A pgvector vector representation used for semantic similarity search.
      explanation: The embedding lets match_thoughts find thoughts by meaning rather than exact words. Entities live in separate tables; content is stored in the content column.
    - prompt: Why is there no per-user or per-client column on the thoughts table?
      options:
        - It was an oversight that will be fixed.
        - Because a thought is client-agnostic by design, so any client can share it.
        - Because Postgres does not support that.
        - Because clients store their own copies instead.
      correctOption: Because a thought is client-agnostic by design, so any client can share it.
      explanation: Client-agnostic thoughts are what make one shared brain possible. Tying a thought to a client would rebuild the silos Open Brain exists to remove.
    - prompt: Which grouping best describes entities, thought_entities, and edges?
      options:
        - The maintenance job that keeps the store healthy.
        - The memory job that stores raw thoughts.
        - The structure job that turns isolated thoughts into a traversable graph.
        - The runtime job that serves MCP requests.
      correctOption: The structure job that turns isolated thoughts into a traversable graph.
      explanation: Those three tables record the nouns, their mentions in thoughts, and the typed relationships between them — the structure layer built on top of raw memory.
---

## The atomic unit: a thought

Open a single row in `thoughts` and you have seen the heart of the system. The columns that carry the most meaning:

- **`content`** — the memory itself, as text.
- **`embedding`** (`vector`) — a pgvector embedding, so the thought can be found by *meaning*, not just keywords.
- **`content_fingerprint`** — a normalized hash for deduplication (next lesson).
- **`metadata`** (jsonb) — the flexible bag: tags, source detail, request ids, hygiene results.
- **`type`, `source_type`, `status`, `importance`, `quality_score`, `sensitivity_tier`** — classification and lifecycle.
- **`derivation_layer`, `derivation_method`, `derived_from`, `supersedes`** — provenance (lesson 6).

Notice what is absent: **no user column, no client column.** A thought does not belong to ChatGPT or to Claude — it belongs to the brain. That single omission is what makes the store shareable.

## The supporting cast

A pile of thoughts is not yet a memory system. A small set of tables adds structure and upkeep:

- **`entities`** — the extracted nouns (people, tools, projects), with `canonical_name`, `normalized_name`, `entity_type`, `aliases`.
- **`thought_entities`** — which entity is mentioned in which thought (many-to-many).
- **`edges`** — typed, weighted relationships between entities.
- **`thought_edges`** — semantic relations between thoughts (a higher layer).
- **`ingestion_jobs` / `ingestion_items`** — bulk intake.
- **`entity_extraction_queue`** — thoughts waiting for entity extraction.
- **`consolidation_log`** and **`ops_*`** — maintenance and telemetry.

## The three jobs

Do not memorize the tables as a flat list — group them by *job*:

1. **Memory** — `thoughts`. Store the raw stuff.
2. **Structure** — `entities`, `thought_entities`, `edges`. Turn isolated memories into a graph you can walk.
3. **Maintenance** — the queues, `consolidation_log`, `ops_*`. Keep the store linked, deduplicated, and healthy over time.

Almost every feature you will meet later is an elaboration of one of these three jobs. When a new table appears, ask which job it serves — the answer usually explains why it exists.
