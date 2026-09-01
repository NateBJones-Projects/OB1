# Auto-Capture Grok Adapter

> Grok CLI adapter for the [auto-capture](../auto-capture/) skill, adding automatic session-end capture of Grok sessions to Open Brain via a native Grok `SessionEnd` hook.

## Relationship to Upstream Skill

This adapter implements the session-end capture behavior defined by the upstream
[auto-capture skill](../auto-capture/). The base skill is a behavioral protocol —
it describes when and what to capture at a session close. This adapter is the
concrete Grok binding: a hook script that fires the same capture behavior
automatically when a Grok session ends. It is the Grok sibling of the
[auto-capture-claude-code](../auto-capture-claude-code/) and
[auto-capture-codex](../auto-capture-codex/) adapters.

## What It Does

The adapter installs as a Grok `SessionEnd` hook. When a session ends:

1. The hook script locates and reads the session's `chat_history.jsonl`.
2. Short sessions (< 3 user turns) are skipped.
3. The transcript is formatted, capped to a safe size, and POSTed to the Open
   Brain REST `/ingest` endpoint for automatic thought extraction.

Grok has a **native `SessionEnd` event**, so — unlike the Codex adapter — the
hook fires exactly once at session end, with no per-turn firing and no debounce.

## Why This Isn't the Claude Code Adapter

Grok stores each session as a `chat_history.jsonl` under
`~/.grok/sessions/<url-encoded-cwd>/<session-id>/`, with its own message shape.
The Claude Code adapter parses **zero** turns from a Grok `chat_history` and
silently captures nothing, so Grok needs its own parser. This script provides it.

## Prerequisites

- Grok CLI
- Node.js 18+ (native `fetch`)
- A deployed Open Brain with the `open-brain-rest` Edge Function (`/ingest`) and an `MCP_ACCESS_KEY`

## Install

### 1. Copy the script

```bash
mkdir -p ~/.grok/hooks
cp skills/auto-capture-grok/session-end-capture-grok.mjs ~/.grok/hooks/
```

### 2. Provide credentials

Create `~/.grok/.env.local` (readable only by you):

```bash
SUPABASE_URL=https://<your-ref>.supabase.co
MCP_ACCESS_KEY=<your access key>
```

```bash
chmod 600 ~/.grok/.env.local
```

The script reads `.env.local` from `~/.grok` (or `GROK_HOME`) by default. Never
put the access key directly in a config file.

### 3. Register the SessionEnd hook

Grok discovers hooks from `~/.grok/hooks/`. Create
`~/.grok/hooks/open-brain-auto-capture.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /ABSOLUTE/PATH/TO/.grok/hooks/session-end-capture-grok.mjs",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Grok loads hooks at session start. Run `/hooks` and reload, or start a fresh
Grok session, so the hook is active. You can confirm it with `grok inspect`.

## Verify

After a real Grok session ends:

```bash
tail -1 ~/.grok/logs/ambient-capture-grok.log
```

You want `disposition=captured:...`. Other outcomes:

| Disposition | Meaning |
| ----------- | ------- |
| `captured:...` | Success — a thought was ingested |
| `skipped:too_short` | Under the minimum user-turn threshold |
| `skipped:no_chat_history` | The session transcript could not be located |
| `error:missing_env` | `SUPABASE_URL` / `MCP_ACCESS_KEY` not found |

## Configuration

| Env var | Default | Purpose |
| ------- | ------- | ------- |
| `GROK_HOME` | `~/.grok` | Grok home: source of `.env.local`, transcripts, and `logs/`/`data/` |
| `OB_CAPTURE_MAX_CHARS` | `24000` | Payload size cap (embedding token limit) |

## Notes

- The payload is capped at 24k chars because the ingest embedding model has a
  ~8191-token limit; oversized payloads otherwise fail with HTTP 500. The cap
  keeps the start and end of the session and drops the middle with a marker.
- Full session transcripts are sent to Open Brain, and each capture spends a
  small amount of LLM credit on metadata extraction.
