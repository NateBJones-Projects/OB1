---
name: openclaw-agent-memory
description: Recall and write back OB1 Agent Memory from OpenClaw while respecting provenance, scope, review, and use-policy rules.
---

# OpenClaw Agent Memory for OB1

Use this skill when an OpenClaw task has access to OB1 Agent Memory tools. OB1 is the continuity layer. OpenClaw is the runtime that performs the work.

## Core Rule

Recall before meaningful work. Write back only compact, provenance-labeled operational memory after the work is complete.

## Available Tools

Use the OpenClaw plugin tools when available:

- `openbrain_recall`
- `openbrain_writeback`
- `openbrain_report_usage`
- `openbrain_inspect_memory`
- `openbrain_list_review_queue`
- `openbrain_review_memory`
- `openbrain_get_recall_trace`

If the tools are unavailable, continue the task normally and note that no OB1 recall or write-back occurred.

## Pre-Task Recall

Before meaningful work, call `openbrain_recall` with task type, query, entities, scope, limits, and sensitivity.

Respect returned `use_policy`:

- `can_use_as_instruction`: the memory can guide behavior directly.
- `can_use_as_evidence`: the memory can inform reasoning, but it is not binding.
- `requires_user_confirmation`: surface the claim before relying on it.

Prefer user-confirmed or trusted imported memory over inferred or generated memory.

## Post-Task Write-Back

After the task completes, call `openbrain_writeback` with compact decisions, outputs, lessons, constraints, unresolved questions, next steps, failures, and artifact references.

Do not write raw transcripts, model reasoning traces, secret-like values, credential strings, large code blocks, or private customer data dumps. Store summaries and source references.

Agent-written memory starts as evidence by default. It can become instruction only when a human confirms it or it is imported from a trusted source.

## Usage Reporting

After recall, report which memory IDs were used or ignored with `openbrain_report_usage`.
