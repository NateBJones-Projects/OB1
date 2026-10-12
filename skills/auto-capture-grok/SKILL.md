---
name: auto-capture-grok
description: |
  Grok CLI adapter for the auto-capture skill. Automatically captures Grok
  sessions to Open Brain at session end via a native SessionEnd hook — no manual
  "wrap up" needed. Use this when you want every meaningful Grok session
  preserved to Open Brain automatically. Parses Grok's chat_history format.
author: Ezana Azene
version: 1.0.0
---

# Auto-Capture Grok Adapter

Grok adapter for the upstream [auto-capture skill](../auto-capture/). The base
skill is a behavioral protocol — it describes when and what to capture at a
session close. This adapter is the concrete Grok binding: a hook script that
fires the same capture behavior automatically when a Grok session ends.

## Why an adapter (and why not the Claude Code one)

Each agent stores its transcript differently, so each needs its own parser:

- **Claude Code** writes JSONL with `type:user` / `type:assistant` records.
- **Grok** writes a `chat_history.jsonl` per session under
  `~/.grok/sessions/<url-encoded-cwd>/<session-id>/chat_history.jsonl`, with
  `type:user` / `type:assistant` messages whose text lives in content parts.

Pointing the Claude Code adapter at Grok parses **zero** turns and silently
captures nothing. This adapter parses the Grok `chat_history` format directly.

## How it works

1. Unlike Codex, Grok has a **native `SessionEnd` event**, so the hook runs once,
   exactly when the session ends (`/quit`, `/exit`, or close) — no per-turn firing
   and no debounce needed.
2. The hook locates the session's `chat_history.jsonl` (by `session_id` + `cwd`),
   parses the user/assistant turns, and skips short sessions (< 3 user turns).
3. The formatted transcript is capped at 24k chars (embedding token limit) and
   POSTed to the Open Brain REST `/ingest` endpoint for automatic thought
   extraction. An `import_key` de-dupes retries.

All errors are logged and swallowed — the hook never blocks Grok shutdown.

## Files

- `session-end-capture-grok.mjs` — the hook script (Node 18+, no dependencies).

## Setup

See [README.md](./README.md) for full install steps. In short:

1. Copy `session-end-capture-grok.mjs` into `~/.grok/hooks/`.
2. Put `SUPABASE_URL` and `MCP_ACCESS_KEY` in `~/.grok/.env.local`.
3. Register a `SessionEnd` hook in `~/.grok/hooks/` (a small JSON file) pointing
   at the script.

## Verify

After a real Grok session ends, check the log:

```
tail -1 ~/.grok/logs/ambient-capture-grok.log
```

A working capture reads `disposition=captured:...`. `skipped:too_short`,
`skipped:no_chat_history`, or `error:missing_env` mean it ran but didn't ingest.

## Environment knobs

- `GROK_HOME` — Grok home directory (default `~/.grok`); the script reads
  `<GROK_HOME>/.env.local`, session transcripts, and writes `logs/`/`data/` there.
- `OB_CAPTURE_MAX_CHARS` — payload size cap (default 24000).
