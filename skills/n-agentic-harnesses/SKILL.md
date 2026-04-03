---
name: n-agentic-harnesses
description: Design, evaluate, and improve agentic harnesses for developer tools, assistants, workflow runtimes, copilots, and AI-powered products. Use when work involves tool-use architecture, permissions, approval gates, workflow state, durability, context and memory systems, evaluation strategy, observability, operator visibility, or phased implementation plans for an AI system. Trigger when symptoms imply harness gaps too: stale context, surprising tool calls, sessions that die on crash, missing approval controls, or costs spiraling without clear visibility.
author: Jonathan Edwards
version: 1.0.0
---

# N Agentic Harnesses

## Problem

Most AI products do not break because the model is too weak. They break at the harness layer: unclear tool boundaries, missing approval policy, brittle state, sloppy context assembly, no evaluation loop, and weak operator visibility. This skill turns those vague issues into concrete primitives, boundaries, phases, and checks.

## Trigger Conditions

- The user is designing or rebuilding an agent, assistant, copilot, or AI workflow
- The request mentions harness architecture, tool-use architecture, tool registries, permission layers, approval gates, workflow state, session persistence, retries, resumability, memory, evals, observability, or multi-agent design
- The user wants to evaluate an existing harness for risks, missing primitives, UX gaps, or operational weakness
- The symptoms point to harness problems even if the word "harness" never appears:
  - tools fire without clear permission
  - sessions fail on crash or long waits
  - context gets stale or bloated
  - operators cannot see what happened or why
  - costs, retries, or handoffs are drifting out of control

## Default Posture

- Bias toward lean, solo-maintainable architecture.
- Start with a single-agent design unless clear constraints justify more.
- Require an evaluation plan even for greenfield builds.
- Prefer explicit system boundaries, permission policy, and workflow state over prompt cleverness.
- Translate ideas into implementation phases, success criteria, and failure tests.

## Step 0: Gather Context

Before routing, make sure you have enough to work with.

For design work, confirm:

- what product or system the harness serves
- what actions the agent will take
- who the users are
- any known constraints such as solo maintenance, existing stack, or timeline

For evaluation work, inspect the harness itself:

- read the codebase, agent config, skills, hooks, or architecture docs
- if evidence is missing, ask for the narrowest missing input and keep moving
- do not evaluate from vibes alone

## Step 1: Classify The Request

Choose one mode before reading reference files.

### `design`

Use when the user is creating a new harness, planning a major rebuild, or asking for architecture, MVP shape, or implementation sequencing.

Default reads:

- `references/01-principles-and-solo-dev-defaults.md`
- `references/02-harness-shapes-and-architecture.md`
- `references/08-design-and-build-playbook.md`

### `evaluation`

Use when the user already has a harness and wants gaps, risks, missing primitives, UX upgrades, or architectural cleanup.

Default reads:

- `references/01-principles-and-solo-dev-defaults.md`
- `references/09-evaluation-and-improvement-playbook.md`

### `design + evaluation`

Use when the user wants a target architecture and a way to verify it, compare it with an existing system, or define acceptance criteria before building.

Default reads:

- `references/01-principles-and-solo-dev-defaults.md`
- `references/02-harness-shapes-and-architecture.md`
- `references/08-design-and-build-playbook.md`
- `references/09-evaluation-and-improvement-playbook.md`

## Step 2: Classify The Product Shape

Determine the closest product shape before going deeper:

- code agent
- chat assistant
- workflow orchestrator
- internal copilot
- embedded AI product feature
- hybrid system

If the request is ambiguous, pick the closest shape and state the assumption.

## Step 3: Read The Smallest Useful Reference Set

Read only the files the request actually needs:

- `references/01-principles-and-solo-dev-defaults.md`
  Use first for almost every request. It defines the default decision posture.
- `references/02-harness-shapes-and-architecture.md`
  Read when choosing system shape, boundaries, lifecycle, transports, or deployment structure.
- `references/03-tools-execution-and-permissions.md`
  Read when the request involves tool registries, tool calling, approval gates, sandboxes, or trust tiers.
- `references/04-state-sessions-and-durability.md`
  Read when the request involves sessions, resumability, retries, idempotency, approval waits, or long-running work.
- `references/05-context-memory-and-evaluation.md`
  Read when the request involves context windows, retrieval, memory, provenance, evals, replay tests, or regression detection.
- `references/06-agents-and-extensibility.md`
  Read when the request involves multi-agent design, plugins, hooks, skills, or extension surfaces.
- `references/07-ux-observability-and-operations.md`
  Read when the request involves streaming UX, health checks, logs, analytics, budgets, or supportability.
- `references/08-design-and-build-playbook.md`
  Read when the user needs a build-ready plan from idea to implementation.
- `references/09-evaluation-and-improvement-playbook.md`
  Read when the user needs findings, missing primitives, upgrade priorities, or acceptance tests.
- `references/10-example-requests-and-output-patterns.md`
  Read when you need prompt examples or response structure examples.
- `references/11-codex-translation-notes.md`
  Read only when adapting the shared skill into a Codex-oriented variant or mapping between client environments.

Do not rely on reference-to-reference chains. This file is the index.

## Operating Rules

- Convert vague ambitions into concrete harness primitives.
- Push back on unnecessary complexity.
- Treat workflow state, permissions, context assembly, and evaluation as first-class architecture, not cleanup tasks.
- Separate universal harness primitives from product-specific manifestation.
- For evaluation requests, present findings first and improvement sequence second.
- For design requests, include how the design will be tested before calling it done.

## Output Contract

### For `design`

Return:

- recommended harness shape
- core primitives and subsystem boundaries
- MVP boundary
- phased implementation plan
- verification and acceptance criteria

### For `evaluation`

Return:

- findings ordered by severity or leverage
- missing or weak primitives
- user experience and operational gaps
- prioritized upgrade path
- tests or checks that confirm the fixes

### For `design + evaluation`

Return:

- target architecture
- comparison against current or likely failure modes
- implementation phases
- acceptance criteria
- evaluation plan covering regressions, safety, and UX

## Final Check Before Responding

- Did you keep the design lean enough for a solo developer unless the request clearly demanded more?
- Did you avoid recommending multi-agent coordination by default?
- Did you include evaluation, not just construction?
- Did you give the user an operational path forward instead of abstract theory?
