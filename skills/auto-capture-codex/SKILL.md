---
name: auto-capture-codex
description: |
  Codex CLI adapter for the auto-capture skill. Automatically captures Codex
  sessions to Open Brain at session end via a Stop hook — no manual "wrap up"
  needed. Use this when you want every meaningful Codex session preserved to
  Open Brain automatically. Parses Codex's rollout transcript format.
author: Ezana Azene
version: 1.0.0
---

# Auto-Capture Codex Adapter

Codex adapter for the upstream [auto-capture skill](../auto-capture/). The base
skill is a behavioral protocol — it describes when and what to capture at a
session close. This adapter is the concrete Codex binding: a hook script that
fires the same capture behavior automatically when a Codex session ends, without
a verbal trigger.

## Why an adapter (and why not the Claude Code one)

Each agent stores its transcript differently, so each needs its own parser:

- **Claude Code** writes JSONL with `type:user` / `type:assistant` records.
- **Codex** writes "rollout" JSONL under `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`,
  where conversation turns live in `event_msg` records with
  `payload.type == "user_message"` / `"agent_message"`.

Pointing the Claude Code adapter at Codex parses **zero** turns and silently
captures nothing. This adapter parses the Codex rollout format directly.

## How it works

1. Codex has **no `SessionEnd` event** (its hook events are `PreToolUse`,
   `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `Stop`, `SubagentStop`).
   So the hook runs on **`Stop`**, which fires per turn.
2. To capture **once** — not per turn — the script writes per-session state and
   schedules a **debounced** deferred capture (default 120s after the last turn).
   Each new turn supersedes the previous schedule, so the capture runs ~once,
   shortly after the session goes idle — approximating session end.
3. It resolves the rollout transcript robustly: by `session_id` (Codex rollout
   filenames embed it), then the paths on the hook's stdin, then the newest
   rollout for the session's `cwd`.
4. Short sessions (< 3 user turns) and already-captured sessions are skipped.
5. The formatted transcript is capped at 24k chars (embedding token limit) and
   POSTed to the Open Brain REST `/ingest` endpoint for automatic thought
   extraction.

All errors are logged and swallowed — the hook never blocks Codex shutdown.

## Files

- `capture-codex-session.mjs` — the hook script (Node 18+, no dependencies).

## Setup

See [README.md](./README.md) for full install steps. In short:

1. Copy `capture-codex-session.mjs` to a stable location (e.g. `~/.codex/open-brain/`).
2. Put `SUPABASE_URL` and `MCP_ACCESS_KEY` in a `.env.local` beside it (or set
   them in the environment). Override the config/log/state root with
   `OB_CAPTURE_ROOT` if the script lives elsewhere.
3. Register a `Stop` hook in `~/.codex/config.toml` pointing at the script.

## Verify

After a real Codex session ends, check the log:

```
tail -1 <capture-root>/logs/ambient-capture.log
```

A working capture reads `disposition=captured:thought_...`. `skipped:too_short`,
`skipped:already_captured`, or `error:missing_env` mean it ran but didn't ingest.

## Environment knobs

- `OB_CAPTURE_ROOT` — where `.env.local`, `logs/`, `state/`, and the retry queue live (default: the script's directory).
- `OB_CAPTURE_MIN_USER_TURNS` — minimum user turns to capture (default 3).
- `OB_CAPTURE_DEBOUNCE_MS` — debounce before the deferred capture (default 120000).
- `OB_CAPTURE_MAX_CHARS` — payload size cap (default 24000).
- `OB_CAPTURE_SYNC=1` — capture synchronously instead of scheduling (useful for testing).
