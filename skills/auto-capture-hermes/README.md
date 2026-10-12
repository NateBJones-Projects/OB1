# Auto-Capture Hermes Adapter

> Hermes Agent adapter for the [auto-capture](../../skills/auto-capture/) skill, adding automatic session-end capture of Hermes sessions to Open Brain via Hermes shell hooks.

## Relationship to Upstream Skill

This adapter implements the session-end capture behavior defined by the upstream
[auto-capture skill](../../skills/auto-capture/). The base skill is a behavioral
protocol — it describes when and what to capture at a session close. This
adapter is the concrete Hermes binding: a hook script that fires the same
capture behavior automatically when a Hermes session ends. It is the Hermes
sibling of the [auto-capture-claude-code](../../skills/auto-capture-claude-code/)
adapter and of the auto-capture-codex and auto-capture-grok adapters.

## What It Does

The adapter installs as a Hermes **shell hook**. When a session winds down:

1. Hermes runs the hook script with a JSON payload (`hook_event_name`,
   `session_id`, `cwd`, `profile`, `extra`) on stdin.
2. The script reads that session's conversation from Hermes's SQLite
   `state.db`, drops tool-call-only steps, compaction summaries, and subagent
   sessions, and skips sessions with fewer than 3 real user turns.
3. The transcript is formatted, capped to a safe size, and POSTed to the Open
   Brain REST `/ingest` endpoint for automatic thought extraction.

Hermes exposes two relevant events, and the script uses both:

| Event | When it fires | What the script does |
| ----- | ------------- | -------------------- |
| `on_session_finalize` | Once, at session teardown (`/new`, CLI quit, gateway reset/shutdown) | Captures ~5s later (the final turn may still be flushing to the DB) |
| `on_session_end` | After **every turn**, despite the name | Debounced capture ~120s after the last turn, so idle gateway chats that never finalize are still captured |

A per-session state file guarantees each session is captured **once**, whichever
schedule fires first.

## Why This Isn't the Claude Code Adapter

Hermes writes **no transcript files**. Sessions live in `~/.hermes/state.db`
(SQLite; per profile under `~/.hermes/profiles/<name>/state.db`) in a `sessions`
table and a `messages` table (`role` in `user` / `assistant` / `tool` /
`session_meta`, plain-text `content`). File-based adapters parse **zero** turns
from a Hermes install and silently capture nothing. This script queries the
database read-only instead.

## Prerequisites

- Hermes Agent installed (`hermes --version` works; `~/.hermes/state.db` exists)
- Node.js 18+ (native `fetch`). Node 22.5+ is recommended so the built-in
  `node:sqlite` module is available; on older Node the script falls back to the
  `sqlite3` command-line tool, which must then be on `PATH`
- A deployed Open Brain with the `open-brain-rest` Edge Function (`/ingest`) and an `MCP_ACCESS_KEY`
- The base [auto-capture](../../skills/auto-capture/) skill is the behavioral prerequisite this adapter builds on

## Install

### 1. Copy the script

```bash
mkdir -p ~/.hermes/agent-hooks/open-brain
cp skills/auto-capture-hermes/capture-hermes-session.mjs ~/.hermes/agent-hooks/open-brain/
chmod +x ~/.hermes/agent-hooks/open-brain/capture-hermes-session.mjs
```

### 2. Provide credentials

Create `~/.hermes/agent-hooks/open-brain/.env.local` (readable only by you):

```bash
SUPABASE_URL=https://<your-ref>.supabase.co
MCP_ACCESS_KEY=<your access key>
```

```bash
chmod 600 ~/.hermes/agent-hooks/open-brain/.env.local
```

The script reads `.env.local` from its own directory by default. If you place
the script elsewhere, point it at the config directory with `OB_CAPTURE_ROOT`.
Never put the access key directly in `config.yaml`.

### 3. Register the shell hooks

Add to `~/.hermes/config.yaml` (merge into an existing `hooks:` block if you
already have one):

```yaml
hooks:
  on_session_finalize:
    - name: open-brain-capture
      command: /ABSOLUTE/PATH/TO/.hermes/agent-hooks/open-brain/capture-hermes-session.mjs
      timeout: 30
  on_session_end:
    - name: open-brain-capture-debounced
      command: /ABSOLUTE/PATH/TO/.hermes/agent-hooks/open-brain/capture-hermes-session.mjs
      timeout: 30
```

Use the absolute path (Hermes keys its consent allowlist on the exact command
string). The `.mjs` file has a `#!/usr/bin/env node` shebang; if you prefer to
be explicit, use `command: node /ABSOLUTE/PATH/.../capture-hermes-session.mjs`.

### 4. Approve the hook

Hermes asks for first-use consent per `(event, command)` pair the next time an
interactive session starts, and stores it in
`~/.hermes/shell-hooks-allowlist.json`. For non-interactive surfaces (gateway,
cron) use one of: `hermes --accept-hooks chat`, `HERMES_ACCEPT_HOOKS=1`, or
`hooks_auto_accept: true` in `config.yaml`. Confirm with:

```bash
hermes hooks list
hermes hooks doctor
```

Hooks load at session start, so start a fresh Hermes session (and restart the
gateway, if you run one) after editing the config.

## Verify

Dry-run against your most recent real session first — this prints the exact
payload and sends nothing:

```bash
node ~/.hermes/agent-hooks/open-brain/capture-hermes-session.mjs --dry-run --latest
```

