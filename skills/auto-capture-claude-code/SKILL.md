---
name: auto-capture-claude-code
description: |
  Claude Code adapter for the auto-capture skill. Extends auto-capture with
  automatic session-end hooks that capture transcripts to Open Brain without
  manual intervention. Use this when you want every meaningful Claude Code
  session to be preserved automatically — not just the ones where you
  remember to say "wrap up".
author: Alan Shurafa
version: 1.0.0
requires_skills:
  - auto-capture
---

# Auto-Capture: Claude Code Adapter

## Relationship to Upstream Skill

This adapter implements the session-end capture behavior defined by the upstream [auto-capture skill](../auto-capture/) by **Jared Irish**. The base skill is a behavioral protocol — it describes when and what to capture during interactive session closes. This adapter is the concrete Claude Code binding: a Stop-hook script that fires the same capture behavior automatically when a session ends without a verbal trigger. The upstream skill and this adapter are complementary; install both for full coverage.

## Problem

The base auto-capture skill requires a verbal trigger ("wrap up", "park this")
to fire. In practice, many Claude Code sessions end without that trigger —
the user closes the terminal, hits Ctrl+C, or simply walks away. Those sessions
and their decisions are lost.

## What This Adapter Adds

This adapter uses Claude Code's hook system to run a capture script automatically
at session end. It complements the base auto-capture skill:

- **Base auto-capture** handles interactive session-close captures (ACT NOW items,
  session summaries) when the user explicitly wraps up.
- **This adapter** handles ambient capture when the session ends without an
  explicit trigger (terminal close, timeout, Ctrl+C).

Together they ensure no valuable session falls through the cracks.

## How It Works

1. Claude Code fires a `Stop` hook at session end, passing the transcript path
   and session metadata via stdin as JSON.
2. The hook script (`session-end-capture.mjs`) reads the transcript, filters out
   short or agent-only sessions, and formats the content.
3. The formatted transcript is POSTed to the Open Brain REST ingest endpoint
   (or smart-ingest edge function) for automatic thought extraction.
4. A session summary thought is captured separately as a journal entry.
5. Failed captures are saved to a local retry queue and retried on subsequent
   session ends.

## Skip Heuristics

Not every session is worth capturing. The hook skips:

- Sessions with fewer than 3 user turns (too short to contain decisions)
- Agent-only sessions (sub-agent work, automated tooling)
- Sessions containing restricted content (matched against sensitivity patterns)
- Session-end reasons that are not terminal (`clear`, `resume`)

## Installation

### Prerequisites

Install the base [auto-capture skill](../auto-capture/) first. This adapter
extends it — it does not replace it.

### Steps

1. Copy `session-end-capture.mjs` to your project or a shared scripts directory.

2. Register the hook in your Claude Code settings (`.claude/settings.json` or
   global `~/.claude/settings.json`):

   ```json
   {
     "hooks": {
       "Stop": [
         {
           "matcher": "",
           "hooks": [
             {
               "type": "command",
               "command": "node /path/to/session-end-capture.mjs"
             }
           ]
         }
       ]
     }
   }
   ```

3. Set environment variables (in `.env.local` or your environment):

   ```bash
   SUPABASE_URL=https://<project-ref>.supabase.co
   MCP_ACCESS_KEY=your-access-key
   ```

4. Restart Claude Code to pick up the hook.

5. End a test session with at least 3 user messages and verify a capture appears
   in your Open Brain thoughts.

## Adapting the Script

The included `session-end-capture.mjs` is a reference implementation. Adapt it
to your setup:

- **Ingest endpoint**: Update the URL construction if your REST API or
  smart-ingest function is deployed at a different path.
- **Sensitivity patterns**: Add a `config/sensitivity-patterns.json` file with
  regex patterns for restricted content detection, or remove the check if you
  don't need it.
- **Retry queue**: The script saves failed captures to
  `data/capture-retry-queue/` and retries them on subsequent runs. Adjust
  `RETRY_MAX_ATTEMPTS` and `RETRY_BATCH_SIZE` as needed.
- **Hard timeout**: The script exits after 25 seconds to avoid blocking Claude
  Code shutdown. Adjust `HARD_TIMEOUT_MS` if your network is slower.

## Output

When working correctly:

- Every meaningful Claude Code session (3+ user turns, non-agent, non-restricted)
  is automatically ingested into Open Brain for thought extraction.
- A session summary journal entry is captured alongside the full transcript.
- Failed captures are queued locally and retried on subsequent session ends.
- Short, agent, and restricted sessions are silently skipped.
- All outcomes are logged to `logs/ambient-capture.log` for debugging.

## Notes

- This adapter is designed to be non-blocking. All errors are caught and logged —
  the hook never prevents Claude Code from shutting down.
- The base auto-capture skill and this adapter are complementary. The skill
  handles interactive captures with ACT NOW items; the adapter handles ambient
  background capture of the full session transcript.
- Tool names vary by client and connector. The hook script uses the REST API
  directly rather than MCP tools, so it works regardless of which MCP connector
  is active.
