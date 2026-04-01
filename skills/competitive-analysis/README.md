# Competitive Analysis

> Standalone skill pack for competitor profiling, pricing comparison, market mapping, and strategic recommendations.

## What It Does

This skill turns a loose "analyze the competition" request into a structured competitive brief. It helps an AI client identify the relevant competitor set, compare positioning and packaging, call out real threats and openings, and end with recommended moves instead of a generic market summary.

If you want the multi-step OB1 workflow that combines this with synthesis, meeting notes, and memo drafting, use the [Research-to-Decision Workflow recipe](../../recipes/research-to-decision-workflow/).

## Supported Clients

- Claude Code
- Codex
- Cursor
- Other AI clients that support reusable prompt packs, rules, or custom instructions

## Prerequisites

- Working Open Brain setup if you want the skill to use memory search or capture ([guide](../../docs/01-getting-started.md))
- AI client that supports reusable skills, rules, or custom instructions
- Public source access for competitor websites, pricing pages, docs, and announcements

## Installation

1. Copy [`SKILL.md`](./SKILL.md) into the reusable-instructions location for your AI client.
2. Restart or reload the client so it picks up the skill.
3. Test it with a prompt like: `Analyze our top 3 competitors and tell me where our pricing looks weak.`

For Claude Code, a common install path is:

```bash
mkdir -p ~/.claude/skills/competitive-analysis
cp skills/competitive-analysis/SKILL.md ~/.claude/skills/competitive-analysis/SKILL.md
```

## Trigger Conditions

- "Analyze our competitors"
- "Benchmark our pricing"
- "Map the market"
- "Who are we up against?"
- "Build a SWOT"
- "Show me how we stack up against X, Y, and Z"

## Expected Outcome

When installed and invoked correctly, the skill should produce:

- a clearly scoped competitor set
- a comparison table across the dimensions that matter for the decision
- a positioning or market-map view
- explicit risks, opportunities, and recommended moves
- optional Open Brain capture of the final brief or highest-value takeaways

## Troubleshooting

**Issue: The output reads like a generic market summary**
Solution: Make sure the prompt includes the decision the work should support. This skill is strongest when it knows whether the goal is pricing, positioning, roadmap, or diligence.

**Issue: The skill invents pricing or feature parity**
Solution: Keep the evidence rules intact. Pricing and packaging should only be compared when there is public support for the claim. Unknowns should stay unknown.

**Issue: The competitor set is too broad to be useful**
Solution: Tighten the ICP or segment focus. "Accounting software" is too broad; "crypto accounting software for SMBs" is usable.

## Notes for Other Clients

This skill is portable because the core behavior is procedural, not tool-specific. Adapt the Open Brain tool names to whatever your client exposes, but preserve the same flow: frame the decision, compare the right dimensions, label inference, and finish with real strategic implications.
