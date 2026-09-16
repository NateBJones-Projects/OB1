---
name: n-agentic-harnesses-codex
description: Designs, evaluates, and improves agentic harnesses for developer tools, assistants, workflow runtimes, copilots, and AI-powered products. Applies when work involves defining or reviewing tool-use architecture, permissions, workflow state, durability, context and memory systems, evaluation strategy, observability, user experience, or phased implementation plans for an agentic system.
metadata:
  priority: 6
  pathPatterns:
    - '**/*harness*'
    - '**/*agent-runtime*'
    - '**/*agent_runtime*'
    - '**/*orchestrat*'
    - '**/*workflow*'
    - '**/*tool-registry*'
    - '**/*tool_registry*'
    - '**/*permission*'
    - '**/*approval*'
    - '**/*state-machine*'
    - '**/*state_machine*'
    - '**/*session*'
    - '**/*memory*'
    - '**/*eval*'
    - '**/*retry*'
  importPatterns:
    - '@modelcontextprotocol/*'
    - 'langgraph'
    - '@langchain/*'
    - 'langchain'
    - '@vercel/workflow'
  bashPatterns:
    - '\bnpm\s+(install|i|add)\s+[^\n]*(langgraph|langchain|@vercel/workflow|@modelcontextprotocol)\b'
    - '\bpnpm\s+(install|i|add)\s+[^\n]*(langgraph|langchain|@vercel/workflow|@modelcontextprotocol)\b'
    - '\bbun\s+(install|i|add)\s+[^\n]*(langgraph|langchain|@vercel/workflow|@modelcontextprotocol)\b'
    - '\byarn\s+add\s+[^\n]*(langgraph|langchain|@vercel/workflow|@modelcontextprotocol)\b'
  promptSignals:
    phrases:
      - "agentic harness"
      - "agent harness"
      - "ai harness"
      - "harness architecture"
      - "agent architecture"
      - "agent runtime"
      - "agent workflow runtime"
      - "tool-use architecture"
      - "tool use architecture"
      - "tool calling system"
      - "tool registry"
      - "capability registry"
      - "permission layer"
      - "approval gate"
      - "human-in-the-loop"
      - "workflow state"
      - "session persistence"
      - "durable agent"
      - "durable workflow"
      - "resume after crash"
      - "crash-safe agent"
      - "retry and idempotency"
      - "context assembly"
      - "memory system"
      - "evaluation harness"
      - "replay evals"
      - "agent observability"
      - "operator visibility"
      - "multi-agent architecture"
      - "single agent vs multi-agent"
      - "stop reasons"
    allOf:
      - [agent, harness]
      - [tool, registry]
      - [permission, approval]
      - [workflow, state]
      - [resume, retry]
      - [context, memory]
      - [evaluation, harness]
      - [multi-agent, architecture]
      - [durable, agent]
      - [operator, visibility]
    anyOf:
      - "agent orchestration"
      - "approval workflow"
      - "tool-calling runtime"
      - "tool calling runtime"
      - "state machine"
      - "retry policy"
    noneOf: []
    minScore: 6
---

# N Agentic Harnesses For Codex

Use this skill as a router for designing, building, and evaluating agentic harnesses.

Read only the files you need. Do not load the entire reference set unless the request genuinely spans multiple subsystems.

Default posture:

- Bias toward lean, solo-maintainable architecture.
- Start with a single-agent design unless clear constraints justify more.
- Require an evaluation plan even for greenfield builds.
- Prefer explicit system boundaries, permission policy, and workflow state over prompt cleverness.
- Translate ideas into implementation phases, success criteria, and failure tests.

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
