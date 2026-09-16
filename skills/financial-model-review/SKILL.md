---
name: financial-model-review
description: |
  Investor-first workflow for reviewing an existing financial model, forecast, or
  sensitivity analysis. Use for prompts like "review this model", "stress test these
  assumptions", "what breaks in this forecast", or "is this model decision-ready".
  Best when you have a spreadsheet export, pasted assumptions, key drivers, and the
  decision the model supports. Optional Open Brain search and capture can pull prior
  model context and store the final review memo.
author: Nate B. Jones
version: 1.0.0
---

# Financial Model Review

## Problem

A model can look polished and still be dangerous. This skill reviews whether the
assumptions, structure, scenarios, and logic are strong enough to support a real
decision.

## Audience

- Primary: investors, diligence teams, and finance-heavy reviewers
- Secondary: operators reviewing planning or fundraising models

## When to Use

- Reviewing a startup, deal, or operating model before using it in a memo or decision
- Stress testing growth, margin, burn, or pricing assumptions
- Looking for missing scenarios, broken logic, or false precision
- Translating a spreadsheet into a model review memo with clear verdicts

## When Not to Use

- Building a model from scratch
- Market or competitor research without a model artifact
- Drafting the final memo when the model review is only one input: use `deal-memo-drafting`
- Synthesizing many mixed source documents: use `research-synthesis`

## Required Context

Gather or confirm:

- the model itself, or a faithful export of its assumptions and outputs
- what decision the model supports
- the business model and revenue engine
- the main value drivers or operating levers
- the time horizon
- whether the user wants an investor or operator framing

Useful but optional:

- prior versions, management guidance, or historical notes from Open Brain

## Process

1. Frame the review.
   - State the decision the model is being used for.
   - State whether the standard is investor-grade, board-grade, or internal planning.
2. Identify the model shape.
   - Revenue model, cost structure, cash runway, valuation, scenario design, and outputs.
3. Review assumptions.
   - Look for unsupported growth, margin leaps, pricing optimism, CAC efficiency, churn stability, and timing shortcuts.
4. Review structure and logic.
   - Flag missing drivers, circular reasoning, hidden hard-codes, inconsistent periods, or unsupported roll-forwards.
5. Review scenarios.
   - Check whether the model includes downside cases, key sensitivities, and break conditions.
6. Convert the review into judgment.
   - Distinguish fatal issues, caution flags, and acceptable simplifications.
7. Optionally use Open Brain.
   - Search for prior model assumptions, earlier reviews, or management claims.
   - Capture the final review memo or most important flags after completion.

## Evidence and Judgment Rules

- Prefer model evidence, historicals, source data, and management guidance over opinion.
- Do not pretend to verify formulas you cannot see. Say what is visible and what is not.
- Label unsupported assumptions as unsupported, not wrong by default.
- Call out where a model is useful for direction but not defensible for high-stakes precision.
- Always note missing scenarios if the downside case is absent or weak.
- Separate structural risk from business risk.

## Output

Default output:

- review objective and overall verdict
- key assumptions under pressure
- structural and scenario red flags
- what the model is good enough for
- what must change before the model supports a stronger decision

## Works Well With

- `competitive-analysis` when market benchmarks should inform assumption realism
- `research-synthesis` when the review needs source-backed contradiction handling
- `deal-memo-drafting` when the final deliverable needs an economics or risk section

## Notes

- This skill reviews what exists. It should not quietly turn into model building.
- The best outcome is a more decision-useful model, not a longer spreadsheet critique.
