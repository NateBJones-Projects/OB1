# State, Sessions, And Durability

## Table Of Contents

- What this file is for
- Session state versus workflow state
- When durability is required
- Core durability primitives
- Approval and waiting states
- Failure modes
- How to evaluate this layer

## What This File Is For

Read this when the harness has conversations, long-running tasks, retries, callbacks, approvals, or any requirement to survive crashes and reconnects.

## Session State Versus Workflow State

Do not confuse these.

Session state answers:

- what the user and agent have said
- what the current conversation context is

Workflow state answers:

- what step is in progress
- what side effects already happened
- what can be retried safely
- what the system is waiting on

A chat transcript is not a durable workflow engine.

## When Durability Is Required

Reach for stronger durability when the system must:

- wait for human approval
- survive page reloads or disconnects
- resume after process failure
- retry external calls
- prevent duplicate writes
- coordinate delayed or multi-step work

If none of those are true, keep the design simpler.

## Core Durability Primitives

For durable work, define:

- workflow states
- checkpoint writes after meaningful side effects
- idempotency or dedupe keys
- retry policy
- terminal states
- operator-visible status

Common states:

- planned
- awaiting_approval
- executing
- waiting_on_external
- retry_scheduled
- completed
- failed
- compensated

## Approval And Waiting States

Treat approval and waiting as first-class states, not edge cases.

The system should know:

- what it is waiting for
- what event resumes the workflow
- who can approve it
- what expires or times out
- what is safe to retry while waiting

## Failure Modes

Plan for these early:

- duplicate execution after retry
- state writes that lag behind side effects
- approval granted for a stale plan
- workflow resumes with outdated context
- silent timeout with no user or operator visibility

## How To Evaluate This Layer

Verify that the harness can answer:

- what survives a crash
- what survives a reload
- how duplicate side effects are prevented
- how a waiting workflow is resumed
- how operators see stuck work
- what user-facing message appears during waiting or retry

Run at least these tests:

- crash between side effect and completion
- retry after transient failure
- denied approval
- resumed workflow after delay
- duplicate event delivery
