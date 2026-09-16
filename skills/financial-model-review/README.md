# Financial Model Review

> Standalone skill pack for reviewing an existing financial model, forecast, or scenario set before using it in a decision.

## What It Does

This skill helps an AI client review a model like an investor or serious operator would. It checks whether assumptions are supported, whether the structure can be trusted, whether downside cases exist, and whether the model is actually decision-ready instead of merely well-formatted.

For the full OB1 workflow that chains this into research synthesis, meeting notes, and memo drafting, use the [Research-to-Decision Workflow recipe](../../recipes/research-to-decision-workflow/).

## Supported Clients

- Claude Code
- Codex
- Cursor
- Other AI clients that support reusable prompt packs, rules, or custom instructions

## Prerequisites

- Working Open Brain setup if you want the skill to use memory search or capture ([guide](../../docs/01-getting-started.md))
- AI client that supports reusable skills, rules, or custom instructions
- A model artifact, spreadsheet export, or pasted assumption set

## Installation

1. Copy [`SKILL.md`](./SKILL.md) into the reusable-instructions location for your AI client.
2. Restart or reload the client so it picks up the skill.
3. Test it with a prompt like: `Review this forecast and tell me which assumptions are fragile.`

For Claude Code, a common install path is:

```bash
mkdir -p ~/.claude/skills/financial-model-review
cp skills/financial-model-review/SKILL.md ~/.claude/skills/financial-model-review/SKILL.md
```

## Trigger Conditions

- "Review this model"
- "Audit these assumptions"
- "Tell me what breaks in this forecast"
- "Stress test this revenue plan"
- "Is this model decision-ready?"

## Expected Outcome

When installed and invoked correctly, the skill should produce:

- a review memo with an overall verdict
- clear red flags and assumption stress points
- structural and scenario gaps
- guidance on what the model is good enough for right now
- optional Open Brain capture of the final review or highest-signal findings

## Troubleshooting

**Issue: The output critiques the business but not the model**
Solution: Include the model artifact or a clear export of assumptions and outputs. This skill needs something concrete to review.

**Issue: The review sounds overly certain**
Solution: Preserve the skill's rule that hidden formulas and invisible mechanics should stay labeled as unknown. The review should be honest about what it can and cannot verify.

**Issue: The model gets treated like a build request**
Solution: Keep the boundary intact. This skill reviews existing work. If the user wants a fresh model, that should be a separate workflow.

## Notes for Other Clients

Adapt the Open Brain tool names to your environment, but keep the same review posture: frame the decision, inspect assumptions and structure, pressure-test scenarios, and finish with a usable verdict rather than a vague spreadsheet commentary.
