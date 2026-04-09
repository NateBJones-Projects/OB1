# Principles And Solo-Dev Defaults

## Table Of Contents

- What this file is for
- Default stance
- Solo-dev default architecture rules
- Complexity ladder
- Non-negotiables
- Anti-patterns to push back on
- What good outputs look like

## What This File Is For

Read this first for most requests. It sets the default posture for the rest of the skill.

This skill is flexible enough for any developer, but its defaults should favor a builder who wants a maintainable, debuggable, and economically sane system.

## Default Stance

Optimize for:

- clarity over cleverness
- inspectability over magic
- explicit policy over hidden heuristics
- staged rollout over grand architecture
- durable behavior over impressive demos

Assume the user wants a harness they can operate themselves six months from now.

## Solo-Dev Default Architecture Rules

Start from these defaults and only expand when constraints justify it:

1. Use a single orchestrator first.
2. Use one source of truth for capabilities and policies.
3. Separate metadata from execution.
4. Put side effects behind explicit permissions or approval gates.
5. Treat workflow state as a system concern, not a UI concern.
6. Keep memory small, scoped, and provenance-aware.
7. Make logs and health checks readable by humans.
8. Define evaluation before scale.

## Complexity Ladder

Add complexity only when you cross a real threshold.

### Level 1: Lean Harness

Use when the system is mostly request-response with short tasks.

Include:

- one orchestrator
- capability registry
- permission rules
- session persistence if conversations matter
- basic logging
- replayable evaluation prompts

### Level 2: Durable Harness

Use when tasks span time, approvals, retries, or external callbacks.

Add:

- workflow state machine
- idempotency keys
- retry policy
- explicit waiting states
- resumability after crash or reconnect

### Level 3: Extensible Harness

Use when multiple products, teams, or third-party integrations must plug into the same runtime.

Add:

- plugins or hooks
- extension boundaries
- stronger policy enforcement
- subsystem health views

### Level 4: Coordinated Multi-Agent Harness

Use only when one agent cannot keep the job coherent.

Add:

- role-constrained workers
- ownership boundaries
- handoff protocol
- shared state contract
- evaluation for coordination failure

If the user has not proven the need for Level 4, do not recommend it.

## Non-Negotiables

Do not ship a serious harness without these ideas somewhere in the design:

- explicit capability inventory
- permission policy
- workflow or session persistence appropriate to the task
- context budget awareness
- provenance for retrieved or remembered information
- evaluation plan
- observability a human can use

## Anti-Patterns To Push Back On

Push back when the design leans on:

- one giant agent prompt with no system boundaries
- every tool available in every context
- hidden writes with no approval or audit story
- conversation history treated as the only state model
- memory that stores facts with no provenance or expiry
- multi-agent coordination introduced for status or aesthetics
- “we’ll test it manually later” as the evaluation strategy
- analytics without actionable health signals

## What Good Outputs Look Like

A strong response from this skill should:

- name the harness shape
- define the smallest viable subsystem set
- say what to build now versus later
- explain where user trust is earned or lost
- include failure modes
- include how the system will be evaluated

If the answer sounds like a manifesto instead of a build plan, tighten it.
