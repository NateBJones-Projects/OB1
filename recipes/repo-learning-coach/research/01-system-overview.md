---
slug: system-overview
title: What Open Brain Is
summary: "One durable memory store, one MCP protocol, any AI client: the thesis and the layered repo structure that surrounds a single core."
category: orientation
sourceUrl: https://github.com/NateBJones-Projects/OB1
---

Open Brain is a persistent memory system for AI. The thesis is simple: **one database, one protocol, any client.** Instead of each assistant (ChatGPT, Claude Desktop, Codex, a CLI) keeping its own siloed, forgettable context, they all read from and write to a single shared store over the Model Context Protocol (MCP). Memory becomes portable across tools and durable across sessions.

## The core

At the center is a Supabase (Postgres) project with the **`pgvector`** extension. The atomic unit of memory is a row in the **`thoughts`** table, which holds the text of a thought plus a vector embedding used for semantic search. Everything else in the system exists to get good thoughts *into* that table, to *link* them, and to *resurface* them at the right moment.

## The layers around the core

The repository is organized as concentric layers that extend the core without changing it:

- **core** — the `thoughts` table, the write/retrieval RPCs, and the base MCP server. Treated as sacred: you may add columns, never alter or drop existing ones.
- **schemas/** — optional table extensions (entity graph, provenance, per-agent identity, book highlights). Additive.
- **recipes/** — standalone capability builds (this learning coach is one). Open for contribution.
- **extensions/** — a curated, ordered set of end-to-end use-case builds (job hunt, meal planning, professional CRM).
- **integrations/** — MCP extensions, webhooks, and capture sources that feed the store.
- **skills/** — reusable prompt packs and behavioral protocols for AI clients.

## Why this structure matters

The layering is a deliberate **stability gradient**. The core changes slowly and carefully because everything depends on it; the outer layers change freely because nothing depends on them. When you read the codebase, always ask which layer you are in — it tells you how much blast radius a change carries. A guard rail enforces the most important rule: never modify the structure of the `thoughts` table.

One more architectural constraint worth internalizing early: **MCP servers are remote**, deployed as Supabase Edge Functions (Deno) and connected through a client's custom-connector UI. There are no local stdio servers. This is what lets every device and every client share the same brain.
