---
name: deal-memo-drafting
description: |
  Investor-first workflow for drafting a structured deal memo, IC memo, partnership
  memo, or acquisition-style brief from existing diligence materials. Use for prompts
  like "draft a deal memo", "turn this diligence packet into a memo", or "write the
  IC draft". Best when you already have research findings, model review notes, meeting
  outputs, and supporting documents. Optional Open Brain search and capture can pull
  prior context and store the final memo or recommendation summary.
author: Nate B. Jones
version: 1.0.0
---

# Deal Memo Drafting

## Problem

The hardest part of memo drafting is not prose. It is turning incomplete diligence,
competing evidence, and meeting fragments into a clean recommendation without hiding
the gaps.

## Audience

- Primary: investors and diligence teams
- Secondary: operators writing partnership, acquisition, or strategic decision memos

## When to Use

- Drafting an IC memo or deal memo from an existing diligence packet
- Turning research, model review, and meeting notes into a single recommendation document
- Producing a first-pass memo that makes open questions and decision risk explicit

## When Not to Use

- Raw market mapping without a memo deliverable: use `competitive-analysis`
- Reviewing a model in isolation: use `financial-model-review`
- Synthesizing a source set before the memo is ready to draft: use `research-synthesis`
- Cleaning a transcript or extracting actions: use `meeting-synthesis`

## Required Context

Gather or confirm:

- the memo type: deal, IC, partnership, acquisition, board, or internal decision memo
- the target audience and decision owner
- research findings, market context, and supporting docs
- model review findings if economics matter
- meeting outputs if decision-makers or management conversations matter
- the current state of conviction and the biggest open questions

## Process

1. Frame the memo.
   - State the decision the memo supports.
   - State the audience and how formal the document should be.
2. Inventory the evidence.
   - Separate confirmed findings, inferences, and unresolved gaps.
3. Build the memo spine.
   - Thesis, market, business, economics, risks, open questions, recommendation.
4. Draft with explicit honesty.
   - If a section is weak because the diligence is weak, say so.
   - Do not quietly fill missing evidence with confident prose.
5. Tighten for decision-readiness.
   - End with what the decision-maker should do, why, and what still needs verification.
6. Optionally use Open Brain.
   - Search for prior deal notes, past meetings, or earlier thesis fragments.
   - Capture the final memo summary or recommendation after the draft is complete.

## Evidence and Judgment Rules

- Use the best available evidence from research, model review, and meetings.
- Always distinguish known facts from inference and unresolved gaps.
- Never overstate conviction just to make the memo feel complete.
- If economics are weak or unclear, say the memo should not lean on them heavily.
- Preserve contradictory evidence where it materially changes the recommendation.

## Output

Default output:

- thesis or recommendation summary
- market and business summary
- economics or model implications when relevant
- key risks and open questions
- recommendation with explicit confidence and next-step requirements

## Works Well With

- `competitive-analysis` for market and positioning sections
- `financial-model-review` for economics and downside framing
- `research-synthesis` for source-backed findings and contradictions
- `meeting-synthesis` for management, partner, or internal decision input

## Notes

- This skill drafts from diligence. It should not pretend to replace diligence.
- A good memo is allowed to say "not ready", "needs more proof", or "do not proceed yet".
