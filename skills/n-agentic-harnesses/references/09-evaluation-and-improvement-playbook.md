# Evaluation And Improvement Playbook

## Table Of Contents

- What this file is for
- How to evaluate a harness
- Evaluation dimensions
- Findings format
- Prioritization rules
- Upgrade sequencing
- Acceptance checks after changes

## What This File Is For

Read this when the user already has a harness and wants to understand what is weak, missing, risky, confusing, or worth upgrading.

## How To Evaluate A Harness

Gather evidence first.

Look for:

- architecture docs or code structure
- capability and permission surfaces
- workflow state handling
- context and memory behavior
- user-visible status patterns
- logs, health views, or analytics
- existing evaluation coverage

Do not judge the harness only by prompt quality.

## Evaluation Dimensions

Evaluate along these dimensions:

### Architecture

- Is the harness shape clear?
- Are subsystem boundaries explicit?
- Is there a single source of truth for capabilities and policy?

### Safety And Permissions

- Are risky actions gated?
- Is there an audit trail?
- Can dangerous behavior happen silently?

### State And Durability

- Can the system resume or retry safely?
- Is conversation state being mistaken for workflow state?
- Are duplicate side effects possible?

### Context, Memory, And Evals

- Is context assembled intentionally?
- Is memory scoped and trustworthy?
- Are regressions tested before users discover them?

### UX And Operations

- Can users see what is happening?
- Can operators diagnose failures?
- Is cost visible enough to control?

## Findings Format

Present findings first.

For each finding, include:

- severity or leverage
- what is missing or weak
- why it matters
- likely user or operator impact
- recommended fix direction

After findings, summarize strengths briefly.

## Prioritization Rules

Prioritize in this order:

1. silent risk or safety gaps
2. durability and duplicate-write risks
3. missing evaluation coverage
4. severe UX trust failures
5. maintainability and extensibility cleanup

Favor fixes that improve both user experience and operator control.

## Upgrade Sequencing

Most retrofit paths should look like this:

1. stabilize capability and permission boundaries
2. make state and resumability explicit
3. add or repair evaluation coverage
4. improve UX and observability
5. add extensibility only if still needed

Do not recommend a full rewrite when a subsystem correction will do.

## Acceptance Checks After Changes

After major improvements, verify:

- risky operations are gated and logged
- retries do not double-write
- waiting or blocked states are visible
- core tasks pass representative evals
- operators can explain recent failures quickly
- the harness is simpler or clearer than before, not just more powerful
