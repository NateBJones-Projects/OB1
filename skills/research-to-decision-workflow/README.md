# Research-to-Decision Workflow

> Triggerable orchestrator skill that runs the research-to-decision pipeline end
> to end.

## What It Does

This skill makes the [Research-to-Decision Workflow recipe](../../recipes/research-to-decision-workflow/)
executable. It scaffolds the workspace, writes the decision brief, picks the
operator or investor path, chains the five canonical skills with enforced
handoffs, applies the skip rules, and captures durable outputs to Open Brain.

It holds no analytical logic of its own. The five canonical skills remain the
source of truth for behavior:

- [Competitive Analysis](../competitive-analysis/)
- [Financial Model Review](../financial-model-review/)
- [Research Synthesis](../research-synthesis/)
- [Meeting Synthesis](../meeting-synthesis/)
- [Deal Memo Drafting](../deal-memo-drafting/)

## When to Use

Use it for a multi-step run — a decision that needs two or more of the canonical
skills chained together. For a single step, call that one skill directly.

- Operator path → strategy/GTM brief: `competitive-analysis → research-synthesis → meeting-synthesis`
- Investor path → recommendation memo: adds `financial-model-review` and `deal-memo-drafting`

## Files

- `SKILL.md` — the orchestration protocol (triggering, path selection, handoffs, capture).
- `workflow-template.md` — bundled snapshot of the recipe's workspace template.
  The **canonical copy lives in the recipe folder**; this snapshot keeps the
  skill self-contained. If the recipe template changes, refresh this snapshot.
- `metadata.json` — contribution metadata.

## Prerequisites

- A working Open Brain setup (optional search/capture during the run).
- The five canonical skills installed (see `requires_skills` in `metadata.json`).

## Expected Outcome

A populated `docs/research-to-decision/` workspace with ordered handoff files and
a final operator brief or investor memo, built from explicit handoffs rather than
loose chat context.
