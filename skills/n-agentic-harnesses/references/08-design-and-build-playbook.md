# Design And Build Playbook

## Table Of Contents

- What this file is for
- Step 1: define the job
- Step 2: choose the harness shape
- Step 3: define capabilities and permissions
- Step 4: define state and lifecycle
- Step 5: define context and memory
- Step 6: define UX and observability
- Step 7: define evaluation before implementation
- Step 8: phase the implementation
- Deliverable format

## What This File Is For

Read this when the user wants a build-ready plan for a new harness or a major rebuild.

## Step 1: Define The Job

State clearly:

- who the harness serves
- what job it owns
- what actions it may take
- what must never happen

If the job is vague, do not jump to architecture yet.

## Step 2: Choose The Harness Shape

Pick the closest system shape:

- chat assistant
- workflow orchestrator
- code agent
- embedded product feature
- hybrid

State why that shape fits the job better than the nearest alternative.

## Step 3: Define Capabilities And Permissions

List the minimum useful capability set.

For each capability, define:

- what it does
- whether it reads or writes
- who can invoke it
- whether it requires approval
- what audit evidence should exist

Avoid “we will just give the agent all tools.”

## Step 4: Define State And Lifecycle

Define:

- request entrypoint
- preflight checks
- first model call inputs
- state writes
- side-effect boundaries
- wait and resume conditions
- completion and failure paths

If the system includes retries or approvals, specify the workflow states explicitly.

## Step 5: Define Context And Memory

Specify:

- what context is mandatory on turn one
- what is retrieved later
- what becomes persistent memory
- how provenance is tracked
- how stale context is prevented from dominating

Default to less memory, not more.

## Step 6: Define UX And Observability

Decide:

- what the user sees while work is running
- how approvals are shown
- what stop reasons exist
- what logs or health surfaces operators get
- what cost signals matter

Good harnesses feel explainable.

## Step 7: Define Evaluation Before Implementation

Before calling the design complete, define:

- golden tasks
- risky tasks
- failure recovery tests
- permission boundary tests
- acceptance criteria for user experience

Every design plan should end with “how we will know this works.”

## Step 8: Phase The Implementation

Break the build into practical phases:

### Phase 1

Ship the minimum safe harness:

- entrypoint
- orchestrator
- capability registry
- permission layer
- basic state handling
- minimal evaluation suite

### Phase 2

Add durability, richer UX, and stronger observability only where the product needs them.

### Phase 3

Add extensibility or multi-agent behavior only after the core harness is stable and measurable.

## Deliverable Format

When using this playbook, produce:

- recommended architecture
- subsystem list
- MVP boundary
- phase plan
- key risks
- evaluation plan
- acceptance criteria
