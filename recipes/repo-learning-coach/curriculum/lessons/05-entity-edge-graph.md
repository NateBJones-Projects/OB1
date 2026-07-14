---
slug: entity-edge-graph
title: The Entity and Edge Graph
stage: Knowledge Graph
difficulty: Intermediate
order: 5
estimatedMinutes: 22
summary: "How isolated thoughts become a traversable graph: entities as canonical nouns, thought_entities as mentions, and typed, weighted, time-bounded edges."
goals:
  - Distinguish entities, thought_entities mentions, and edges.
  - Explain why entity resolution (resolve_entity) prevents duplicate nouns.
  - Read an edge's relation, weight, and validity columns.
relatedResearch:
  - data-model
quiz:
  title: Check the graph
  passingScore: 70
  questions:
    - prompt: What is the difference between an entity and a thought_entities row?
      options:
        - They are the same thing stored twice.
        - An entity is a canonical noun; a thought_entities row records that the noun was mentioned in a specific thought.
        - An entity is a relationship; thought_entities is a noun.
        - thought_entities stores embeddings; entities store text.
      correctOption: An entity is a canonical noun; a thought_entities row records that the noun was mentioned in a specific thought.
      explanation: Entities are the deduplicated nouns; thought_entities is the many-to-many bridge tying each entity to the thoughts that mention it.
    - prompt: Why does the system resolve entities through resolve_entity(p_name, p_normalized, p_type) instead of inserting a new entity per mention?
      options:
        - To make extraction slower and safer.
        - So the same real-world thing maps to one canonical entity instead of many duplicates.
        - Because Postgres requires a function for inserts.
        - To store one entity per thought.
      correctOption: So the same real-world thing maps to one canonical entity instead of many duplicates.
      explanation: Resolution collapses aliases and repeated mentions onto a single canonical entity; without it the graph fills with duplicate nouns and edges lose meaning.
    - prompt: An edge row has relation, confidence, support_count, valid_from and valid_until. What does this tell you about edges?
      options:
        - Edges are untyped and permanent.
        - Edges are typed, weighted by evidence, and bounded in time.
        - Edges connect thoughts, not entities.
        - Edges store the full text of each thought.
      correctOption: Edges are typed, weighted by evidence, and bounded in time.
      explanation: relation gives the type, confidence/support_count give evidential weight, and valid_from/valid_until make relationships temporal rather than eternal facts.
---

## From notes to a graph

Lessons 1–4 gave you durable, searchable thoughts. But semantic search alone cannot answer "what does this person work on?" or "which tools relate to this project?" For that you need **structure** — a graph — laid over the raw memories. Three tables build it.

## Entities: the canonical nouns

An **`entities`** row is one real-world thing: a person, a tool, a project. Its columns tell the story — `canonical_name` (the display form), `normalized_name` (the matching form), `entity_type`, `aliases`, and `first_seen_at` / `last_seen_at`.

The hard problem with entities is **duplication**. "OpenRouter", "open router", and "OpenRouter API" are one thing mentioned three ways. So extraction does not blindly insert; it calls **`resolve_entity(p_name, p_normalized, p_type)`**, which maps a mention onto an existing canonical entity when one matches (first-seen type wins) and creates a new one only when nothing matches. Without resolution, the graph fills with near-duplicate nouns and every edge between them becomes ambiguous.

## Mentions: `thought_entities`

An entity by itself is disconnected from the memories that produced it. **`thought_entities`** is the many-to-many bridge: each row says *this entity was mentioned in this thought.* This is how you get from a thought to its nouns, and from a noun back to every thought that discusses it.

## Edges: typed, weighted, temporal relationships

**`edges`** connect entities to each other, and they are richer than a plain link:

- **`relation`** — the type. Live relations in this brain include `uses`, `works_on`, `member_of`, `located_in`, `related_to`, and `co_occurs_with`.
- **`confidence`, `support_count`, `decay_weight`** — evidential weight. A relationship backed by many thoughts is stronger than one seen once, and weight can decay over time.
- **`valid_from`, `valid_until`** — validity window. Relationships are *temporal*: someone can work on a project this quarter and not the next. Edges model that instead of asserting eternal facts.

## The mental model

Read the graph as three questions. `entities`: *what things exist?* `thought_entities`: *where was each thing discussed?* `edges`: *how do things relate, how strongly, and when?* Together they turn a flat store of thoughts into something you can traverse — the substrate for graph search and for the higher-level reasoning relations in `thought_edges`.
