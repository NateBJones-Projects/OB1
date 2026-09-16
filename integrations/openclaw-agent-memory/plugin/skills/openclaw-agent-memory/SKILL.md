---
name: nbj-ob1-agent-memory-openclaw
description: Use Nate Jones OB1 Agent Memory from OpenClaw with provenance, scope, review, and use-policy discipline.
---

# NBJ OB1 Agent Memory for OpenClaw

Use this skill when an OpenClaw task has access to NBJ OB1 Agent Memory tools. OB1 is the continuity layer. OpenClaw is the runtime that performs the work.

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

If the tools are unavailable, continue the task normally and note that no OB1 recall or write-back occurred. Do not invent remembered facts.

## Pre-Task Recall

Before meaningful work, call `openbrain_recall` with:

- `task_type`
- `query`
- `entities`
- `scope`
- `limits`
- `sensitivity`

Prefer project-scoped recall when a project is known. Keep `project_only` true by default. Keep `include_unconfirmed` false unless the user explicitly asks for evidence-level context or the task is review/debugging.

Do not pull personal or channel-only memory into team work unless the user explicitly shared it.

Use returned memories according to `use_policy`:

- `can_use_as_instruction`: the memory can guide behavior directly.
- `can_use_as_evidence`: the memory can inform reasoning, but it is not binding.
- `requires_user_confirmation`: surface the claim before relying on it.

If two memories conflict, prefer user-confirmed or trusted imported memory over inferred or generated memory. If the conflict matters, ask for confirmation or proceed with the lower-risk assumption.

## Post-Task Write-Back

After the task completes, call `openbrain_writeback` with compact categories:

- `decisions`
- `outputs`
- `lessons`
- `constraints`
- `unresolved_questions`
- `next_steps`
- `failures`
- `artifacts`

Do not write raw transcripts, model reasoning traces, secret-like values, credential strings, large code blocks, or private customer data dumps. Store summaries and source references.

Agent-written memory starts as evidence by default. It can become instruction only when a human confirms it or it is imported from a trusted source.

Decision memories can become future instructions only when they are `user_confirmed` or imported from a trusted source. Model-generated lessons are evidence or suggestions until reviewed.

## Usage Reporting

After recall, report which memory IDs were used or ignored with `openbrain_report_usage`. This preserves the recall trace so bad behavior can be debugged later.

## Code Review Memory Mode

For pull request review tasks, recall:

- repo conventions
- prior review comments
- recurring bug patterns
- risky files or subsystems
- test expectations
- security-sensitive patterns
- maintainer preferences

Write back:

- recurring issue patterns
- maintainer corrections
- false positives to avoid
- tests that caught or missed the issue
- fixes applied
- reusable repo lessons

Do not store the full diff. Store artifact references to PRs, commits, or files.

## TaskFlow Work Log Mode

For long-running TaskFlows, recall:

- prior task attempts
- blockers
- decisions
- project constraints
- owner and channel context

Write back:

- what was attempted
- what changed
- what failed
- what remains open
- what should be reviewed
- what the next agent should know

The write-back should let another agent continue without reading the full transcript.
