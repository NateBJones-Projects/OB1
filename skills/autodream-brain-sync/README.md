# Autodream Brain Sync

> Syncs Claude Code's local memory saves to Open Brain so memories are accessible from all AI clients and devices.

## What It Does

Whenever Claude Code saves a memory (via dreaming, autodream, or explicit requests), this skill also captures it to Open Brain via `mcp__open-brain__capture_thought`. This ensures memories aren't siloed in one machine's local files — they're available from ChatGPT, Claude Desktop, Codex, and any other MCP-connected client.

## Supported Clients

- Claude Code

## Prerequisites

- Working Open Brain setup with `capture_thought` tool available ([guide](../../docs/01-getting-started.md))
- Claude Code with auto-memory enabled

## Installation

1. Copy `SKILL.md` into your project's `.claude/` directory, or add its contents to your `CLAUDE.md` under a skills section
2. Restart Claude Code so it picks up the new instructions
3. Verify by saving a memory ("remember that I prefer TypeScript over JavaScript") and checking that both a local memory file and an Open Brain capture are created

## Trigger Conditions

- Any memory file write to `.claude/projects/*/memory/`
- User says "remember this", "save to memory", "dream", "autodream"
- End-of-session auto-dreaming
- Explicit `/memory` command usage

## Expected Outcome

Each memory save produces three things:
1. A local `.md` file in the memory directory (standard Claude Code behavior)
2. An updated `MEMORY.md` index (standard Claude Code behavior)
3. A corresponding Open Brain thought capture (added by this skill)

The Open Brain capture is prefixed with the memory type (e.g., `[feedback]`, `[user]`, `[project]`) for context when retrieved from other clients.

## Troubleshooting

**Issue: Open Brain capture fails but local memory saves fine**
Solution: Check that your MCP server is running (`supabase functions list` should show `open-brain-mcp` as ACTIVE). The skill is designed to not block local saves if the capture fails.

**Issue: Duplicate thoughts in Open Brain**
Solution: Open Brain uses embedding-based dedup. If you update an existing memory, the new capture may coexist with the old one. This is expected — semantic search will surface the most relevant version.

**Issue: Memories not appearing in ChatGPT/Claude Desktop**
Solution: Other clients need to explicitly search Open Brain — memories aren't pushed to them automatically. Ask "search my brain for [topic]" to retrieve synced memories.

## Notes for Other Clients

This skill is specific to Claude Code's auto-memory system. Other clients (ChatGPT, Claude Desktop, Codex) capture directly to Open Brain without needing a sync step — they don't have local memory files. The skill ensures Claude Code's local memories don't become an isolated silo.
