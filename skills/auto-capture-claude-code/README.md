# Auto-Capture Claude Code Adapter

> Claude Code adapter for the [auto-capture](../auto-capture/) skill, adding automatic session-end thought capture via Claude Code hooks.

## Relationship to Upstream Skill

This adapter implements the session-end capture behavior defined by the upstream [auto-capture skill](../auto-capture/) by **Jared Irish**. The base skill is a behavioral protocol — it describes when and what to capture during interactive session closes. This adapter is the concrete Claude Code binding: a Stop-hook script that fires the same capture behavior automatically when a session ends without a verbal trigger (terminal close, Ctrl+C, timeout). The upstream skill and this adapter are complementary; install both for full coverage.

## What It Does

This adapter extends the base [auto-capture skill](../auto-capture/) with automatic ambient capture for Claude Code sessions. While the base skill handles interactive session-close captures (when the user explicitly says "wrap up"), this adapter ensures that sessions which end without a verbal trigger — terminal close, Ctrl+C, timeout — are still captured to Open Brain.

The adapter installs as a Claude Code `Stop` hook. When a session ends:

1. The hook script reads the session transcript
2. Short sessions (< 3 user turns), agent-only sessions, and restricted content are skipped
3. The formatted transcript is POSTed to the Open Brain ingest endpoint for thought extraction
4. A session summary is captured as a journal entry
5. Failed captures are saved to a retry queue and retried on subsequent session ends

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- The base [auto-capture skill](../auto-capture/) installed — this adapter depends on it for the interactive capture behavior
- Claude Code installed and configured
- Node.js 18+ (for native `fetch` support)
- `SUPABASE_URL` and `MCP_ACCESS_KEY` environment variables set (via `.env.local` or system environment)
- Open Brain REST API deployed (from `integrations/rest-api/`) or smart-ingest edge function deployed (from `integrations/smart-ingest/`)

## Steps

### 1. Install the Base Skill

If you haven't already, install the base [auto-capture skill](../auto-capture/) first:

```bash
mkdir -p ~/.claude/skills/auto-capture
cp skills/auto-capture/SKILL.md ~/.claude/skills/auto-capture/SKILL.md
```

### 2. Install This Adapter

Copy the adapter skill and hook script:

```bash
mkdir -p ~/.claude/skills/auto-capture-claude-code
cp skills/auto-capture-claude-code/SKILL.md ~/.claude/skills/auto-capture-claude-code/SKILL.md
cp skills/auto-capture-claude-code/session-end-capture.mjs /path/to/your/scripts/
```

### 3. Register the Hook

Add the Stop hook to your Claude Code settings (`.claude/settings.json` or `~/.claude/settings.json`):

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/your/scripts/session-end-capture.mjs"
          }
        ]
      }
    ]
  }
}
```

### 4. Set Environment Variables

Create a `.env.local` file in your project root (or set system environment variables):

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
MCP_ACCESS_KEY=your-access-key
```

### 5. Verify

Restart Claude Code, have a conversation with at least 3 user messages, then end the session. Check:

```bash
# Check the capture log
cat logs/ambient-capture.log

# Verify thoughts were created
curl "https://<project-ref>.supabase.co/functions/v1/open-brain-rest/thoughts?source_type=claude_code_ambient&limit=5" \
  -H "x-brain-key: your-access-key"
```

## Expected Outcome

After installation, every meaningful Claude Code session (3+ user turns, non-agent, non-restricted) is automatically captured to Open Brain. You should see:

- Capture log entries in `logs/ambient-capture.log` showing session dispositions
- New thoughts with `source_type = "claude_code_ambient"` in your Open Brain
- Failed captures queued in `data/capture-retry-queue/` (retried on next session end)
- Short and agent sessions silently skipped

## Troubleshooting

**Issue: No captures appearing after session end**
Solution: Check `logs/ambient-capture.log` for the disposition. Common causes: session had fewer than 3 user turns (`skipped:too_short`), missing environment variables (`error:missing_env`), or the ingest endpoint is unreachable (`error:fetch`).

**Issue: Hook blocks Claude Code shutdown**
Solution: The script has a 25-second hard timeout and all errors are caught. If shutdown is slow, check that `node` is in your PATH and the script path is correct.

**Issue: "skipped:no_transcript" in logs**
Solution: Claude Code may not produce a transcript for very short sessions. This is expected behavior.

**Issue: Retry queue growing**
Solution: Check `data/capture-retry-queue/` for pending files. Each file includes the error message. Common causes: wrong `SUPABASE_URL`, expired `MCP_ACCESS_KEY`, or the ingest function is not deployed.

## Notes

- The hook script is a reference implementation. Adapt the path constants, ingest endpoint URL, and environment loading to match your project layout.
- The base auto-capture skill and this adapter are complementary, not competing. Use both for complete coverage: interactive capture for ACT NOW items and explicit summaries, ambient capture for everything else.
- The script uses the REST API directly (not MCP tools) so it works regardless of which MCP connector is active in the Claude Code session.