You can also fire the real hook path with a synthetic payload, still without
sending, by exporting `OB_CAPTURE_DRY_RUN=1` before running
`hermes hooks test on_session_finalize --payload-file payload.json` where
`payload.json` contains `{"session_id": "<a real session id>"}`.

After a real Hermes session ends:

```bash
tail -1 ~/.hermes/agent-hooks/open-brain/logs/ambient-capture-hermes.log
```

You want `disposition=captured:...`. Other outcomes:

| Disposition | Meaning |
| ----------- | ------- |
| `captured:...` | Success — the transcript was ingested |
| `scheduled:on_session_finalize:delay_5000ms` | Finalize seen; the deferred capture runs in a few seconds |
| `scheduled:on_session_end:delay_120000ms` | Debounce armed; superseded if another turn arrives |
| `skipped:too_short` | Fewer than 3 real user turns |
| `skipped:subagent` | Session has a parent session or a `Subagent:` title |
| `skipped:already_captured` | This session was captured earlier |
| `skipped:superseded` | A newer turn re-armed the debounce |
| `error:missing_env` | `SUPABASE_URL` / `MCP_ACCESS_KEY` not found |

## Expected Outcome

After installation, every meaningful Hermes session (3+ real user turns, not a
subagent) is automatically ingested into Open Brain shortly after it ends or
goes idle. You should see:

- `disposition=captured:...` lines in `logs/ambient-capture-hermes.log`
- New content in Open Brain carrying `source_label: hermes:<project>`. What that
  looks like depends on your `open-brain-rest` `/ingest`: the Smart Ingest
  pipeline (the common production setup) extracts atomic facts from the
  transcript, dedups them against existing thoughts, and records the run in
  `ingestion_jobs` / `ingestion_items` (the log's `captured:<n>` is that job id;
  expect roughly 30–45 s per capture because each fact is embedded and
  classified). The simpler gateway stores the whole transcript as one thought
  whose text starts with `Hermes Agent Session Transcript` and logs its id.
- Failed captures queued in `data/capture-retry-queue/` and retried on later runs
- Short and subagent sessions silently skipped

## Configuration

| Env var | Default | Purpose |
| ------- | ------- | ------- |
| `HERMES_HOME` | `~/.hermes` | Hermes home whose `state.db` is read; Hermes sets this per profile for the hook |
| `OB_HERMES_STATE_DB` | `<HERMES_HOME>/state.db` | Explicit database path |
| `OB_CAPTURE_ROOT` | script directory | Where `.env.local`, `logs/`, `state/`, and the retry queue live |
| `OB_CAPTURE_MIN_USER_TURNS` | `3` | Minimum real user turns before capturing |
| `OB_CAPTURE_DEBOUNCE_MS` | `120000` | Idle delay after `on_session_end` |
| `OB_CAPTURE_FINALIZE_DELAY_MS` | `5000` | Delay after `on_session_finalize` |
| `OB_CAPTURE_MAX_CHARS` | `24000` | Payload size cap (embedding token limit) |
| `FETCH_TIMEOUT_MS` | `45000` in the detached worker, `10000` for a synchronous run | Ingest request timeout. The worker runs outside Hermes's 30 s hook limit and Smart Ingest can take 30–45 s |
| `OB_CAPTURE_HARD_TIMEOUT_MS` | delay + `90000` in the worker, `25000` otherwise | Absolute process lifetime guard |
| `OB_CAPTURE_SYNC` | unset | Set to `1` to capture synchronously (testing) |
| `OB_CAPTURE_DRY_RUN` | unset | Set to `1` to print the payload instead of sending |

Command-line flags: `--dry-run`, `--latest`, `--session <id or prefix>`.

## Troubleshooting

**Issue: `skipped:too_short` after a long gateway chat**
Solution: Cron-job output that Hermes injects as a user message (`[Cronjob ...]`)
is labeled `user:cron` and does not count as a human turn. Check the real
human turn count with `hermes sessions list`.

**Issue: Nothing logs at all after a session ends**
Solution: The hook is probably not approved or not loaded. Run
`hermes hooks list` (look for a check mark next to the command) and
`hermes hooks doctor`. Hooks register at session start, so a config edit needs a
new session to take effect.

**Issue: `error:parse:... state.db not found`**
Solution: The hook ran under a profile whose home has no database yet, or
`HERMES_HOME` points elsewhere. Set `OB_HERMES_STATE_DB` explicitly if your
layout is unusual.

**Issue: Capture ran before the final turn landed in the DB**
Solution: Raise `OB_CAPTURE_FINALIZE_DELAY_MS`. The finalize hook fires before
Hermes's final flush on some paths, which is why the script waits before reading.

## Notes

- The payload is capped at 24k chars because the ingest embedding model has a
  ~8191-token limit; oversized payloads otherwise fail with HTTP 500 while still
  writing an embedding-less row. The cap keeps the start and end of the session
  and drops the middle with a marker.
- `on_session_end` payloads carry only identifiers and outcome flags, never the
  message body, so the script always reads the transcript from `state.db`.
- Hermes also offers `hermes sessions export --format jsonl --session-id <id>`,
  which emits one JSON object per session with an embedded `messages` array.
  This script reads the database directly instead because it is faster inside a
  hook and needs no Hermes Python startup, but the export is a handy way to
  inspect a session by hand.
- Full session transcripts are sent to Open Brain, and each capture spends a
  small amount of LLM credit on metadata extraction.
