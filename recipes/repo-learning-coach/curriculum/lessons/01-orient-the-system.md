---
slug: orient-the-system
title: Orient the System
stage: Foundations
difficulty: Intro
order: 1
estimatedMinutes: 15
summary: "Build the top-level mental model: one shared memory store, one protocol, many clients, wrapped in layers with a deliberate stability gradient."
goals:
  - State the "one brain, any client" thesis and why it exists.
  - Name the core and the layers that extend it without changing it.
  - Explain the stability gradient and the one rule that protects the core.
relatedResearch:
  - system-overview
quiz:
  title: Check your orientation
  passingScore: 70
  questions:
    - prompt: What is the central thesis of Open Brain?
      options:
        - Each AI client should keep its own private, optimized memory.
        - One shared, durable memory store that any AI client can read and write over MCP.
        - A faster vector database that replaces Postgres.
        - A chat UI that summarizes conversations.
      correctOption: One shared, durable memory store that any AI client can read and write over MCP.
      explanation: The point is portability and durability of memory across tools and sessions, reached through a single store shared over the Model Context Protocol.
    - prompt: Why is the repo organized into concentric layers (core, schemas, recipes, extensions, integrations, skills)?
      options:
        - To create a stability gradient where the core changes slowly and outer layers change freely.
        - Because Supabase requires that folder structure.
        - To keep each AI client's code separate.
        - Purely for documentation; the layers have no technical meaning.
      correctOption: To create a stability gradient where the core changes slowly and outer layers change freely.
      explanation: Everything depends on the core, so it changes carefully; nothing depends on the outer layers, so they can move fast. The layer you are in tells you the blast radius of a change.
    - prompt: Which rule most directly protects the core?
      options:
        - Never deploy MCP servers as Edge Functions.
        - Never add new tables to the database.
        - Never alter or drop existing columns on the thoughts table (adding columns is fine).
        - Never write more than one thought per session.
      correctOption: Never alter or drop existing columns on the thoughts table (adding columns is fine).
      explanation: The thoughts table is the shared foundation. Additive changes are safe; altering or dropping existing structure would break every client and layer that depends on it.
---

## The one-sentence version

**Open Brain is one durable memory store that any AI client can share, over one protocol.** Hold that sentence; the entire codebase is an elaboration of it.

## Why it exists

Most AI assistants forget. Context lives inside a single tool and a single session, then evaporates. Open Brain inverts that: memory lives in a shared Supabase database, and clients — ChatGPT, Claude Desktop, Codex, a CLI, a cron job — connect to it over the **Model Context Protocol (MCP)**. Write a thought from your laptop CLI in the morning; recall it from Claude Desktop that night. The memory is portable across tools and durable across time.

## The core and its layers

At the center is a Postgres database (Supabase) with `pgvector`, and one table that matters above all others: **`thoughts`**. Around it, the repo is organized as concentric layers:

- **core** — the `thoughts` table, the write/read RPCs, the base MCP server.
- **schemas/** — additive table extensions (graph, provenance, identity).
- **recipes/** — standalone capability builds (this course is one).
- **extensions/** — curated end-to-end use-case builds.
- **integrations/** — capture sources, webhooks, MCP extensions.
- **skills/** — prompt packs and behavioral protocols for clients.

## The stability gradient

The layering is not decoration — it is a **gradient of how fast things are allowed to change**. The core sits at the bottom because everything depends on it, so it changes slowly and deliberately. The outer layers sit on top because nothing depends on them, so they change freely. When you open a file, your first question should be *which layer am I in?* — because that answers *how careful do I need to be?*

The rule that guards the bottom of the gradient: **never alter or drop existing columns on `thoughts`.** Adding is fine. Rewriting the foundation is not.

## One structural fact to carry forward

MCP servers here are **remote** — Supabase Edge Functions, connected through each client's connector UI. There are no local servers. That single choice is what lets every device share one brain, and you will see its fingerprints throughout the runtime layer.
