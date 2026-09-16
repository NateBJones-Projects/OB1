# Deleting Thoughts

> Safety-focused behavioral skill for removing an Open Brain thought with the `delete_thought` MCP tool.

## What It Does

Guards the one destructive Open Brain operation. `delete_thought` is a hard,
irreversible delete, so this skill makes the client resolve the id via search,
show the target, and confirm before firing — and steers "outdated/wrong" cases
toward updating or deprecating instead of deleting.

## Supported Clients

- Claude Code
- Codex
- Grok
- Any AI client that supports reusable skills, rules, or custom instructions and
  is connected to the `delete-thought-mcp` server

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- The `delete-thought-mcp` integration deployed and connected as
  `open-brain-delete-thought` (see `integrations/delete-thought-mcp`)
- A read tool (`search_thoughts` / `list_thoughts`) to resolve thought ids

## Installation

1. Copy this skill folder into your client's skills directory
   (`~/.claude/skills/`, `~/.codex/skills/`, or `~/.grok/skills/`).
2. Restart or reload the client so it picks up the new skill.
3. Verify by asking the client to "delete my test thought about X" and confirming
   it searches, shows the thought, and asks before deleting.

## Trigger Conditions

- "delete / remove / purge / wipe / get rid of that thought"
- Any call to `delete_thought`
- Tempted to delete a thought that is only outdated or wrong

## Expected Outcome

The client resolves the id via search, shows the thought's content, asks for
confirmation, and only then hard-deletes — reporting the returned receipt (prior
content length). Outdated-but-valuable thoughts are updated or tagged
`superseded` instead.

## Troubleshooting

**Issue: The client deleted without confirming.**
Solution: The skill was not loaded or was overridden. Confirm it is in the
client's skills directory and reload.

**Issue: `Thought not found`.**
Solution: The id was already deleted or wrong. Re-resolve via
`search_thoughts` — do not retry with a guessed UUID.

**Issue: You wanted to keep the content but drop it from search.**
Solution: That is an update, not a delete — tag it `superseded` via the
**updating-thoughts** skill.

## Notes for Other Clients

Client-agnostic: it names the tool (`delete_thought`) and connector
(`open-brain-delete-thought`), not a specific client. Adapt only the
skills-directory path per client. Pairs with **updating-thoughts** for the
non-destructive path.
