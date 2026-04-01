# Auto-Capture

> Behavioral skill that captures ACT NOW items and a session summary to Open Brain when a session ends.

## What It Does

This skill teaches your AI client to treat session close as a capture moment. When a work session, brainstorm, or Panning for Gold run is wrapping up, it stores the highest-value outputs in Open Brain instead of relying on you to remember later.

If you want the OB1 workflow, composition guidance, and examples for using this skill with Panning for Gold, see the [Auto-Capture recipe](../../recipes/auto-capture/).

## Supported Clients

- Claude Code
- Codex
- Cursor
- Other AI clients that support reusable prompt packs, rules, or custom instructions

## Prerequisites

- Working Open Brain setup with a capture tool available ([guide](../../docs/01-getting-started.md))
- AI client that supports reusable skills, rules, or custom instructions
- Recommended: an Open Brain search tool is also available so the skill can avoid obvious duplicates

## Installation

1. Copy [`SKILL.md`](./SKILL.md) into the right reusable-instructions location for your AI client.
2. Restart or reload the client so it picks up the skill.
3. Verify by ending a short session with one clear next action and confirming the client captures both the action and a session summary to Open Brain.

For Claude Code, a common install path is:

```bash
mkdir -p ~/.claude/skills/auto-capture
cp skills/auto-capture/SKILL.md ~/.claude/skills/auto-capture/SKILL.md
```

## Trigger Conditions

- End-of-session phrases like "wrap up", "park this", "goodnight", or "let's stop here"
- Finishing a brainstorm with ACT NOW items
- Finishing a Panning for Gold run or similar evaluation workflow
- Any session where decisions or next actions would be costly to lose

## Expected Outcome

When installed and invoked correctly, the skill:

- captures each ACT NOW item as its own Open Brain thought
- captures one session summary
- includes concrete next actions and enough context to make the captures useful later
- avoids capturing raw transcript noise or parked/killed items

## Troubleshooting

**Issue: The client ends the session without saving anything**
Solution: Confirm the skill is loaded and that your client exposes an Open Brain capture tool in the current environment. Test the tool manually first if needed.

**Issue: Captures appear, but they are too vague**
Solution: Tighten the prompt behavior by preserving the skill's requirement for strong summaries, concrete next actions, and provenance. The skill works best when captures are self-contained.

**Issue: The skill references the wrong tool name**
Solution: Tool prefixes vary by client and connector. Adapt the skill to the names exposed in your environment. Many setups expose `capture_thought` and `search_thoughts`, but namespaced variants are common.

## Notes for Other Clients

This skill is written as a plain-text prompt pack so it can travel. In Claude Code it fits naturally in `~/.claude/skills/`. In Codex or Cursor, adapt it into the equivalent reusable instruction or project rule system without changing the core behavior: capture only the high-value outputs at session close.
