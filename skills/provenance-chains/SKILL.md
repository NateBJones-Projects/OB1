---
name: provenance-chains
description: |
  Use when capturing a derived artifact to Open Brain — a digest, wiki, research
  summary, lint report, or any thought synthesized from other thoughts — so its
  derivation link survives and stays queryable. Also use when answering "why do I
  believe X", "what's this based on", "what's the evidence for this", "what uses
  this thought", or "what breaks if I delete this". Pairs with the provenance-chains
  schema and Provenance Chains Pipeline recipe.
author: Ezana Azene
version: 1.0.0
---

# Provenance Chains

## Overview

The [provenance-chains schema](../../schemas/provenance-chains/) turns the flat `thoughts` table into a derivation graph. This skill is how an AI client keeps that graph intact: **tag provenance every time you capture a synthesis, and reach for the trace tools when a user asks where a belief came from.**

**Core principle:** A synthesis with no `derived_from` is an orphan the moment it lands. The link between a digest and its evidence only exists if the capture writes it — prose like "based on 5 thoughts" is not queryable.

## When to Use

**Write side — you just produced a derived artifact and are about to capture it:**
- Weekly/daily digests, wikis, research summaries, lint reports, meeting syntheses
- Anything built by combining or summarizing existing thoughts
- Regenerating an artifact that replaces a prior one (set `supersedes`)

**Read side — the user asks about origins or impact:**
- "Why do I believe X" / "what's this based on" / "what's the evidence" → `trace_provenance`
- "What uses this thought" / "what cites this" / "what breaks if I delete this" → `find_derivatives`

**When NOT to use:** capturing a primary atomic thought (a raw capture, not derived from other thoughts). Leave the derivation columns unset — the schema defaults `derivation_layer` to `'primary'`.

## Write Side: the capture contract

When capturing a derived artifact, the `capture_thought` arguments **MUST** match this shape. Every field below is constrained by a DB CHECK or read-tool cast — get the shape wrong and the row is rejected or unreadable.

```json
{
  "content": "This week: shipped the auth refactor, fixed three flaky tests, deferred billing migration.",
  "type": "digest",
  "source_type": "weekly_digest_pointer",
  "derivation_layer": "derived",
  "derivation_method": "synthesis",
  "derived_from": [
    "3f8a1c2e-1111-4a2b-9c3d-000000000001",
    "7b2d4e6f-2222-4a2b-9c3d-000000000002",
    "a1c3e5f7-3333-4a2b-9c3d-000000000003",
    "d4f6a8b0-5555-4a2b-9c3d-000000000005"
  ],
  "metadata": {
    "provenance": {
      "derived_from": [
        "3f8a1c2e-1111-4a2b-9c3d-000000000001",
        "7b2d4e6f-2222-4a2b-9c3d-000000000002",
        "a1c3e5f7-3333-4a2b-9c3d-000000000003",
        "d4f6a8b0-5555-4a2b-9c3d-000000000005"
      ],
      "derivation_layer": "derived",
      "derivation_method": "synthesis",
      "unresolved_refs": ["#412"]
    }
  }
}
```

### Field rules (all enforced)

| Field | Valid values | Why |
|-------|--------------|-----|
| `derived_from` | Flat JSON array of **UUID strings** — nothing else | `trace_provenance` casts each element `::uuid`; objects or non-UUIDs raise `22P02` |
| `derivation_layer` | `'primary'` or `'derived'` — **only these two** | `thoughts_derivation_layer_check` rejects anything else; INSERT fails |
| `derivation_method` | `'synthesis'` or omit | `thoughts_derivation_method_check` allows only `'synthesis'` or NULL on install |
| `supersedes` | UUID of the thought this one replaces, or omit | Use only when regenerating (e.g. today's digest replaces yesterday's) |
| `metadata.provenance` | Mirror of the three fields above | See durability rule below — **required**, not optional |

### The two rules the schema won't catch for you

1. **Mirror provenance into `metadata.provenance`.** The canonical `upsert_thought` RPC preserves only the `metadata` blob on a `content_fingerprint` conflict — **not** the top-level `derived_from` / `derivation_layer` / `derivation_method` columns. If you don't mirror, a re-capture of the same content silently drops the provenance. Write both.

2. **Never put a non-UUID ref in `derived_from`.** Legacy integer refs (`#412`, `412`) and titles are not valid parents. Resolve them to the real UUID first; if you can't, drop them from `derived_from` and record them under `metadata.provenance.unresolved_refs` so the loss is visible instead of poisoning the array.

## Read Side: querying the graph

These map to the recipe's MCP tools (`recipes/provenance-chains/mcp-tools.ts`). Call them instead of guessing from `content`.

| User asks | Tool | Args |
|-----------|------|------|
| "Why do I believe X?" / "what's this based on?" | `trace_provenance` | `thought_id`, `max_depth` (e.g. 5), `node_cap` (e.g. 100) — walks `derived_from` **upward** to ancestors |
| "What uses this thought?" / "what cites this?" / "safe to delete?" | `find_derivatives` | `thought_id`, `limit` — reverse lookup of thoughts whose `derived_from` contains this id |

`trace_provenance` handles cycles, depth/node caps, and redacts restricted-tier ancestors. `find_derivatives` always filters restricted rows. Report what the tool returns; don't reconstruct chains by hand from thought text.

## Common Mistakes

Each of these is a real failure a capable agent makes without this skill:

| Mistake | Fix |
|---------|-----|
| `derived_from: [{ "ref": "...", "id_type": "uuid" }]` | Flat array of bare UUID strings — no wrapper objects |
| Keeping `#412` / `412` in `derived_from` | Resolve to UUID or move to `metadata.provenance.unresolved_refs` |
| `derivation_layer: "digest"` (or any custom value) | Only `'primary'` or `'derived'` |
| `derivation_method: "weekly_digest_synthesis"` | Only `'synthesis'` (or omit) until you extend the CHECK constraint |
| Writing top-level columns but no `metadata.provenance` | Mirror them — otherwise re-capture drops provenance |
| Reconstructing a chain by reading thought content | Call `trace_provenance` / `find_derivatives` |

## Notes

- **Adoption by other synthesis skills:** `panning-for-gold`, `research-synthesis`, `meeting-synthesis`, `weekly-signal-diff`, and `competitive-analysis` all capture derived artifacts. When any of them runs on a brain with the provenance-chains schema installed, apply this capture contract so the new artifact is tagged — this is the going-forward complement to the recipe's one-time `backfill.mjs`.
- **Requires:** the [provenance-chains schema](../../schemas/provenance-chains/) applied (adds the columns + CHECK constraints) and, for the read tools, the [Provenance Chains Pipeline](../../recipes/provenance-chains/) MCP handlers installed in your `open-brain-mcp` Edge Function. Without the schema, the derivation columns don't exist and the capture will fail on unknown columns.
- **Tool naming varies by client:** the capture tool is often `capture_thought`; connector prefixes differ. Use whichever Open Brain capture tool the current client exposes.
