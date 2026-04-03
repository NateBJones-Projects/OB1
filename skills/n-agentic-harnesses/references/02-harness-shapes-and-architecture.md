# Harness Shapes And Architecture

## Table Of Contents

- What this file is for
- Common harness shapes
- Minimum subsystem map
- Lifecycle design
- Runtime and transport choices
- Architecture questions to answer
- How to evaluate the architecture

## What This File Is For

Read this when the user needs help choosing a harness shape, defining system boundaries, or translating goals into an architecture.

## Common Harness Shapes

### Chat Assistant

Best when the user needs conversational help, tool use, and a human-friendly loop.

Default architecture:

- request entrypoint
- orchestrator
- capability registry
- permission layer
- context assembly
- session store
- streaming response layer

### Workflow Orchestrator

Best when the system coordinates multi-step work, delayed execution, approvals, or callbacks.

Default architecture:

- event or API entrypoint
- workflow controller
- state store
- capability registry
- permission policy
- job execution workers
- status and retry handling

### Code Agent

Best when the system must inspect files, run commands, edit code, or operate in a workspace.

Default architecture:

- session controller
- tool registry with shell and file boundaries
- permission and trust stack
- transcript and system event logging
- workspace awareness
- human approval for risky execution

### Embedded AI Product Feature

Best when the agent exists inside a broader product experience rather than as a standalone assistant.

Default architecture:

- product API or UI entrypoint
- thin orchestration layer
- narrow tool surface
- product-aware context assembly
- event logging
- feature-specific evaluation suite

### Hybrid System

Use when the product needs both conversation and durable workflows.

Default architecture:

- conversational front door
- workflow handoff path
- shared policy layer
- session and workflow state separation
- unified status model

## Minimum Subsystem Map

For most serious harnesses, define these boundaries explicitly:

- entrypoint: where work starts
- orchestrator: who decides next action
- capability registry: what the system can do
- execution layer: how actions actually run
- permission layer: what is allowed now
- state layer: what survives between steps
- context layer: what information is assembled for the model
- evaluation layer: how regressions are caught
- observability layer: how humans inspect the system

If two of these are merged, say so explicitly and explain why.

## Lifecycle Design

Define the runtime lifecycle in plain language:

1. how the request or event enters
2. what is loaded before the first model call
3. how tools are selected
4. where permissions are checked
5. where state is written
6. how the system stops, waits, or resumes
7. how results and diagnostics are emitted

The agent is only one part of the lifecycle. Make the rest visible.

## Runtime And Transport Choices

Match the runtime to the job:

- synchronous API route for short bounded tasks
- background worker or queue for long-running steps
- durable workflow engine when pause and resume are core requirements
- streaming transport when user trust depends on visible progress
- event-driven handoff when external systems drive the lifecycle

Do not recommend a durable engine just because it is fashionable. Recommend it when failure recovery, retries, approvals, or callbacks make it necessary.

## Architecture Questions To Answer

Before finalizing an architecture, answer these:

- what job is the harness actually doing?
- what is synchronous versus asynchronous?
- what actions can mutate real systems?
- what has to survive restarts?
- what information is required before the first step?
- where can a human intervene?
- what is the smallest useful evaluation suite?

## How To Evaluate The Architecture

Do not end at boxes and arrows. Verify that the architecture can answer:

- where dangerous actions are stopped or approved
- how duplicate writes are prevented
- how long-running work resumes
- how stale or conflicting context is handled
- how failures surface to operators and users
- how new changes are tested before rollout

If the architecture has no clear answer to those questions, it is not ready.
