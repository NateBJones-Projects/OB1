---
name: research-synthesis
description: |
  Decision-grade workflow for synthesizing a source set into clear findings,
  contradictions, confidence markers, gaps, and next questions. Use for prompts
  like "synthesize these sources", "turn this research into a brief", "what are the
  key findings", or "where do these sources disagree". Best when you have a research
  question, a defined audience, and a set of source materials. Optional Open Brain
  search and capture can pull prior context and store the final synthesis.
author: Nate B. Jones
version: 1.0.0
---

# Research Synthesis

## Problem

Most research work fails at the synthesis step. Facts get repeated instead of
organized, contradictions disappear, and the final brief sounds cleaner than the
evidence really is.

## Audience

- Primary: both operators and investors

## When to Use

- Turning a defined source set into a clear, decision-grade brief
- Resolving or surfacing contradictions across sources
- Distilling a large research packet into findings, gaps, and next questions
- Preparing material for a memo, strategy discussion, or leadership review

## When Not to Use

- Competitive market mapping with light source work: use `competitive-analysis`
- Transcript cleanup, action extraction, or follow-up drafting: use `meeting-synthesis`
- Final memo drafting when the synthesis is already done: use `deal-memo-drafting`
- Model-specific assumption review: use `financial-model-review`

## Required Context

Gather or confirm:

- the research question
- the intended audience
- the full source set, or the highest-priority source subset
- the desired output type: summary, brief, recommendation support, or memo input
- any important constraints such as time window, source quality, or confidence threshold

## Process

1. Frame the synthesis.
   - Restate the question the synthesis must answer.
   - State the audience and what decision or discussion it supports.
2. Inventory the sources.
   - Identify source type, strength, freshness, and obvious overlap.
3. Extract the real findings.
   - Separate facts, themes, contradictions, and gaps.
4. Resolve or preserve disagreement.
   - If sources disagree, either reconcile with stronger evidence or document the conflict explicitly.
5. Mark confidence.
   - Note which findings are strongly supported and which are provisional.
6. End with decision usefulness.
   - State what the evidence supports now, what remains unclear, and what to research next.
7. Optionally use Open Brain.
   - Search for prior related notes before starting.
   - Capture the final synthesis or highest-value findings after completion.

## Evidence and Judgment Rules

- Prefer primary and directly attributable sources over summaries of summaries.
- Track freshness. An old source may still matter, but it should not masquerade as current.
- Never flatten contradiction into fake consensus.
- Label inference explicitly.
- If the source set is thin, say the synthesis is thin.
- Confidence should reflect evidence quality, not writing confidence.

## Output

Default output:

- research question and scope
- key findings
- contradictions or unresolved tensions
- confidence markers
- gaps and follow-up questions
- recommendation support or decision implications when appropriate

## Works Well With

- `competitive-analysis` when market and company findings need stronger synthesis
- `financial-model-review` when model outputs need source-backed context
- `meeting-synthesis` when calls or interviews become part of the evidence base
- `deal-memo-drafting` when the final deliverable is a recommendation memo

## Notes

- Synthesis is not compression for its own sake.
- The best synthesis usually makes the open questions sharper, not smaller.
