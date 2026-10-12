---
slug: canonical-write-path
title: The Canonical Write Path
stage: Data Path
difficulty: Intermediate
order: 3
estimatedMinutes: 20
summary: "Follow a thought as it is written: one RPC door, a BEFORE trigger that guarantees a fingerprint, and a trigger that queues the thought's own enrichment."
goals:
  - Explain why all writes go through upsert_thought instead of direct INSERTs.
  - Describe what trg_set_content_fingerprint guarantees and why BEFORE matters.
  - Explain how writing a thought automatically schedules its graph enrichment.
relatedResearch:
  - write-and-retrieval-path
  - data-model
quiz:
  title: Check the write path
  passingScore: 70
  questions:
    - prompt: Why do callers write through the upsert_thought RPC rather than INSERTing into thoughts directly?
      options:
        - Because Supabase blocks direct inserts.
        - So invariants like fingerprinting, extraction queuing, and provenance are enforced in one place.
        - Because RPCs are faster than inserts.
        - To avoid writing an embedding.
      correctOption: So invariants like fingerprinting, extraction queuing, and provenance are enforced in one place.
      explanation: A single write door means the rules live in the path itself, not scattered across every caller who might forget one.
    - prompt: What does the trg_set_content_fingerprint BEFORE trigger guarantee, and why does BEFORE matter?
      options:
        - It emails an alert after each write.
        - It computes the fingerprint before the row lands, so every thought always has a consistent fingerprint for dedup.
        - It deletes duplicate thoughts automatically.
        - It runs only on the first thought of each day.
      correctOption: It computes the fingerprint before the row lands, so every thought always has a consistent fingerprint for dedup.
      explanation: Running BEFORE insert means the fingerprint is present on every row without trusting the caller, which is what makes deduplication reliable.
    - prompt: What happens automatically when a new thought is written, thanks to trg_queue_entity_extraction?
      options:
        - The thought is immediately embedded on the client.
        - The thought is enqueued into entity_extraction_queue for later entity/edge extraction.
        - The thought is copied to every AI client.
        - The thought is marked as derived.
      correctOption: The thought is enqueued into entity_extraction_queue for later entity/edge extraction.
      explanation: Writing a thought schedules its own graph enrichment; a worker later drains the queue and pulls out entities and edges.
---

## One door in

There is exactly one supported way to write a thought: the RPC **`upsert_thought(p_content, p_payload, p_embedding)`**. No feature `INSERT`s into `thoughts` directly. The `p_payload` (jsonb) carries everything beyond the raw text — metadata, type, source, provenance — so the whole write funnels through a single, auditable door.

Why insist on this? Because a memory store has **invariants** that must hold for *every* write: it must be fingerprinted for dedup, it must schedule its own enrichment, it must record provenance if it is derived. If each caller were responsible for those, one forgetful caller would corrupt the store. Putting the door in the database means the rules are enforced by the path, not by discipline.

## Two triggers do the guaranteeing

On the way in, two `BEFORE`/`AFTER` triggers fire automatically on `thoughts`:

**`trg_set_content_fingerprint`** — a `BEFORE` trigger that sets `content_fingerprint`. The *BEFORE* matters: the fingerprint is computed and stamped onto the row *before* it is stored, so there is never a window where a thought exists without one. That guarantee is what lets dedup be reliable rather than best-effort. The normalization is intentionally **simple** (lowercase, collapse whitespace) — an earlier, more aggressive normalizer merged thoughts that were not truly duplicates, so the current design errs toward keeping distinct thoughts distinct.

**`trg_queue_entity_extraction`** — enqueues the new thought into `entity_extraction_queue`. In other words, *writing a thought schedules its own graph enrichment.* You do not call an extraction service by hand; the write path books the work, and a cron worker (lesson 7) drains the queue later.

## Then: the embedding

To make the thought findable, an embedding is generated (via OpenRouter) and stored in the `embedding` column. Now the thought is durable, fingerprinted, queued for enrichment, and searchable — all as a consequence of going through the one door.

## The lesson to internalize

When you extend Open Brain, you **extend the write path**; you do not route around it. Every guarantee the store makes about its own integrity lives in `upsert_thought` and its triggers.
