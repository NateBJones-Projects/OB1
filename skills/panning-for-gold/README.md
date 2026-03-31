# Panning for Gold

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@jaredirish](https://github.com/jaredirish)**

</div>

*Standalone skill pack for processing transcripts, brain dumps, and raw multi-topic captures.*

## What It Does

Panning for Gold turns messy source material into an evaluated inventory of ideas. It extracts every thread first, evaluates the highest-signal ones second, and writes permanent outputs so nothing gets lost between agent runs or session compaction.

## Supported Clients

- Claude Code
- Codex
- Cursor
- Any AI client that supports reusable rules, skills, or custom instructions

## Prerequisites

- Working Open Brain setup if you want the skill to use `search_thoughts` and `capture_thought` ([guide](../../docs/01-getting-started.md))
- An AI client that can load a reusable skill or prompt file
- A project workspace where the skill can save inventory and synthesis files

## Installation

1. Copy [`SKILL.md`](./SKILL.md) into your client's skill/rules directory.
2. For Claude Code, place it at `~/.claude/skills/panning-for-gold/SKILL.md`.
3. Restart or reload your AI client so it picks up the skill.
4. If your client does not support native skill files, paste the contents into that client's reusable system prompt or project rules.

## Trigger Conditions

- The user says "process this," "pan for gold," "brain dump," or "what did I say?"
- The input is a transcript, export, or multi-topic markdown file
- The task is to extract signal from raw, messy, or stream-of-consciousness input

## Expected Outcome

When the skill is working correctly, it should:

- Save the raw input to disk before analysis
- Produce a numbered thread inventory file
- Evaluate the strongest threads with clear verdicts
- Write a final gold-found synthesis file
- Optionally capture the strongest outcomes back into Open Brain

## Full Recipe

If you want the full walkthrough, setup framing, and usage examples, use the companion recipe: [../../recipes/panning-for-gold/](../../recipes/panning-for-gold/).

## Troubleshooting

**Issue:** The skill skips non-technical or personal threads.  
Solution: Keep the "no category filtering" and "read every line" instructions intact. Tech bias is the main failure mode this skill is designed to prevent.

**Issue:** Evaluations disappear after parallel agent work.  
Solution: Make sure the skill is being used in a workspace where it can write permanent files. The process assumes evaluators save to disk, not just chat output.

**Issue:** The client does not support native skill files.  
Solution: Use the contents of [`SKILL.md`](./SKILL.md) as a reusable project prompt or system rule. The behavior is portable even if the file format is not.
