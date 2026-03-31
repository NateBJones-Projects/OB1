# Deal Memo Drafting

> Standalone skill pack for turning existing diligence materials into a structured deal, IC, partnership, or acquisition memo.

## What It Does

This skill helps an AI client draft a real decision memo from work that already exists. It takes market findings, model review output, meeting synthesis, and supporting documents, then shapes them into a recommendation-ready memo while keeping evidence gaps and confidence levels explicit.

For the OB1 composition workflow that feeds this skill from earlier analysis steps, use the [Research-to-Decision Workflow recipe](../../recipes/research-to-decision-workflow/).

## Supported Clients

- Claude Code
- Codex
- Cursor
- Other AI clients that support reusable prompt packs, rules, or custom instructions

## Prerequisites

- Working Open Brain setup if you want the skill to use memory search or capture ([guide](../../docs/01-getting-started.md))
- AI client that supports reusable skills, rules, or custom instructions
- A real diligence packet, not just a company name and a blank page

## Installation

1. Copy [`SKILL.md`](./SKILL.md) into the reusable-instructions location for your AI client.
2. Restart or reload the client so it picks up the skill.
3. Test it with a prompt like: `Draft an IC memo from this research summary, model review, and meeting notes.`

For Claude Code, a common install path is:

```bash
mkdir -p ~/.claude/skills/deal-memo-drafting
cp skills/deal-memo-drafting/SKILL.md ~/.claude/skills/deal-memo-drafting/SKILL.md
```

## Trigger Conditions

- "Draft a deal memo"
- "Write the IC memo"
- "Turn this diligence packet into a memo"
- "Draft the partnership recommendation"
- "Write the acquisition brief"

## Expected Outcome

When installed and invoked correctly, the skill should produce:

- a structured memo with thesis, market, business, economics, risks, and recommendation
- explicit open questions instead of hidden assumptions
- confidence signaling that matches the evidence quality
- optional Open Brain capture of the final memo summary or recommendation

## Troubleshooting

**Issue: The memo sounds polished but thin**
Solution: Provide the actual underlying diligence materials. This skill is strongest when it has research, model review, and meeting outputs to work from.

**Issue: The draft hides uncertainty**
Solution: Preserve the rule that evidence gaps stay visible. The memo should never become more certain than the diligence allows.

**Issue: The skill gets used too early**
Solution: If the source set is still messy or contradictory, run `research-synthesis` first. If the economics are still unreviewed, run `financial-model-review` first.

## Notes for Other Clients

Keep the core behavior intact even if your client uses different tool names. The skill should draft from diligence, separate fact from inference, and finish with a recommendation that reflects the evidence instead of smoothing over it.
