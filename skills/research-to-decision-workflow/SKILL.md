---
name: research-to-decision-workflow
description: |
  Triggerable orchestrator that runs the full research-to-decision pipeline
  end to end. Use for prompts like "take this from research to a decision",
  "run the research-to-decision workflow", "build me a decision brief from
  these materials", or "turn this diligence packet into a memo". It scaffolds
  the workspace, picks the operator or investor path, chains the five canonical
  skills with enforced handoffs, and captures durable outputs to Open Brain.
  Use this only for a multi-step run — for a single step, call that one skill
  directly.
author: Ezana Azene
version: 1.0.0
---

# Research-to-Decision Workflow

## Problem

The research-to-decision recipe describes a five-skill pipeline but nothing
executes it. Users who want to go from raw materials to a decision artifact must
invoke each skill by hand and manage the handoffs themselves. This skill runs
the pipeline as one orchestrated workflow.

## Audience

- Primary: operators and investors making a multi-input decision that needs two
  or more of the canonical skills chained together.

## When to Use

- A decision needs more than one canonical step (e.g. competitive work *and*
  synthesis *and* meeting outputs).
- The end goal is a reusable artifact: a strategy brief (operator path) or a
  recommendation memo (investor path).
- You want the workspace, handoffs, and capture points handled for you.

## When Not to Use

- You only need one step. Route directly to the single canonical skill:
  - Market/competitor mapping only → `competitive-analysis`
  - Source synthesis only → `research-synthesis`
  - Transcript/action extraction only → `meeting-synthesis`
  - Model assumption review only → `financial-model-review`
  - Memo drafting when synthesis already exists → `deal-memo-drafting`
- There is no real decision to support yet (define the decision first).

## Required Context

Gather or confirm before running:

- the decision the workflow must support
- the primary audience (operator / investor / partnership / board / internal)
- the path (operator or investor), or enough to infer it
- where the source materials, meetings, and any model live

## Process

1. **Write the decision brief.** Create `docs/research-to-decision/00-brief.md`
   with: decision, audience, path, inputs, success condition. **Gate: do not
   proceed until the decision is explicitly defined.** Use the bundled
   `workflow-template.md` for the brief and file structure.
2. **Scaffold the workspace.**
   ```bash
   mkdir -p docs/research-to-decision/sources \
            docs/research-to-decision/meetings \
            docs/research-to-decision/models
   ```
3. **Optionally search Open Brain** for prior related context and note anything
   that changes the brief.
4. **Select the path** from the brief:
   - Operator: `00 -> 01-competitive-analysis -> 03-research-synthesis -> 04-meeting-synthesis`
   - Investor: `00 -> 01-competitive-analysis -> 02-financial-model-review -> 03-research-synthesis -> 04-meeting-synthesis -> 05-deal-memo`
5. **Run each step in path order by invoking its canonical skill**, and write its
   handoff file before starting the next step. Do not reconstruct context in the
   next step — read the prior file:
   - `competitive-analysis` → `01-competitive-analysis.md`
   - `financial-model-review` → `02-financial-model-review.md` (investor only)
   - `research-synthesis` → `03-research-synthesis.md`
   - `meeting-synthesis` → `04-meeting-synthesis.md`
   - `deal-memo-drafting` → `05-deal-memo.md` (investor only)
6. **Apply skip rules.** Skip `financial-model-review` if there is no meaningful
   model. Skip `meeting-synthesis` if no call/interview/review feeds the
   decision. Skip `deal-memo-drafting` if the deliverable is a brief, not a memo.
7. **Capture durable outputs to Open Brain** at the checkpoints below. Do not
   capture raw packet noise just because it passed through the workflow.

## Handoff Enforcement

Each step consumes the prior artifact(s) and produces exactly one file. A step is
ready only when its file makes the next step runnable without re-deriving
context. Never start a downstream skill before its upstream handoff file exists.

## Capture Checkpoints

- after a strong competitive brief (`01`)
- after research synthesis identifies durable findings (`03`)
- after meeting synthesis produces real decisions (`04`)
- after the final memo or recommendation (`05`)

## Output

- a populated `docs/research-to-decision/` workspace
- the path's ordered handoff files (`00`–`04` operator, `00`–`05` investor)
- a final operator brief or investor memo built from explicit handoffs
- optional Open Brain captures at the four checkpoints

## Works Well With

- The five canonical skills it orchestrates:
  `competitive-analysis`, `financial-model-review`, `research-synthesis`,
  `meeting-synthesis`, `deal-memo-drafting`.
- The [Research-to-Decision Workflow recipe](../../recipes/research-to-decision-workflow/)
  — the fuller build this skill makes triggerable.

## Notes

- This skill holds no analytical logic. The five canonical skills are the source
  of truth for behavior; this skill only sequences them, enforces handoffs, and
  manages capture.
- The bundled `workflow-template.md` is a snapshot. The canonical copy lives in
  the recipe folder; if the recipe template changes, refresh the snapshot.
- Use the skip rules aggressively. A small decision should not run all five steps.
