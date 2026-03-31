---
name: competitive-analysis
description: |
  Operator-first competitive analysis workflow for competitor profiling, pricing and
  packaging comparisons, positioning maps, SWOTs, and strategic recommendations.
  Use for prompts like "analyze our competitors", "benchmark our pricing", "map the
  market", "who are we up against", or "build a SWOT". Best when you have a company
  or product, ideal customer profile, and competitor set or permission to discover
  it. Optional Open Brain search and capture can pull prior notes and store the
  final brief.
author: Nate B. Jones
version: 1.0.0
---

# Competitive Analysis

## Problem

Teams often ask for competitive analysis when they really need a decision-ready view
of the market: who matters, how they position, where pricing diverges, what gaps are
open, and which moves are worth making now.

## Audience

- Primary: operators, founders, and product or GTM teams
- Secondary: investors using market context before memo writing

## When to Use

- Competitor profiling before a pricing, roadmap, or positioning decision
- Pricing and packaging comparisons across a known competitor set
- Strategic planning sessions that need a SWOT or positioning map
- Market scans where the user wants clear risks, opportunities, and recommended moves

## When Not to Use

- Full financial model critique or forecast stress testing: use `financial-model-review`
- Source-heavy synthesis across many research artifacts: use `research-synthesis`
- Final investment or partnership memo drafting: use `deal-memo-drafting`
- Meeting transcript cleanup, action extraction, or follow-up drafting: use `meeting-synthesis`

## Required Context

Gather or confirm:

- the company, product, or offer being analyzed
- the target decision this analysis should support
- the intended audience: operator, investor, partnership, board, or internal team
- the ideal customer profile or segment focus
- the competitor set, or permission to discover it
- pricing context if pricing is part of the request

Useful but optional:

- prior positioning notes, customer objections, or recent competitive findings from Open Brain

## Process

1. Frame the assignment.
   - State the decision this analysis supports.
   - State the audience and how the output should be shaped for them.
2. Build the competitor set.
   - Use the named list if the user supplied one.
   - If not, identify the closest direct and adjacent competitors and label confidence.
3. Compare the right dimensions.
   - Always include positioning and target customer.
   - Include pricing and packaging only when public evidence exists.
   - Include product scope, distribution, signals of momentum, and likely threats where relevant.
4. Convert findings into judgment.
   - Distinguish facts, inferences, and open questions.
   - Call out where the market is crowded, under-served, or being misread.
5. Produce an operator-ready brief.
   - Summarize the market map, major competitors, and recommended moves.
6. Optionally use Open Brain.
   - Search for prior notes before repeating known findings.
   - Capture the finished brief or the highest-value strategic takeaways after the work is done.

## Evidence and Judgment Rules

- Prefer primary sources first: company websites, pricing pages, product docs, public announcements, job posts, filings.
- Treat review sites, analyst commentary, and media summaries as secondary evidence.
- Never invent pricing, customer counts, or roadmap direction.
- If a pricing page or feature comparison is unclear, say it is unclear.
- Label inference explicitly when strategy is being inferred from hiring, messaging, or packaging.
- Separate "what we know" from "what this likely means".

## Output

Default output:

- executive summary
- competitor set with role labels: direct, adjacent, emerging
- comparison table across the most relevant dimensions
- positioning map or simple market narrative
- SWOT-style implications or strategic risks
- 3 to 5 recommended moves tied to the stated decision

## Works Well With

- `research-synthesis` when the source set is large or contradictory
- `meeting-synthesis` after customer calls, partner calls, or internal strategy reviews
- `deal-memo-drafting` when the final deliverable is a decision memo

## Notes

- Keep the work operator-first unless the user clearly wants an investor framing.
- The goal is not exhaustive market trivia. The goal is a brief that changes a real decision.
