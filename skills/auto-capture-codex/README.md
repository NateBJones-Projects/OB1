# Auto-Capture Codex Adapter

> Codex CLI adapter for the [auto-capture](../auto-capture/) skill, adding automatic session-end capture of Codex sessions to Open Brain via a Codex `Stop` hook.

## Relationship to Upstream Skill

This adapter implements the session-end capture behavior defined by the upstream
[auto-capture skill](../auto-capture/). The base skill is a behavioral protocol —
it describes when and what to capture at a session close. This adapter is the
concrete Codex binding: a hook script that fires the same capture behavior
automatically when a Codex session ends. It is the Codex sibling of the
[auto-capture-claude-code](../auto-capture-claude-code/) adapter.

## What It Does

The adapter installs as a Codex `Stop` hook. When a session winds down:

1. The hook script reads Codex's rollout transcript for the session.
2. Short sessions (< 3 user turns) and already-captured sessions are skipped.
3. The transcript is formatted, capped to a safe size, and POSTed to the Open
   Brain REST `/ingest` endpoint for automatic thought extraction.

Because Codex has **no `SessionEnd` event**, the script runs on `Stop` (which
fires per turn) and uses a **debounced, once-per-session** capture: it schedules
a deferred capture ~120s after the last turn, so it effectively fires once, when
the session goes idle.

## Why This Isn't the Claude Code Adapter

Codex stores transcripts as "rollout" JSONL — `event_msg` records with
`payload.type == "user_message"` / `"agent_message"` — not the Claude Code
schema. The Claude Code adapter parses **zero** turns from a Codex rollout and
silently captures nothing, so Codex needs its own parser. This script provides it.

## Prerequisites

- Codex CLI
- Node.js 18+ (native `fetch`)
- A deployed Open Brain with the `open-brain-rest` Edge Function (`/ingest`) and an `MCP_ACCESS_KEY`

## Install

### 1. Copy the script

```bash
mkdir -p ~/.codex/open-brain
cp skills/auto-capture-codex/capture-codex-session.mjs ~/.codex/open-brain/
```

### 2. Provide credentials

Create `~/.codex/open-brain/.env.local` (readable only by you):

```bash
SUPABASE_URL=https://<your-ref>.supabase.co
MCP_ACCESS_KEY=<your access key>
```

```bash
chmod 600 ~/.codex/open-brain/.env.local
```

The script reads `.env.local` from its own directory by default. If you place
the script elsewhere, point it at the config directory with `OB_CAPTURE_ROOT`.
Never put the access key directly in `config.toml`.

### 3. Register the Stop hook

Add to `~/.codex/config.toml`:

```toml
[[hooks.Stop]]
matcher = ""

[[hooks.Stop.hooks]]
type = "command"
command = "node /ABSOLUTE/PATH/TO/.codex/open-brain/capture-codex-session.mjs"
timeout = 30
statusMessage = "Capturing session to Open Brain"
```

Codex loads hooks at session start, so start a fresh Codex session (or reload)
after editing the config. Codex may prompt to trust the hook the first time —
approve it.

## Verify

After a real Codex session ends:

```bash
tail -1 ~/.codex/open-brain/logs/ambient-capture.log
```

You want `disposition=captured:thought_...`. Other outcomes:

| Disposition | Meaning |
| ----------- | ------- |
| `captured:thought_...` | Success — a thought was ingested |
| `scheduled:delay_...ms` | Debounce armed; the deferred capture runs shortly |
| `skipped:too_short` | Under the minimum user-turn threshold |
| `skipped:already_captured` | This session was already captured |
| `error:missing_env` | `SUPABASE_URL` / `MCP_ACCESS_KEY` not found |

## Configuration

| Env var | Default | Purpose |
| ------- | ------- | ------- |
| `OB_CAPTURE_ROOT` | script directory | Where `.env.local`, `logs/`, `state/`, and the retry queue live |
| `OB_CAPTURE_MIN_USER_TURNS` | `3` | Minimum user turns before capturing |
| `OB_CAPTURE_DEBOUNCE_MS` | `120000` | Delay before the deferred capture fires |
| `OB_CAPTURE_MAX_CHARS` | `24000` | Payload size cap (embedding token limit) |
| `OB_CAPTURE_SYNC` | unset | Set to `1` to capture synchronously (testing) |

## Notes

- The payload is capped at 24k chars because the ingest embedding model has a
  ~8191-token limit; oversized payloads otherwise fail with HTTP 500. The cap
  keeps the start and end of the session and drops the middle with a marker.
- Full session transcripts are sent to Open Brain, and each capture spends a
  small amount of LLM credit on metadata extraction.
