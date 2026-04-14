---
name: weekly-signal-diff
description: |
  Use when the user wants a weekly structural diff on AI, software, or another
  fast-moving market. Starts from 10 suggested categories and 30 suggested
  companies when no watchlist exists, then adapts the scan using Open Brain
  memory, current priorities, and prior digests. Best for prompts like "run my
  weekly signal diff", "what changed this week that matters to me", "track this
  market", or "turn this week's news into structural shifts". Optional live
  search upgrade: if OpenRouter access is available, prefer the Perplexity
  Sonar family for fresh web-grounded retrieval with citations.
author: Jonathan Edwards
version: 1.0.0
---

# Weekly Signal Diff

## Problem

A wall of news does not tell the user what structurally changed. Most weekly
roundups over-index on headlines, underweight economics and dependency shifts,
and ignore what the user actually cares about. This skill turns a noisy week
into a small set of structural changes, weighted by Open Brain memory.

## When to Use

- Weekly market review or Sunday/Friday ritual
- "Run my weekly signal diff"
- "What changed this week that matters to me?"
- "Track this market and tell me the structural shifts"
- "Turn this pile of news into a decision-grade diff"
- Ongoing automation that writes a weekly digest back to Open Brain

## Required Context

Gather as much as the environment allows:

- the user's active projects, bets, and recurring interests
- prior weekly digests or adjacent summaries stored in Open Brain
- the desired freshness window (default: last 7 days)
- any preferred outlets, banned sources, or explicit watchlist entities

If the user has not provided categories or companies, read
[references/starter-universe.md](references/starter-universe.md) and use it as
a bootstrap layer only.

If live web access is available and the user wants current coverage, read
[references/live-search-upgrade.md](references/live-search-upgrade.md) and use
the strongest search mode the environment supports.

## Process

1. Establish the frame.
   - Confirm the topic space, freshness window, and whether the goal is
     personal awareness, operator strategy, investor tracking, or content prep.
   - If the user says nothing, default to a 7-day operator-style review.

1. Pull Open Brain context first.
   - Search for active projects, current priorities, recurring entities, recent
     captures, and the last 2-4 weekly digests.
   - Tool names vary by client. Use the available Open Brain search, list, and
     capture tools in the environment rather than assuming fixed names.
   - Extract a short relevance profile: what the user is building, what they
     keep revisiting, what they are worried about, and what they are trying to
     learn.

1. Build the watchlist.
   - Start from the suggested 10-category / 30-company starter universe if the
     user has not defined a watchlist.
   - Treat the starter list as a scaffold, not a contract.
   - Re-rank or replace items using Open Brain context:
     - promote companies, categories, or themes the user mentions often
     - demote low-signal items
     - add personal-priority entities even if they are outside the starter set
   - Preserve some baseline discovery. Personalization should shape the scan,
     not collapse it into only known favorites.

1. Gather the week's evidence.
   - Prefer fresh, source-backed information with links or citations.
   - If live search is available, perform a broad sweep first, then targeted
     follow-ups on the top candidate shifts.
   - If live search is not available, work from the user's provided sources and
     say that the diff is source-bounded.
   - Ignore pure announcement theater unless it changes economics,
     distribution, regulation, dependency, geography, or buyer behavior.

1. Ask the structural questions on every candidate signal.
   - What constraint shifted?
   - Who gained or lost leverage?
   - What got cheaper, harder, faster, or more defensible?
   - What dependency got exposed?
   - What business model or pricing assumption weakened?
   - What changed in regulation, geography, or distribution?
   - Why does this matter for the user's actual projects, workflows, or market
     view?

1. Score before writing.
   - Keep only the few signals that represent real change.
   - A good weekly diff usually has 3-7 structural shifts.
   - Merge duplicates, drop weak stories, and explicitly label speculation as
     speculation.

1. Produce the weekly diff.

Use this default structure:

- `Coverage note` — what was scanned, how it was personalized, and the date
  window
- `Structural shifts` — 3-7 items, each with:
  - what changed
  - why it matters in general
  - why it matters to this user
  - supporting evidence or citations
- `What changed from last week` — new, rising, fading, or resolved themes
- `Watch next` — entities, constraints, or questions to monitor
- `Actions` — optional follow-ups, only if the evidence supports them

1. Capture the durable output.
   - Save the final digest back into Open Brain when capture tools are
     available.
   - Prefer one durable weekly summary plus separate captures only for truly
     important follow-up items.
   - Include provenance: week ending date, topic scope, and major entities
     covered.

## Output

When this skill works correctly, the user gets:

- a concise weekly structural diff instead of a headline roundup
- a clear explanation of why the shifts matter to them specifically
- citations or source links when live search is available
- a durable weekly digest saved back into Open Brain for future comparison

## Guardrails

- The goal is `diff, not digest`.
- Do not force all 30 suggested companies into the final output. They are there
  to prevent blank-page syndrome, not to create fake coverage.
- Do not mistake product launches, benchmark screenshots, or funding headlines
  for structural change unless they move a real constraint.
- Keep general market analysis separate from personalized implications.
- If evidence is thin, say the week was thin.
- If the environment lacks live search, be explicit about the freshness
  limitation.
- If the user's interests are unclear, use the starter universe and explain
  that it is a bootstrap pass.

## Notes for Other Clients

- This skill is portable across Claude Code, Codex, Cursor, and similar clients
  because the core behavior is procedural.
- Adapt Open Brain tool names to the local environment.
- For scheduled runs, pair the skill with the user's automation system and keep
  the same structure every week so diffs stay comparable.
- If OpenRouter is available, prefer a Perplexity Sonar web-search model for
  the retrieval pass, then use the local AI client or model to do the actual
  synthesis if that split is more ergonomic.
