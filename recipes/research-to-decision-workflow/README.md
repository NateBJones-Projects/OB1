# Research-to-Decision Workflow

> Composition recipe for chaining canonical OB1 skills into operator and investor decision workflows.

## What It Does

This recipe shows how to use five reusable skill packs together without duplicating their prompt logic. The skills handle the canonical behavior; this recipe defines the install order, workspace structure, handoffs, skip rules, and two recommended paths from raw inputs to a reusable decision artifact.

The canonical reusable skills live here:

- [Competitive Analysis](../../skills/competitive-analysis/)
- [Financial Model Review](../../skills/financial-model-review/)
- [Deal Memo Drafting](../../skills/deal-memo-drafting/)
- [Research Synthesis](../../skills/research-synthesis/)
- [Meeting Synthesis](../../skills/meeting-synthesis/)

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Claude Code or another AI coding tool that supports reusable skills/system prompts
- The canonical [Competitive Analysis skill](../../skills/competitive-analysis/)
- The canonical [Financial Model Review skill](../../skills/financial-model-review/)
- The canonical [Deal Memo Drafting skill](../../skills/deal-memo-drafting/)
- The canonical [Research Synthesis skill](../../skills/research-synthesis/)
- The canonical [Meeting Synthesis skill](../../skills/meeting-synthesis/)
- Optional but useful: Open Brain search and capture tools so the workflow can pull prior context and store the highest-value outputs

## Credential Tracker

```text
RESEARCH-TO-DECISION WORKFLOW -- CREDENTIAL TRACKER
---------------------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:           ____________
  Secret key:            ____________
  OpenRouter API key:    ____________
  Search tool available: yes / no
  Capture tool available: yes / no

GENERATED DURING SETUP
  Workspace path:        ____________
  Default output folder: ____________

---------------------------------------------------
```

## Steps

### 1. Install the canonical skill dependencies

Install all five skill packs from `skills/` first. This recipe depends on them and does not duplicate their prompt behavior.

### 2. Create a working folder for the workflow

Create a single folder where the workflow can store sources and outputs:

```bash
mkdir -p docs/research-to-decision/sources
mkdir -p docs/research-to-decision/meetings
mkdir -p docs/research-to-decision/models
```

Then copy the helper template into your workspace or use it as a guide:

- [`workflow-template.md`](./workflow-template.md)

### 3. Start with the decision brief

Before using any skill, define:

- the decision you are trying to support
- the primary audience
- whether you are running the operator path or investor path
- where the source materials live

The helper template includes a short starter brief for this.

### 4. Choose the path

#### Operator path

Use this when the end goal is a strategic brief, GTM recommendation, partnership view, or internal decision support:

```text
competitive-analysis
    ->
research-synthesis
    ->
meeting-synthesis
```

Use this path when:

- you are comparing the market or a competitor set
- you have supporting source material that needs to be synthesized
- you want clean meeting outputs feeding a decision discussion

#### Investor path

Use this when the end goal is a memo, IC-style recommendation, or diligence package:

```text
competitive-analysis
    ->
financial-model-review
    ->
research-synthesis
    ->
meeting-synthesis
    ->
deal-memo-drafting
```

Use this path when:

- the economics matter to the decision
- you have an existing model or forecast that needs review
- meeting notes or calls should shape the recommendation
- the final deliverable is a memo, not just a synthesis

### 5. Respect the handoffs

Each step should produce a clean artifact for the next step instead of forcing the next skill to reconstruct context. The helper template defines a default structure, but the minimum handoffs are:

- `competitive-analysis` -> market and competitor brief
- `financial-model-review` -> model review memo with red flags and scenario notes
- `research-synthesis` -> source-backed synthesis with contradictions and confidence markers
- `meeting-synthesis` -> decision log, action list, open questions, and follow-up notes
- `deal-memo-drafting` -> final recommendation memo

### 6. Skip steps when the workflow is lighter

You do not need every step every time.

- Skip `financial-model-review` if there is no meaningful model artifact.
- Skip `meeting-synthesis` if there is no call, interview, or internal review feeding the decision.
- Skip `deal-memo-drafting` if the final deliverable is a strategy brief rather than a memo.

### 7. Capture only the durable outputs

Recommended Open Brain capture points:

- after a strong competitive brief is finished
- after research synthesis identifies durable findings
- after meeting synthesis produces real decisions
- after the final memo or recommendation is complete

Do not capture raw packet noise just because it passed through the workflow.

## Expected Outcome

When working correctly, this recipe should give you:

- a clean install and usage order for the five canonical skills
- a workspace layout that keeps intermediate outputs reusable
- one of two decision paths that are easy to follow and easy to skip around within
- a final operator brief or investor memo built from explicit handoffs instead of loose chat context

## Troubleshooting

**Issue: The recipe feels like it is repeating the skill instructions**
Solution: Keep the boundary clean. The skills are the source of truth for behavior. The recipe should only explain sequencing, handoffs, and workflow usage.

**Issue: The memo step feels weak even after running the workflow**
Solution: Check the handoffs. `deal-memo-drafting` needs actual research, model, and meeting outputs. If earlier artifacts are thin, the memo will be thin.

**Issue: The workflow feels too heavy for a small decision**
Solution: Use the skip rules. This recipe is modular on purpose. Run only the steps that materially improve the decision.
