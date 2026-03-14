# OB1 Adoption & Alignment

## What This Is

A structured effort to migrate Matt's personal Open Brain instance (monkeyrun-open-brain) to be fully aligned with the OB1 community project. This means running OB1's canonical schema, MCP server, and community extensions — becoming a well-adopted user positioned to contribute back.

## Core Value

My Open Brain runs the same stack as every other OB1 user, so I can use community extensions out of the box and contribute recipes/extensions that work for everyone.

## Requirements

### Validated

- ✓ Open Brain Supabase instance running (piigyjxxzrivwvupefsc, us-west-2) — existing
- ✓ 1,400+ thoughts with embeddings and metadata — existing
- ✓ Source filtering recipe contributed (PR #30) — existing
- ✓ Gmail import recipe submitted (PR #27, on hold) — existing

### Active

- [ ] Supabase schema matches OB1's canonical `thoughts` table (drop custom columns: parent_id, chunk_index, full_text)
- [ ] Custom contacts and interactions tables dropped (rebuilding via OB1 Professional CRM extension)
- [ ] MCP server replaced with OB1's canonical Edge Function (base 4 tools: capture_thought, search_thoughts, list_thoughts, thought_stats)
- [ ] Professional CRM extension set up (replaces custom contact tools)
- [ ] Household Knowledge extension set up
- [ ] Meal Planning extension set up
- [ ] Job Hunt extension set up
- [ ] All existing thoughts preserved and functional after migration

### Out of Scope

- Auto-chunking (Issue #1) — on hold, depends on Nate's direction for OB1
- Gmail import enhancements — PR #27 on hold pending Nate's review
- Custom MCP tools beyond what OB1 provides — defeats the purpose of alignment
- Building new extensions — catch up first, contribute later

## Context

- Matt is CEO of MonkeyRun, built Open Brain as a personal project before it became OB1
- monkeyrun-open-brain repo has over-engineered schema (parent_id, chunk_index, full_text, contacts, interactions) that OB1 doesn't have
- OB1 is the canonical open source community project maintained by Nate (NateBJones-Projects)
- Extensions in OB1 are separate Edge Functions with their own schemas — they don't modify the core thoughts table
- Matt has already contributed source filtering recipe and gmail import (on hold)
- After catching up, Matt wants to pick up GitHub issues as a contributor

## Constraints

- **Data preservation**: 1,400+ existing thoughts must survive migration — no data loss
- **Schema direction**: OB1's schema is the source of truth, not monkeyrun-open-brain
- **No main commits**: All OB1 contributions go through PR branches; another person reviews and merges
- **Extension pattern**: OB1 extensions are separate Edge Functions, not modifications to the core MCP server

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace MCP server entirely | Alignment > custom features; extensions re-add what's needed | — Pending |
| Drop contacts/interactions tables | Rebuild via OB1 Professional CRM extension for community compatibility | — Pending |
| Keep existing thoughts | 1,400+ thoughts with embeddings are valuable; safe migration preferred | — Pending |
| Try all 4 extensions | Full adoption means using the community ecosystem, not just core | — Pending |

---
*Last updated: 2026-03-13 after initialization*
