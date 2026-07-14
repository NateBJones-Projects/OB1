---
slug: runtime-and-ops
title: The Runtime and Ops Layer
summary: "Remote MCP servers as Edge Functions, plus a set of scheduled jobs that extract entities, consolidate memory, synthesize digests, and watch the system's health."
category: operations
---

Open Brain is not just a schema — it is a running system with a serverless runtime and a set of background jobs that keep memory useful over time.

## The runtime: remote MCP as Edge Functions

AI clients talk to the brain over MCP. Those MCP servers are deployed as **Supabase Edge Functions** (Deno) and connected through each client's custom-connector UI. There is no local server process. This constraint is what makes the same brain reachable from every device and client at once, and it shapes how every integration in the repo is built and deployed.

## The scheduled jobs

Postgres `pg_cron` runs the recurring work. The live schedule includes:

- **`entity-extraction-worker`** (every 15 min) — drains `entity_extraction_queue`, pulling entities and edges out of new thoughts.
- **`weekly-auditor`** (Sundays) — an editorial-policy pass that computes lint/hygiene metrics before any LLM step and writes results into thought metadata.
- **`daily-morning-briefing`** and **`weekly-summary`** — synthesis jobs that read many thoughts and write back a derived digest.
- **`weekly-consolidation-metadata`** and **`weekly-consolidation-bio`** — memory-consolidation passes, logged in `consolidation_log`.
- **`brain-health-monitor`** (hourly) — writes `ops_health_snapshots` and manages `ops_alert_state`.
- **`monthly-retention-purge`** — lifecycle cleanup.

## The ops tables

Operational state is first-class, not an afterthought:

- **`ops_cron_invocations`** — a log of each scheduled run (the observability backbone).
- **`ops_health_snapshots`** — periodic health captures for trend detection.
- **`ops_alert_state`** — dedupe/state so alerts fire once, not every tick.

## The takeaway

Two kinds of work run against the brain. **Synchronous** work is a client writing or recalling a thought over MCP. **Asynchronous** work is the cron fleet enriching, consolidating, synthesizing, and monitoring in the background. A healthy Open Brain is one where the async jobs quietly keep the store linked, deduplicated, summarized, and observable — so the synchronous path always returns something good.
