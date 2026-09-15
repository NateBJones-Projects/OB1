# Updating Thoughts

> Behavioral skill for editing an existing Open Brain thought with the `update_thought` MCP tool.

## What It Does

Teaches an AI client *how* and *when* to edit a stored thought: resolve the
thought's UUID first, then choose between cheap metadata tagging
(`metadata_patch`), a content rewrite that re-embeds (`content`), and optional
optimistic-concurrency protection (`if_unchanged_since`).

## Supported Clients

- Claude Code
- Codex
- Grok
- Any AI client that supports reusable skills, rules, or custom instructions and
  is connected to the `update-thought-mcp` server

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- The `update-thought-mcp` integration deployed and connected as
  `open-brain-update-thought` (see `integrations/update-thought-mcp`)
- A read tool (`search_thoughts` / `list_thoughts`) to resolve thought ids

## Installation

1. Copy this skill folder into your client's skills directory
   (`~/.claude/skills/`, `~/.codex/skills/`, or `~/.grok/skills/`).
2. Restart or reload the client so it picks up the new skill.
3. Verify by asking the client to "add a status tag to my thought about X".

## Trigger Conditions

- "update / edit / correct / rewrite that thought"
- "re-tag / re-classify / mark as superseded / add a status to"
- "annotate the note about X without changing the wording"

## Expected Outcome

The client resolves the thought's id via search, picks the right update mode,
and returns a confirmation of what changed plus the new `updated_at`.

## Troubleshooting

**Issue: The client asks for a UUID.**
Solution: That is expected — it should search first. Point it at
`search_thoughts` / `list_thoughts` to resolve the target.

**Issue: A tag change re-embedded the whole thought.**
Solution: Use `metadata_patch`, not `content`. Only `content` triggers
re-embedding.

**Issue: `STALE_READ` returned.**
Solution: Another writer changed the row since your `if_unchanged_since`
timestamp. Re-fetch the thought and retry.

## Notes for Other Clients

The skill is client-agnostic — it names the tool (`update_thought`) and the
connector (`open-brain-update-thought`), not a specific client. Adapt only the
skills-directory path per client.
