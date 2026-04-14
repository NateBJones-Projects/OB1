# Work Operating Model

> Reusable interviewer skill that turns a user's tacit work patterns into structured Open Brain records and agent-ready exports.

## What It Does

This skill runs a strict, five-layer elicitation interview:

1. operating rhythms
2. recurring decisions
3. dependencies
4. institutional knowledge
5. friction

It resumes or starts a session, interviews through concrete recent examples, confirms each checkpoint before saving, writes one summary thought per approved layer through the base Open Brain connector, runs a final contradiction pass, and generates export artifacts.

If you want the schema, MCP server, and setup instructions, use the paired [Work Operating Model Activation recipe](../../recipes/work-operating-model-activation/).

## Supported Clients

- Claude Code
- Codex
- Cursor
- Any client that supports reusable prompt packs plus MCP tools

## Prerequisites

- Working Open Brain setup with `search_thoughts` and `capture_thought` available ([guide](../../docs/01-getting-started.md))
- The [Work Operating Model Activation recipe](../../recipes/work-operating-model-activation/) installed and connected
- AI client that supports reusable skills or equivalent system instructions

## Installation

1. Copy [`SKILL.md`](./SKILL.md) into your client's reusable-instructions location.
2. Reload or restart the client.
3. Verify the client can see:
   - your core Open Brain search/capture tools
   - `start_operating_model_session`
   - `save_operating_model_layer`
   - `query_operating_model`
   - `generate_operating_model_exports`

For Claude Code, a common install path is:

```bash
mkdir -p ~/.claude/skills/work-operating-model
cp skills/work-operating-model/SKILL.md ~/.claude/skills/work-operating-model/SKILL.md
```

## Trigger Conditions

- “Help me document how I actually work”
- “Interview me for my operating model”
- “Build my USER.md / SOUL.md / HEARTBEAT.md from a conversation”
- “I want to figure out what I actually do all day”
- Starting the paired recipe in a client that supports skills

## Expected Outcome

When the skill is loaded and the paired recipe is connected, the client should:

- create or resume a session
- interview in the fixed five-layer order
- show a checkpoint summary before every save
- only persist confirmed or explicitly synthesized patterns
- capture one summary thought per layer plus one final synthesis thought
- return `operating-model.json`, `USER.md`, `SOUL.md`, `HEARTBEAT.md`, and `schedule-recommendations.json`

## Troubleshooting

**Issue: The skill starts asking broad abstract questions**
Solution: Restore the “recent concrete examples first” rule from the skill. The workflow should anchor on last week or last month before synthesizing patterns.

**Issue: The skill saves unconfirmed hints from search**
Solution: It should not. Search results are hints only. They must be confirmed or reframed by the user before persistence.

**Issue: The skill cannot find the paired MCP tools**
Solution: Confirm the recipe connector is enabled. The skill needs both the recipe server and the base Open Brain connector.

## Notes for Other Clients

Tool names may be namespaced in some clients. Keep the behavior the same even if the visible tool IDs differ:

- identify the base search/capture tools that write to core Open Brain
- identify the four recipe tools that manage the operating model
- use those actual names in your environment rather than hard-coding a prefix
