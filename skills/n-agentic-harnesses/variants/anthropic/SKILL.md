---
name: n-agentic-harnesses-anthropic
description: >-
  Design, evaluate, and improve agentic harnesses — the orchestration layer
  around LLM-powered tools, agents, assistants, copilots, workflow runtimes,
  and AI-driven product features. Use this skill whenever the user mentions
  building an agentic system, structuring tool use, adding permissions or
  approval gates, designing multi-step AI workflows, managing context windows
  or memory, making agents durable or resumable, evaluating or pressure-testing
  an existing harness, planning phased implementation for an AI product,
  reviewing agent architecture, improving agent UX or observability, or asking
  how to know if their harness is actually good. Also use when the user
  describes problems that imply harness gaps — like agents doing unexpected
  things, context getting stale, sessions not surviving crashes, tools running
  without permission, or costs spiraling — even if they do not use the word
  "harness."
---

# N Agentic Harnesses For Anthropic

Use this skill as a router for designing, building, and evaluating agentic harnesses.

Read only the files you need. Do not load the entire reference set unless the request genuinely spans multiple subsystems.

Default posture:

- Bias toward lean, solo-maintainable architecture.
- Start with a single-agent design unless clear constraints justify more.
- Require an evaluation plan even for greenfield builds.
- Prefer explicit system boundaries, permission policy, and workflow state over prompt cleverness.
- Translate ideas into implementation phases, success criteria, and failure tests.

## Step 0: Gather Context

Before routing, make sure you have enough to work with.

If the user is asking for a **design**, confirm you understand:

- what product or system the harness serves
- what actions the agent will take
- who the users are
- any known constraints (solo dev, team, existing stack, timeline)

If the user is asking for an **evaluation**, you need access to the harness itself:

- read their codebase, CLAUDE.md, settings, skills, hooks, or architecture docs
- if none of that is available, ask what they have and where it lives
- do not evaluate from vibes alone — gather evidence first

If the request is vague ("help me build an agent" or "is my harness any good"), ask one or two clarifying questions before proceeding. Do not stall the conversation with an interview — get enough to pick a mode and start.

## Step 1: Classify The Request

Choose one mode before reading reference files.

### `design`

Use when the user is creating a new harness, planning a major rebuild, or asking for architecture, MVP, or implementation sequencing.

Default reads:

- `references/01-principles-and-solo-dev-defaults.md`
- `references/02-harness-shapes-and-architecture.md`
- `references/08-design-and-build-playbook.md`

Add subsystem files only as needed.

### `evaluation`

Use when the user already has a harness and wants gaps, risks, missing primitives, UX upgrades, or architectural cleanup.

Default reads:

- `references/01-principles-and-solo-dev-defaults.md`
- `references/09-evaluation-and-improvement-playbook.md`

Add subsystem files only for the parts under review.

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

Read these only when the request needs them:

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
  Read only when adapting this Anthropic-style skill into a Codex-oriented version or when mapping concepts between the two environments.

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
