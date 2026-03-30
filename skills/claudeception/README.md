# Claudeception

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@jaredirish](https://github.com/jaredirish)**

</div>

*Standalone skill pack for extracting reusable lessons from work sessions and turning them into new skills.*

## What It Does

Claudeception watches for hard-won knowledge during real work: debugging breakthroughs, misleading errors, undocumented behavior, and repeatable workflow shortcuts. When the knowledge is specific, verified, and reusable, it helps turn that discovery into a new skill and records it back into Open Brain.

## Supported Clients

- Claude Code
- Codex
- Cursor
- Any AI client that supports reusable rules, skills, or custom instructions

## Prerequisites

- Working Open Brain setup if you want duplicate checking and capture via `search_thoughts` and `capture_thought` ([guide](../../docs/01-getting-started.md))
- An AI client that can load a reusable skill or prompt file
- A place to save newly created skill files

## Installation

1. Copy [`SKILL.md`](./SKILL.md) into your client's skill/rules directory.
2. For Claude Code, place it at `~/.claude/skills/claudeception/SKILL.md`.
3. Restart or reload your AI client so the skill becomes available.
4. If your client does not support native skill files, adapt the contents into that client's reusable project rules or system prompt.

## Trigger Conditions

- The user says "save this as a skill," "extract a skill from this," or "what did we learn?"
- A task required non-obvious debugging, a workaround, or a misleading-error investigation
- You want a session-end retrospective that preserves lessons instead of losing them

## Expected Outcome

When the skill is working correctly, it should:

- Identify which discoveries are worth preserving
- Check Open Brain and local skill directories for duplicates
- Draft a structured new skill with exact trigger conditions
- Capture the new skill back into Open Brain so future sessions can find it

## Full Recipe

If you want the broader walkthrough and examples, use the companion recipe: [../../recipes/claudeception/](../../recipes/claudeception/).

## Troubleshooting

**Issue:** The skill creates too many low-value skills.  
Solution: Tighten the quality gate. The knowledge needs to be reusable, non-trivial, specific, and verified before it graduates into a skill.

**Issue:** Later sessions do not rediscover the saved skill.  
Solution: Make the description field more concrete. Exact trigger phrases, error messages, and symptoms surface better than vague summaries.

**Issue:** Your client does not support native skill files.  
Solution: Use the contents of [`SKILL.md`](./SKILL.md) as reusable project rules or a system prompt. The operating model still works outside native skill systems.
