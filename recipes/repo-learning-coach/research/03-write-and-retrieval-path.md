---
slug: write-and-retrieval-path
title: The Write and Retrieval Paths
summary: "How a thought gets in safely (upsert_thought + a fingerprint trigger + embeddings) and how it comes back out (match_thoughts semantic search)."
category: architecture
---

Two paths matter more than any others: how a thought is written, and how it is found again. Get these right and the rest of the system composes cleanly.

## The write path

Writes go through one canonical RPC: **`upsert_thought(p_content text, p_payload jsonb, p_embedding jsonb)`**. Callers never `INSERT` into `thoughts` directly. The `p_payload` carries everything else — metadata, type, source, and any provenance fields — so the write path stays a single, auditable door.

Two database triggers fire automatically on the way in (both verified on the live `thoughts` table):

- **`trg_set_content_fingerprint`** — a `BEFORE` trigger that guarantees every row has a `content_fingerprint`. Because it runs *before* the row lands, the fingerprint is always present and consistent, which is what makes deduplication reliable. The normalization here is deliberately *simple* (lowercasing/whitespace), not aggressive — a lesson learned from an over-eager earlier version.
- **`trg_queue_entity_extraction`** — enqueues the new thought into `entity_extraction_queue` so a worker can later pull out its entities. Writing a thought therefore *automatically* schedules its own graph enrichment.

Embeddings are generated (via OpenRouter) and stored in the `embedding` column so the thought becomes searchable.

## The retrieval path

Recall runs through **`match_thoughts(query_embedding vector, match_threshold double precision, match_count integer, filter jsonb)`**. You embed the query, then this function returns the nearest thoughts by cosine similarity above a threshold, optionally narrowed by a `filter` on metadata. This single function powers "related thoughts", recall-before-asking behavior, and the semantic search exposed over MCP.

## Why one door in, one door out

Funneling every write through `upsert_thought` and every read through `match_thoughts` means invariants live in *one* place. Fingerprinting, extraction queuing, and provenance can be enforced by the write path rather than trusted to every caller. When you extend Open Brain, you extend these paths — you do not go around them.
