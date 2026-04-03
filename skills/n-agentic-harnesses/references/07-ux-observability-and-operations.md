# UX, Observability, And Operations

## Table Of Contents

- What this file is for
- User experience patterns
- Operational visibility
- Health checks
- Cost and budget visibility
- Supportability
- How to evaluate this layer

## What This File Is For

Read this when the request involves progress UX, trust, logging, health checks, operator diagnostics, or the practical reality of running the harness.

## User Experience Patterns

Users trust systems that explain themselves.

Good harness UX usually includes:

- visible progress or status changes
- explicit waiting states
- meaningful stop reasons
- approval prompts that explain risk
- resumability messaging when work continues later
- clear distinction between planning, running, and blocked states

Do not hide system uncertainty behind cheerful prose.

## Operational Visibility

Log more than the transcript.

You usually want:

- system events
- tool selections
- permission decisions
- retry events
- failure categories
- state transitions

Keep logs human-readable enough that an operator can diagnose issues fast.

## Health Checks

Include a simple runtime health surface.

The harness should be able to answer:

- which subsystems initialized
- which integrations are reachable
- which policies are active
- whether budgets or queues are healthy
- what common failure is happening now

A “doctor” or “runtime health” pattern is often worth the effort early.

## Cost And Budget Visibility

Track:

- token usage
- model or provider cost
- cost by workflow or feature
- runaway behavior indicators

Visible cost is both an operator tool and a user-trust feature.

## Supportability

Design for future debugging by a tired human.

That means:

- stable identifiers for runs and workflows
- readable error categories
- traceable approval events
- support-friendly timelines
- enough context to reproduce failures without digging through raw chat only

## How To Evaluate This Layer

Check whether:

- the user can tell what the system is doing
- an operator can explain a failure without reverse-engineering the prompt
- a stuck workflow is visible
- costs can be traced to a feature or run
- health checks catch real breakage before users do
