# Provenance Chains

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@eazene](https://github.com/eazene)**

</div>

*The client-side behavioral half of the Provenance Chains schema + recipe — so derivation links get written when artifacts are captured, not just backfilled after the fact.*

## What It Does

The [provenance-chains schema](../../schemas/provenance-chains/) adds derivation columns to `thoughts`, and the [Provenance Chains Pipeline recipe](../../recipes/provenance-chains/) backfills, evaluates, and exposes them over MCP. Both operate on data that already exists. This skill closes the loop at **capture time**: it tells the AI client to tag each derived artifact with a valid `derived_from` / `derivation_layer` / `derivation_method` (plus the `metadata.provenance` mirror) as it writes it, and to use `trace_provenance` / `find_derivatives` when a user asks where a belief came from or what depends on a thought.

Without it, a capable model still gets the mechanics wrong — it will nest `derived_from` as objects, keep legacy `#412`-style refs that break the read tools, invent `derivation_layer`/`derivation_method` values the CHECK constraints reject, and skip the `metadata.provenance` mirror that keeps provenance alive across re-captures. The skill encodes the exact contract that avoids each of those.

## Supported Clients

- Claude Code
- Codex
- Cursor
- Any AI client that supports reusable rules, skills, or custom instructions and can call the Open Brain capture/query tools

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- The [provenance-chains schema](../../schemas/provenance-chains/) applied — adds the columns and CHECK constraints the capture contract targets. Without it, tagged captures fail on unknown columns.
- For the read side: the [Provenance Chains Pipeline](../../recipes/provenance-chains/) `trace_provenance` / `find_derivatives` MCP handlers installed in your `open-brain-mcp` Edge Function.

## Installation

Copy the skill into your AI client's skills directory (or point your client's rule loader at it):

```bash
cp -r skills/provenance-chains ~/.claude/skills/provenance-chains
```

The skill fires on its own from the `description` triggers — no manual invocation needed once installed. It activates when you capture a synthesized artifact or when a user asks an origin/impact question ("why do I believe X", "what uses this thought").

## How It Fits the Provenance Chains Set

| Piece | Layer | Job |
|-------|-------|-----|
| `schemas/provenance-chains` | Database | Columns, CHECK constraints, helper SQL functions |
| `recipes/provenance-chains` | Operations | One-time backfill, nightly eval grader, MCP tool handlers |
| `skills/provenance-chains` (this) | AI client | Tag new artifacts correctly at capture; query the graph on demand |

The recipe's `backfill.mjs` repairs the **past**; this skill keeps the **future** tagged as artifacts are produced.

## Adoption by Other Skills

Any skill that captures a synthesized artifact should apply this capture contract when the provenance-chains schema is installed. Natural adopters already in this repo: `panning-for-gold`, `research-synthesis`, `meeting-synthesis`, `weekly-signal-diff`, and `competitive-analysis`. Wiring those up is a follow-up per-skill change, not a prerequisite for this one.

## License

FSL-1.1-MIT, matching the repository.
