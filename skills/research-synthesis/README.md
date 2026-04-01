# Research Synthesis

> Standalone skill pack for turning a source set into a decision-grade brief with findings, contradictions, confidence, and next questions.

## What It Does

This skill helps an AI client synthesize research instead of merely summarize it. It organizes a source set into clear findings, preserves meaningful disagreement, marks confidence honestly, and ends with what the evidence supports now versus what still needs work.

For the OB1 workflow that chains this into competitive work, meeting outputs, and memo drafting, use the [Research-to-Decision Workflow recipe](../../recipes/research-to-decision-workflow/).

## Supported Clients

- Claude Code
- Codex
- Cursor
- Other AI clients that support reusable prompt packs, rules, or custom instructions

## Prerequisites

- Working Open Brain setup if you want the skill to use memory search or capture ([guide](../../docs/01-getting-started.md))
- AI client that supports reusable skills, rules, or custom instructions
- A real source set with a defined research question

## Installation

1. Copy [`SKILL.md`](./SKILL.md) into the reusable-instructions location for your AI client.
2. Restart or reload the client so it picks up the skill.
3. Test it with a prompt like: `Synthesize these ten sources into a brief and show where they disagree.`

For Claude Code, a common install path is:

```bash
mkdir -p ~/.claude/skills/research-synthesis
cp skills/research-synthesis/SKILL.md ~/.claude/skills/research-synthesis/SKILL.md
```

## Trigger Conditions

- "Synthesize these sources"
- "Turn this research into a brief"
- "What are the key findings?"
- "Where do these sources disagree?"
- "What can we actually conclude from this packet?"

## Expected Outcome

When installed and invoked correctly, the skill should produce:

- a clean synthesis tied to a defined question
- explicit contradictions instead of fake consensus
- honest confidence signaling
- gaps and next questions that matter to the decision
- optional Open Brain capture of the final synthesis or most important findings

## Troubleshooting

**Issue: The output is just a summary of each source**
Solution: Make sure the prompt includes a real synthesis question or decision context. This skill is built to answer a question, not restate documents in sequence.

**Issue: Contradictions disappear in the final brief**
Solution: Preserve the contradiction rules. If two sources diverge materially, the synthesis should either resolve the difference with stronger evidence or keep the disagreement visible.

**Issue: Confidence sounds inflated**
Solution: Keep the evidence hierarchy and thin-source rule intact. The brief should never sound more certain than the source set deserves.

## Notes for Other Clients

Adapt the Open Brain tool names as needed, but preserve the core behavior: frame the question, inventory the evidence, surface contradictions, mark confidence honestly, and finish with decision-relevant conclusions and gaps.
