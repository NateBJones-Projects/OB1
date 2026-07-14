---
slug: provenance-derived-thoughts
title: Provenance and Derived Thoughts
stage: Knowledge Graph
difficulty: Advanced
order: 6
estimatedMinutes: 22
summary: "How Open Brain answers 'why do I believe this?': primary vs derived layers, synthesis links via derived_from, and tracing a claim back to its sources."
goals:
  - Distinguish primary thoughts from derived (synthesized) thoughts.
  - Explain the roles of derivation_layer, derivation_method, derived_from, and supersedes.
  - Describe what trace_provenance and find_derivatives let you answer.
relatedResearch:
  - write-and-retrieval-path
quiz:
  title: Check provenance
  passingScore: 70
  questions:
    - prompt: What distinguishes a derived thought from a primary thought?
      options:
        - A derived thought is older than a primary one.
        - A derived thought is synthesized from other thoughts and records what it was built from.
        - A derived thought has no embedding.
        - A derived thought cannot be searched.
      correctOption: A derived thought is synthesized from other thoughts and records what it was built from.
      explanation: Primary thoughts are captured directly; derived thoughts (digests, summaries, briefings) are produced from other thoughts and keep a link back to their sources.
    - prompt: Which column links a derived thought to the thoughts it was synthesized from?
      options:
        - supersedes
        - derived_from
        - content_fingerprint
        - importance
      correctOption: derived_from
      explanation: derived_from records the source thoughts; derivation_layer marks primary vs derived and derivation_method records how (e.g., synthesis). supersedes handles replacement, a different relationship.
    - prompt: What question does trace_provenance(p_thought_id, ...) help you answer?
      options:
        - Which client is online right now.
        - Why do I believe this thought — what sources does it ultimately rest on?
        - How many thoughts were written today.
        - What the next cron job will be.
      correctOption: Why do I believe this thought — what sources does it ultimately rest on?
      explanation: trace_provenance walks the derivation links backward to the primary evidence; find_derivatives walks the other way to see what was built on a thought.
---

## The question this layer answers

As soon as a system *synthesizes* — writes a daily briefing, a weekly summary, an audit digest — a new question appears: **why do I believe this?** A summary that cannot point back to its evidence is just an assertion. Provenance is how Open Brain keeps synthesized memory accountable.

## Primary vs derived

Every thought sits in one of two layers, recorded in **`derivation_layer`**:

- **primary** — captured directly (a note, an imported message, a decision). The raw evidence.
- **derived** — *synthesized from other thoughts* (a morning briefing, a weekly summary, a lint report).

Because both live in the same `thoughts` table, a derived thought is itself searchable and can even feed later synthesis — but it never loses the memory of where it came from.

## The four provenance columns

- **`derivation_layer`** — `primary` or `derived`. (When unset it is treated as primary.)
- **`derivation_method`** — *how* it was derived; `synthesis` is the sanctioned value.
- **`derived_from`** (jsonb) — the **source thoughts** this one was built from. This is the actual provenance link.
- **`supersedes`** (uuid) — a *different* relationship: this thought replaces an older one. Supersession is about versioning; derivation is about evidence. Do not conflate them.

## Walking the links both ways

Two RPCs traverse these links:

- **`trace_provenance(p_thought_id, p_max_depth, p_node_cap)`** — walks *backward* from a derived thought through `derived_from` to the primary evidence underneath. This is the literal answer to "why do I believe X" and "what is this based on".
- **`find_derivatives(p_thought_id, p_limit)`** — walks *forward*: given a thought, what was built on top of it? This answers "what breaks if I delete or correct this?"

## Why it matters when you extend the system

Any time you capture a **derived** artifact — a digest, a wiki page, a research summary — you must carry its provenance through the write path (via the payload to `upsert_thought`), setting `derivation_layer = derived`, `derivation_method = synthesis`, and a real `derived_from`. Skip it and the artifact becomes an orphaned claim: searchable, but unaccountable. The whole value of derived memory is that it stays traceable back to the primary thoughts that justify it.
