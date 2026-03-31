# Research-to-Decision Workflow Template

Use this file as the working scaffold for either the operator path or the investor path.

## Recommended Workspace Structure

```text
docs/research-to-decision/
├── 00-brief.md
├── 01-competitive-analysis.md
├── 02-financial-model-review.md
├── 03-research-synthesis.md
├── 04-meeting-synthesis.md
├── 05-deal-memo.md
├── meetings/
│   └── raw-notes-or-transcripts.md
├── models/
│   └── model-export-or-assumptions.md
└── sources/
    └── source-packet.md
```

Use only the files you need. For the operator path, `02-financial-model-review.md` and `05-deal-memo.md` are often unnecessary.

## 00-brief.md

```markdown
# Decision Brief

## Decision
- What decision are we trying to support?

## Audience
- Operator / investor / partnership / board / internal team

## Path
- Operator path / investor path

## Inputs
- Sources:
- Meetings:
- Model:

## Success Condition
- What should the final artifact make easier to decide?
```

## Handoff Checklist

| Step | Consumes | Produces | Ready When |
| --- | --- | --- | --- |
| Competitive Analysis | Product/company context, ICP, competitor set | `01-competitive-analysis.md` | Market and competitor picture is clear enough to inform later work |
| Financial Model Review | Model export or assumptions, business model, decision context | `02-financial-model-review.md` | Key assumption risks and scenario gaps are explicit |
| Research Synthesis | Source packet plus any prior outputs that matter | `03-research-synthesis.md` | Findings, contradictions, confidence, and gaps are visible |
| Meeting Synthesis | Transcript or notes plus context | `04-meeting-synthesis.md` | Decisions, actions, and unresolved questions are cleanly extracted |
| Deal Memo Drafting | Prior outputs plus target memo audience | `05-deal-memo.md` | Final recommendation memo is decision-ready |

## Operator Path

```text
00-brief.md
    ->
01-competitive-analysis.md
    ->
03-research-synthesis.md
    ->
04-meeting-synthesis.md
```

### Operator Path Prompt Stubs

```text
Use Competitive Analysis on the materials in 00-brief.md and sources/ to produce 01-competitive-analysis.md.
```

```text
Use Research Synthesis on 01-competitive-analysis.md plus the source packet to produce 03-research-synthesis.md.
```

```text
Use Meeting Synthesis on meetings/raw-notes-or-transcripts.md plus 03-research-synthesis.md to produce 04-meeting-synthesis.md.
```

## Investor Path

```text
00-brief.md
    ->
01-competitive-analysis.md
    ->
02-financial-model-review.md
    ->
03-research-synthesis.md
    ->
04-meeting-synthesis.md
    ->
05-deal-memo.md
```

### Investor Path Prompt Stubs

```text
Use Competitive Analysis on the materials in 00-brief.md and sources/ to produce 01-competitive-analysis.md.
```

```text
Use Financial Model Review on models/model-export-or-assumptions.md plus 00-brief.md to produce 02-financial-model-review.md.
```

```text
Use Research Synthesis on the source packet plus 01-competitive-analysis.md and 02-financial-model-review.md to produce 03-research-synthesis.md.
```

```text
Use Meeting Synthesis on meetings/raw-notes-or-transcripts.md plus 03-research-synthesis.md to produce 04-meeting-synthesis.md.
```

```text
Use Deal Memo Drafting on 01-competitive-analysis.md, 02-financial-model-review.md, 03-research-synthesis.md, and 04-meeting-synthesis.md to produce 05-deal-memo.md.
```

## Skip Rules

- Skip the model review step if there is no meaningful model artifact.
- Skip the meeting synthesis step if no call, interview, or meeting is informing the decision.
- Skip the deal memo step if the final artifact is a strategic brief, not a memo.

## Optional Open Brain Capture Moments

- Capture the strongest competitive brief after `01-competitive-analysis.md`
- Capture durable findings after `03-research-synthesis.md`
- Capture key decisions after `04-meeting-synthesis.md`
- Capture the final recommendation after `05-deal-memo.md`
