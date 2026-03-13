# The Soul of Open Brain

This document defines what Open Brain is, what belongs here, and what doesn't. It's read by humans considering contributions and by an automated LLM check that evaluates alignment on every PR and issue.

If you're thinking about contributing, read this first. If something you want to build doesn't fit, that doesn't mean it's a bad idea — it just means it might belong somewhere else.

## Core Thesis

Your AI memory shouldn't be locked inside one app. Open Brain is a database with vector search and an open protocol — built so that every AI tool you use shares the same persistent memory of you. One brain. All of them.

## This Belongs in OB1

- **Capture pathways** — new ways to get knowledge into Open Brain (importers, integrations, capture tools)
- **Retrieval pathways** — new ways to search, surface, or use knowledge from Open Brain
- **Processing capabilities** — transforms, summaries, connections, or analysis of stored knowledge
- **Schema extensions** — new tables or metadata structures that extend what Open Brain can track
- **Dashboards and UIs** — visual interfaces for browsing, reviewing, or managing your brain
- **Teaching through building** — contributions that help people learn AI infrastructure concepts by building something useful
- **Works with the standard schema** — builds on the `thoughts` table, MCP protocol, and Supabase/OpenRouter stack
- **Runs on free-tier services or local tools** — accessible to anyone, not just people with paid accounts
- **Personal, creative, wellness, and non-technical use cases** — these are first-class, not afterthoughts

## This Doesn't Belong

- **Platform lock-in** — if it only works with one AI tool and can't be adapted, it misses the point
- **Paid-only dependencies** — if there's no free-tier or local alternative, it creates a barrier
- **Core infrastructure changes** — the `thoughts` table schema and MCP server are upstream concerns, not community contribution scope
- **Duplicates without improvement** — if an existing contribution does the same thing, the new one needs to be meaningfully better
- **Complexity without proportional value** — a recipe that takes 2 hours to set up needs to deliver 2 hours of value
- **External data storage** — the user's data stays in their own Supabase instance, always
- **Closed-source dependencies** — if the contribution requires proprietary software that can't be swapped out

## Values (For Judgment Calls)

When something doesn't clearly fit the lists above, use these values to decide:

- **Portability over features** — a simpler tool that works across 5 AI clients beats a powerful one that only works in one
- **Simplicity over power** — a 20-minute recipe beats a 2-hour recipe if both achieve similar goals
- **User ownership** — the user controls their data, their instance, their choices
- **Progressive learning** — contributions should teach the user something, not just hand them a black box
- **Tangents are gold** — personal, wellness, creative, relational use cases often contain the highest-value ideas. Never dismiss them as "not technical enough"
- **Working code over perfect code** — a tested, shipped contribution beats an elegant one that never lands
- **Community over gatekeeping** — when in doubt, help shape a contribution to fit rather than rejecting it

## How This Document Is Used

1. **Contributors** read it before starting work to check alignment
2. **Reviewers** reference it when evaluating PRs and issues
3. **An automated LLM check** evaluates every PR and issue against this document and posts an advisory comment
4. **Maintainers** update it as the project evolves — this is a living document

The automated check is advisory, not blocking. It flags potential misalignment for human reviewers. It never auto-rejects contributions.
