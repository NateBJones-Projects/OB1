# Context, Memory, And Evaluation

## Table Of Contents

- What this file is for
- Context budget discipline
- Provenance-aware retrieval
- Memory rules
- Evaluation system
- What to measure
- How to evaluate this layer

## What This File Is For

Read this when the harness depends on context assembly, retrieval, memory, prompt compaction, or any form of evaluation beyond manual spot checks.

## Context Budget Discipline

Treat context as a scarce resource.

Plan for:

- what must be present before the first model call
- what can be retrieved on demand
- what should be summarized or compacted
- what should never be injected blindly

Prefer:

- smaller, relevant context sets
- explicit context categories
- predictable token budgets

## Provenance-Aware Retrieval

Every retrieved fragment should carry enough metadata to answer:

- where it came from
- when it was created
- how trustworthy it is
- whether it is instruction or evidence
- whether something newer conflicts with it

Treat context assembly as a trust problem, not just a ranking problem.

## Memory Rules

Split memory by type:

- session memory for current-task facts
- persistent memory for durable preferences or project knowledge
- operator policy for rules that should not be casually overwritten
- model-inferred notes for low-trust hints

Do not elevate model-inferred notes into high-trust memory without validation.

Persistent memory should have:

- provenance
- last-validated time
- scope
- conflict handling
- expiry or review expectations

## Evaluation System

Do not treat evaluation as a nice-to-have.

Create a lean evaluation system that covers:

- golden tasks
- representative user tasks
- adversarial or risky tasks
- failure recovery tasks
- permission boundary checks

Separate:

- transcript or trace replays
- synthetic scenario tests
- sampled human review

## What To Measure

Measure enough to detect regressions early:

- success rate on core tasks
- failure modes by category
- stop reasons
- approval frequency
- retry frequency
- tool misuse or denial rates
- token and cost trends
- user-visible latency or wait time

## How To Evaluate This Layer

Ask:

- is the model seeing the right information, or just a lot of information?
- can stale summaries poison the system?
- can memory contradict newer facts?
- do prompt or tool changes regress core tasks?
- are risky behaviors covered by invariant tests?

Useful invariant tests:

- dangerous actions require approval
- denied tools never run
- structured outputs validate
- budget exhaustion yields a graceful stop
- stale context does not silently override fresher evidence
