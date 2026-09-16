# Agents And Extensibility

## Table Of Contents

- What this file is for
- Single-agent default
- When to split into multiple agents
- Role constraints
- Extensibility surfaces
- What not to overbuild
- How to evaluate this layer

## What This File Is For

Read this when the user asks about multi-agent systems, plugins, hooks, skills, extension points, or future-proofing a harness.

## Single-Agent Default

Start with one orchestrator unless there is a hard reason not to.

A single-agent harness is usually easier to:

- reason about
- debug
- permission
- evaluate
- operate as a solo builder

## When To Split Into Multiple Agents

Split only when role separation materially improves safety or clarity.

Good reasons:

- one role should never touch mutating tools
- long-running planning and execution need distinct constraints
- parallel work meaningfully reduces latency or operator load
- different tasks need incompatible tool sets

Weak reasons:

- it sounds more advanced
- it looks impressive in demos
- one prompt feels crowded

## Role Constraints

If you add more than one agent, define:

- role
- allowed tools
- denied tools
- handoff format
- state ownership
- stop conditions

Examples:

- planner: proposes steps but does not execute writes
- explorer: reads and gathers evidence
- executor: performs approved actions only
- verifier: checks outputs against invariants

## Extensibility Surfaces

Useful extension surfaces:

- capability registry entries
- plugin interfaces
- hooks around key lifecycle events
- skills or recipes for repeatable workflows
- configuration migrations for evolving behavior safely

Make extensions explicit. The system should know what can plug in, when it runs, and what permissions it inherits.

## What Not To Overbuild

Avoid building:

- a plugin system before you have stable core primitives
- generalized hooks for only one current use case
- shared memory across agents without ownership rules
- more agent types than your evaluation suite can cover

## How To Evaluate This Layer

Check:

- whether multiple agents actually improve the job
- whether each role has a clear permission story
- whether handoffs lose context or duplicate work
- whether plugins can bypass policy
- whether hooks create invisible side effects

If the multi-agent story is harder to explain than the single-agent one, default back to single-agent.
