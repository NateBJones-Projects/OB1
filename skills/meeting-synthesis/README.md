# Meeting Synthesis

> Standalone skill pack for turning meeting transcripts or notes into decisions, action items, risks, unresolved questions, and follow-up artifacts.

## What It Does

This skill helps an AI client convert raw meeting material into a durable working document. It separates decisions from discussion, action items from loose ideas, and unresolved questions from false certainty, then produces a clean artifact you can use in follow-up or downstream decision work.

For the OB1 workflow that chains meeting synthesis into research and memo drafting, use the [Research-to-Decision Workflow recipe](../../recipes/research-to-decision-workflow/).

## Supported Clients

- Claude Code
- Codex
- Cursor
- Other AI clients that support reusable prompt packs, rules, or custom instructions

## Prerequisites

- Working Open Brain setup if you want the skill to use memory search or capture ([guide](../../docs/01-getting-started.md))
- AI client that supports reusable skills, rules, or custom instructions
- Notes, transcript, or a trustworthy meeting summary

## Installation

1. Copy [`SKILL.md`](./SKILL.md) into the reusable-instructions location for your AI client.
2. Restart or reload the client so it picks up the skill.
3. Test it with a prompt like: `Summarize this diligence call and list decisions, action items, and open questions.`

For Claude Code, a common install path is:

```bash
mkdir -p ~/.claude/skills/meeting-synthesis
cp skills/meeting-synthesis/SKILL.md ~/.claude/skills/meeting-synthesis/SKILL.md
```

## Trigger Conditions

- "Summarize this meeting"
- "What did we decide?"
- "Extract action items"
- "Draft the follow-up"
- "Turn this transcript into a clean brief"

## Expected Outcome

When installed and invoked correctly, the skill should produce:

- a concise summary of why the meeting mattered
- clear decisions and action items
- unresolved questions and active risks
- a clean follow-up artifact when requested
- optional Open Brain capture of key decisions or the final synthesis

## Troubleshooting

**Issue: The output turns discussion into decisions**
Solution: Preserve the separation between "decided", "assigned", and "discussed". This skill should not invent closure.

**Issue: The notes lose ownership**
Solution: Include attendee context when possible. Even rough role labels improve action attribution and follow-up quality.

**Issue: The summary is too generic**
Solution: Include the meeting purpose and what the output should support. A partner call, diligence call, and internal standup should not be synthesized the same way.

## Notes for Other Clients

Adapt the Open Brain tool names to your environment, but keep the same discipline: treat the meeting artifact as the source of truth, preserve uncertainty honestly, and produce outputs that are reusable in future work rather than just readable today.
