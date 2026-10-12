---
name: auto-capture-hermes
description: |
  Hermes Agent adapter for the auto-capture skill. Automatically captures Hermes
  sessions to Open Brain at session end via Hermes shell hooks — no manual
  "wrap up" needed. Use this when you want every meaningful Hermes session
  (CLI, TUI, Desktop, WebUI, or messaging gateway) preserved to Open Brain
  automatically, or when asked to "capture this Hermes session", "set up Hermes
  auto-capture", or "why didn't my Hermes session get captured". Reads the
  transcript from Hermes's SQLite state.db.
author: Ezana Azene
version: 1.0.0
---

# Auto-Capture Hermes Adapter

Hermes adapter for the upstream [auto-capture skill](../auto-capture/). The base
skill is a behavioral protocol — it describes when and what to capture at a
session close. This adapter is the concrete Hermes Agent binding: a shell-hook
script that fires the same capture behavior automatically when a Hermes session
ends, without a verbal trigger. It is the Hermes sibling of the
[auto-capture-claude-code](../auto-capture-claude-code/) adapter and of the
auto-capture-codex and auto-capture-grok adapters.

## Why an adapter (and why not the Claude Code one)

Each agent stores its transcript differently, so each needs its own parser:

- **Claude Code** writes JSONL under `~/.claude/projects/`.
- **Codex** writes "rollout" JSONL under `~/.codex/sessions/`.
- **Grok** writes `chat_history.jsonl` per session under `~/.grok/sessions/`.
- **Hermes** writes **no transcript files at all**. Every session lives in a
  SQLite database, `~/.hermes/state.db` (per profile:
  `~/.hermes/profiles/<name>/state.db`), in two tables:
  - `sessions` — one row per session: `id`, `source` (`cli`, `tui`, `desktop`,
    `webui`, `telegram`, `ios`, `oneshot`, ...), `title`, `cwd`, `git_branch`,
    `started_at`, `ended_at`, `end_reason` (`cli_close`, `agent_close`),
    `parent_session_id` (set for subagents), `message_count`.
  - `messages` — one row per message: `role` (`user`, `assistant`, `tool`,
    `session_meta`), `content` (plain text), `tool_calls`, `tool_name`,
    `timestamp`, plus compaction flags (`compacted`, `active`,
    `_compressed_summary`).

Pointing any file-based adapter at Hermes finds nothing to parse. This adapter
queries `state.db` read-only and rebuilds the user/assistant conversation.

## How it works

1. Hermes has a native **shell-hook** system (`hooks:` block in
   `~/.hermes/config.yaml`) that runs a script with a JSON payload on stdin at
   lifecycle events. Two events matter here:
   - **`on_session_finalize`** fires **once** when a session is torn down
     (`/new`, CLI quit with an active agent, gateway session reset or shutdown).
   - **`on_session_end`** fires after **every turn**, despite its name.
2. The script registers for both. `on_session_finalize` schedules a capture a
   few seconds later (the last turn may still be flushing to `state.db`).
   `on_session_end` schedules a **debounced** capture (default 120s after the
   last turn) so long-lived gateway chats that never finalize are still captured
   once they go idle. A per-session state file guarantees each session is
   captured **once**; whichever schedule fires first wins.
3. The capture reads the session's `user`/`assistant` rows (dropping tool-call-only
   assistant steps, compaction summaries, and subagent sessions), labels
   scheduled cron output as `[user:cron]` so it does not count as a human turn,
   and skips sessions with fewer than 3 real user turns.
4. The formatted transcript is capped at 24k chars (embedding token limit) and
   POSTed to the Open Brain REST `/ingest` endpoint for automatic thought
   extraction. An `import_key` de-dupes retries.

All errors are logged and swallowed — the hook never blocks Hermes shutdown.

## Files

- `capture-hermes-session.mjs` — the hook script (Node 18+, no dependencies;
  uses `node:sqlite` on Node 22.5+ and falls back to the `sqlite3` CLI).

## Setup

See [README.md](./README.md) for full install steps. In short:

1. Copy `capture-hermes-session.mjs` to a stable location (e.g.
   `~/.hermes/agent-hooks/open-brain/`).
2. Put `SUPABASE_URL` and `MCP_ACCESS_KEY` in a `.env.local` beside it (or set
   them in the environment). Override the config/log/state root with
   `OB_CAPTURE_ROOT` if the script lives elsewhere.
3. Register `on_session_finalize` and `on_session_end` shell hooks in
   `~/.hermes/config.yaml` pointing at the script, then approve the first-use
   consent prompt (or set `hooks_auto_accept: true` for gateway/cron runs).

## Verify

Dry-run against your most recent real session without sending anything:

```bash
node ~/.hermes/agent-hooks/open-brain/capture-hermes-session.mjs --dry-run --latest
```

After a real Hermes session ends, check the log:

```text
tail -1 <capture-root>/logs/ambient-capture-hermes.log
```

A working capture reads `disposition=captured:...`. `scheduled:...` means the
deferred capture is pending; `skipped:too_short`, `skipped:subagent`,
`skipped:already_captured`, or `error:missing_env` mean it ran but did not
ingest.

## Environment knobs

- `HERMES_HOME` — Hermes home whose `state.db` is read (Hermes sets this per
  profile for the hook subprocess; default `~/.hermes`).
- `OB_HERMES_STATE_DB` — explicit path to a `state.db` (overrides `HERMES_HOME`).
- `OB_CAPTURE_ROOT` — where `.env.local`, `logs/`, `state/`, and the retry queue
  live (default: the script's directory).
- `OB_CAPTURE_MIN_USER_TURNS` — minimum real user turns to capture (default 3).
- `OB_CAPTURE_DEBOUNCE_MS` — idle delay after `on_session_end` (default 120000).
- `OB_CAPTURE_FINALIZE_DELAY_MS` — delay after `on_session_finalize` (default 5000).
- `OB_CAPTURE_MAX_CHARS` — payload size cap (default 24000).
- `OB_CAPTURE_SYNC=1` — capture synchronously instead of scheduling (testing).
- `OB_CAPTURE_DRY_RUN=1` — same as `--dry-run`; handy with `hermes hooks test`.
