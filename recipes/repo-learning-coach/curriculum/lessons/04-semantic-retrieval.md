---
slug: semantic-retrieval
title: Semantic Retrieval
stage: Data Path
difficulty: Intermediate
order: 4
estimatedMinutes: 18
summary: "How memory comes back: embed the query, call match_thoughts for nearest neighbors above a threshold, and use the result for recall and related thoughts."
goals:
  - Explain how match_thoughts finds thoughts by meaning rather than keywords.
  - Describe the roles of the threshold, count, and filter arguments.
  - Connect semantic retrieval to recall-before-asking and related-thoughts behavior.
relatedResearch:
  - write-and-retrieval-path
quiz:
  title: Check retrieval
  passingScore: 70
  questions:
    - prompt: How does match_thoughts decide which thoughts to return?
      options:
        - It returns the most recently created thoughts.
        - It returns thoughts whose embeddings are nearest to the query embedding, above a similarity threshold.
        - It does a full-text keyword search on content.
        - It returns a random sample for variety.
      correctOption: It returns thoughts whose embeddings are nearest to the query embedding, above a similarity threshold.
      explanation: Retrieval is by vector similarity, so a query can match thoughts that share meaning even when they share no exact words.
    - prompt: What is the role of the match_threshold argument?
      options:
        - It sets how many thoughts to return.
        - It sets a minimum similarity, filtering out weak matches below the cutoff.
        - It sets which client is allowed to read.
        - It controls the embedding model.
      correctOption: It sets a minimum similarity, filtering out weak matches below the cutoff.
      explanation: The threshold trades recall for precision; match_count caps how many results come back, and filter narrows by metadata.
    - prompt: Which user-facing behaviors are powered by the same match_thoughts retrieval path?
      options:
        - Only the weekly auditor.
        - Recall-before-asking and the related-thoughts panel.
        - Only bulk ingestion.
        - Only the health monitor.
      correctOption: Recall-before-asking and the related-thoughts panel.
      explanation: One retrieval function underpins several features — recalling prior context before asking the user, and surfacing thoughts related to what you are reading.
---

## The mirror image of the write path

If `upsert_thought` is the one door in, **`match_thoughts`** is the one door out. Its signature: `match_thoughts(query_embedding vector, match_threshold double precision, match_count integer, filter jsonb)`.

The flow is short:

1. Take the query (a question, a lesson, whatever you want context for) and **embed it** with the same model used for thoughts.
2. Call `match_thoughts` with that vector.
3. Get back the **nearest thoughts by cosine similarity**, above `match_threshold`, capped at `match_count`, optionally narrowed by a metadata `filter`.

## Why "semantic" changes everything

Keyword search finds thoughts that share *words*. Semantic search finds thoughts that share *meaning*. Ask "how do we keep duplicate memories out?" and you can match a thought that says "the fingerprint trigger dedupes on normalized content" — even though it contains none of your query's words. That is the entire reason for storing an `embedding` on every thought.

The three tuning arguments each control one thing:

- **`match_threshold`** — the minimum similarity. Raise it for precision, lower it for recall.
- **`match_count`** — how many results, at most.
- **`filter`** — a jsonb predicate over `metadata`, to scope by tag, source, or type.

## Where you have already seen it

This one function is load-bearing across the product surface:

- **Recall-before-asking** — before an assistant asks you something, it embeds the question and calls `match_thoughts` to see if the brain already knows the answer.
- **Related thoughts** — the panel that surfaces prior memories relevant to what you are currently reading (including in this learning app) is `match_thoughts` under the hood.

## The pairing to remember

`upsert_thought` and `match_thoughts` are a matched pair: one enforces integrity on the way in, the other ranks by meaning on the way out. Everything else — the graph, provenance, the cron fleet — makes the thoughts flowing through these two doors richer and better maintained.
