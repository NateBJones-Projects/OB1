# Memory Retrieval

Current retrieval model for this workspace:
- Open Brain via MCP is the primary portability/cross-AI memory surface.
- OpenClaw builtin memory (`memory-core`) remains the fast local operational recall path.
- Markdown files remain source of truth when citation/verification is needed.

## Helpers
Primary in-agent path:
- `openbrain_search`
- `openbrain_capture`
- `openbrain_list_recent`

Shell fallback helpers (cron/non-plugin contexts):
- `scripts/recall_memory.sh "query" [limit]`
- `scripts/query_memory.sh "query" [limit]`
- `scripts/query_memory_exact.sh "term"`
- `scripts/openbrain_capture.sh [--strict] [--dry-run] "content"`
- `scripts/openbrain_capture_tagged.sh --content "..." --category "..." --tags "a,b"`
- `scripts/openbrain_bootstrap.sh [query] [limit]`

Fallback wrappers call Open Brain (`openbrain.search_thoughts`) through `scripts/openbrain_call.sh`.

## Reliability defaults
- `openbrain_call.sh` adds timeout + retry to reduce transient MCP/network failures.
- `openbrain_capture.sh` logs failed writes to `reports/openbrain-capture-errors.log`.
- Default capture mode is best-effort (for cron/hooks); use `--strict` when failures must surface immediately.

## Tagged capture without server-side metadata schema
Current OpenBrain MCP in this workspace accepts `capture_thought({ content })` only.

To keep taxonomy/category conventions usable now, `openbrain_capture_tagged.sh` stores a stable text envelope:

```text
[OBMETA v1]
category: <category>
tags: <tag1, tag2, ...>
source: <source>
---
<actual thought content>
```

This preserves portability and retrieval hints until the MCP server supports structured metadata fields natively.

## Policy
- Do not rely on decommissioned local Chroma/SQLite legacy tooling.
- Decommissioned local memory-index tooling is archived at:
  - `archive/decommissioned-local-memory-tools/`

## Split of responsibilities
- Use OpenClaw builtin memory for low-latency local retrieval in active sessions.
- Use OpenBrain for cross-model shared memory and long-lived portable recall.
