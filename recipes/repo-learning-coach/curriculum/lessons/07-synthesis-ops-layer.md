---
slug: synthesis-ops-layer
title: The Synthesis and Ops Layer
stage: Runtime
difficulty: Advanced
order: 7
estimatedMinutes: 22
summary: "The background system: remote MCP Edge Functions, a pg_cron fleet that extracts, consolidates, synthesizes, and monitors, and the ops_* tables that make it observable."
goals:
  - Explain why MCP servers are remote Edge Functions and what that enables.
  - Map the main cron jobs to the memory jobs they serve.
  - Explain how recipes, schemas, and extensions extend the core without touching thoughts.
relatedResearch:
  - runtime-and-ops
  - system-overview
quiz:
  title: Check the runtime
  passingScore: 70
  questions:
    - prompt: Why are Open Brain's MCP servers deployed as remote Supabase Edge Functions rather than local processes?
      options:
        - Because Deno cannot run locally.
        - So every device and client can reach the same brain over the network, with no per-machine server.
        - To make them harder to connect to.
        - Because Postgres requires it.
      correctOption: So every device and client can reach the same brain over the network, with no per-machine server.
      explanation: Remote Edge Functions are what let one shared brain be reachable from any client on any device; local stdio servers would tie memory back to a single machine.
    - prompt: The entity-extraction-worker runs on a schedule and drains entity_extraction_queue. Which earlier mechanism fills that queue?
      options:
        - The weekly auditor.
        - The trg_queue_entity_extraction trigger on the write path.
        - The client, manually.
        - The health monitor.
      correctOption: The trg_queue_entity_extraction trigger on the write path.
      explanation: Writing a thought enqueues it (lesson 3); the scheduled worker later drains the queue to build the graph. Write path and cron fleet are two halves of one flow.
    - prompt: What is the purpose of the ops_* tables (ops_cron_invocations, ops_health_snapshots, ops_alert_state)?
      options:
        - They store user thoughts.
        - They make the background system observable — logging runs, capturing health, and deduping alerts.
        - They replace the thoughts table on weekends.
        - They hold the vector embeddings.
      correctOption: They make the background system observable — logging runs, capturing health, and deduping alerts.
      explanation: "Operational state is first-class: invocations are logged, health is snapshotted for trends, and alert state prevents duplicate alerts."
---

## Two kinds of work

Everything so far described the **synchronous** path: a client writes or recalls a thought over MCP, right now. But a memory system also needs **asynchronous** work — enrichment, consolidation, synthesis, monitoring — running quietly in the background. This lesson is that second half.

## The runtime: remote MCP

Clients reach the brain through MCP servers deployed as **Supabase Edge Functions** (Deno), connected via each client's custom-connector UI. No local server runs on your laptop. That single choice is what makes "any client, any device, one brain" literally true — and it is why every integration in the repo is written to deploy as an Edge Function rather than a local process.

## The cron fleet

Postgres `pg_cron` runs the recurring work. Map each job to the memory job it serves:

- **`entity-extraction-worker`** (every 15 min) — *structure.* Drains `entity_extraction_queue` (filled by the write-path trigger) into entities and edges.
- **`weekly-consolidation-metadata`** and **`weekly-consolidation-bio`** (Sundays) — *maintenance.* Consolidate memory, logged in `consolidation_log`.
- **`daily-morning-briefing`** and **`weekly-summary`** — *synthesis.* Read many thoughts, write back a **derived** digest (lesson 6 provenance applies).
- **`weekly-auditor`** (Sundays) — *maintenance/quality.* Computes lint and hygiene metrics before any LLM step and folds them into thought metadata.
- **`brain-health-monitor`** (hourly) — *observability.* Writes `ops_health_snapshots` and manages `ops_alert_state`.
- **`monthly-retention-purge`** — *lifecycle.*

Notice the loop closing: the write path *enqueues* extraction (lesson 3), and the cron worker *drains* it here. The two halves you learned separately are one pipeline.

## Observability is first-class

The **`ops_*`** tables make the background legible: `ops_cron_invocations` logs every run, `ops_health_snapshots` captures health for trend detection, and `ops_alert_state` dedupes alerts so they fire once, not every tick. You cannot operate what you cannot see, so operability lives in the schema, not in a side channel.

## Extending without touching the core

Finally, zoom back out to lesson 1's layers. New capability arrives as **recipes** (like this course), **schemas** (additive tables such as the provenance or graph extensions), and **extensions** (use-case builds) — all of which read and write through `upsert_thought` / `match_thoughts` and add their own tables. The core `thoughts` table is never restructured. That discipline is what has let the system grow this many moving parts while staying coherent: a stable center, an extensible edge, and a background fleet keeping the whole thing healthy.
