---
name: open-brain-capture-hook-authoring
description: |
  Author or debug a session-end auto-capture hook that ships an AI CLI's
  transcript to Open Brain. Use when: (1) a capture hook logs
  "skipped:too_short" / turns=0 even though the session was long,
  (2) writing a Stop/SessionEnd hook that parses a Claude Code, Codex, or Grok
  transcript, (3) /ingest returns HTTP 500 on long sessions, (4) a captured
  thought exists in the DB but has no embedding. Covers each agent's real
  on-disk transcript format and the Open Brain ingest limits.
author: Ezana Azene
version: 1.0.0
---

# Open Brain Capture-Hook Authoring

## Problem

Session-end capture hooks that ship an AI CLI transcript to Open Brain fail
**silently**: they log `skipped:too_short` (turns=0) and capture nothing, even
after a long session. The cause is almost always a wrong assumption about the
transcript's on-disk format — each agent writes a different one, and none of
them is the plaintext `Human:/Assistant:` shape a naive parser expects.

## Context / Trigger Conditions

- Hook log shows `disposition=skipped:too_short` or `turns=0` after a real,
  multi-turn session.
- Writing a new `Stop` / `SessionEnd` hook that must read a transcript.
- `/ingest` (or the smart-ingest edge function) returns **HTTP 500** on long
  sessions.
- A row appears in the `thoughts` table but its embedding column is null.

## Solution

### 1. Parse each agent's real transcript format

Each agent needs its **own** parser. Ground-truth the format by opening an
actual transcript file — do not trust a reference script's assumed format.

**Claude Code — JSONL** (`~/.claude/projects/<slug>/<uuid>.jsonl`)
- One JSON object per line, with a `type` discriminator.
- Real turns: `type:"user"` and `type:"assistant"`, each carrying a `message`
  object whose `content` is either a string or an array of typed blocks.
- Extract only `content[].type === "text"` blocks. Omit `thinking` and
  `tool_use` blocks.
- A `type:"user"` line whose content is **only** `tool_result` blocks is a tool
  response, **not** a human turn — skip it (or it inflates `userTurns`).
- Skip lines where `o.isSidechain === true` — those are subagent turns, not the
  main thread.
- Header fields (`sessionId`, `timestamp`, `gitBranch`, `cwd`) can appear on any
  record; capture the first seen.
- **The classic bug:** a plaintext `^(Human|Assistant):` regex parser matches
  **zero** turns against JSONL, so the hook always skips as too-short.

**Codex — "rollout" JSONL** (`~/.codex/sessions/…rollout…`)
- Codex has **no `SessionEnd` event.** Use the `Stop` hook + a ~120s debounce +
  a per-session state file so it fires ~once per session, not once per turn.
- Turns live in `event_msg` records with `payload.type` of `user_message` /
  `agent_message`.
- **stdin's `transcript_path` is unreliable** — observed `session=unknown,
  turns=0` on real `Stop` fires while a fully populated rollout existed on disk.
  Resolve the transcript in preference order and only accept a path that parses
  as a real rollout:
  1. `session_id` — Codex embeds it in the rollout **filename**, so it needs no
     file reads to match. Most reliable anchor.
  2. stdin `transcript_path`, then `agent_transcript_path`.
  3. newest rollout in `~/.codex/sessions` as a last resort.

**Grok — `chat_history.jsonl`**
- Has a native `SessionEnd` event (unlike Codex). Parse `chat_history.jsonl`.
- Do not fall back to `CLAUDE_PROJECT_DIR` for cwd in a Grok script — it is a
  Claude Code var and won't be set.

### 2. Cap the payload before ingest

Open Brain `/ingest` embeds with **text-embedding-3-small (~8191-token limit)**.
Long sessions exceed it and `/ingest` returns HTTP 500.

- Cap the payload at ~**24000 chars** (`OB_CAPTURE_MAX_CHARS`).
- Truncate the **middle**, not the tail — preserve how the session opened and
  concluded, drop the middle with a marker (e.g. 60% head / 40% tail).

### 3. Know the two ingest gotchas

- **Oversized HTTP 500 still writes a row.** The endpoint upserts the row in
  **parallel** with the embedding call, so an embedding-failure 500 leaves an
  **embedding-less orphan row** that looks like a clean failure but isn't.
  Always verify by querying the DB, not just the HTTP status.
- **`/ingest` hardcodes `source_type=dashboard_ingest`,** so captures from
  different agents are **not** distinguishable by source at ingest time.

## Verification

- Tail the hook's log: `logs/ambient-capture*.log` should show
  `disposition=captured` (not `skipped:too_short`).
- Confirm `userTurns` matches the real turn count of a known session.
- For the size guard: feed an oversized session and confirm the payload is
  <24k chars and returns HTTP 200.
- **Ground-truth over config:** hooks load at session **start**, so a config or
  script change needs a `/hooks` reload or a fresh session before it takes
  effect. A "fixed" hook that was never reloaded is still running the old code.

## Example

Reference script assumed plaintext, matched 0 turns on every real Claude Code
transcript → always `skipped:too_short`. Rewriting `parseTranscript` to parse
JSONL (`type:user/assistant`, text blocks only, excluding `tool_result`-only
and `isSidechain` turns) produced a 16-turn parse and a successful capture.
An oversized session that had returned HTTP 500 (leaving an orphan row)
captured HTTP 200 once truncated to <24k chars.

## Notes

- Each agent's format drifts independently — re-verify against a fresh
  transcript when an agent updates, rather than assuming the parser still holds.
- The debugging lesson that generalizes: **trust the log/DB, not the config.**
  Silent no-op hooks and orphan rows only surfaced by inspecting ground truth.

## References

- OB1 repo: `skills/auto-capture-claude-code/session-end-capture.mjs`
  (Claude Code reference), `skills/auto-capture-codex/capture-codex-session.mjs`,
  `skills/auto-capture-grok/session-end-capture-grok.mjs`.
- PRs #388 (parser + size guard), #389 (Codex adapter), #390 (Grok adapter).
- Companion Open Brain memories: `open-brain-multi-agent-capture`,
  `open-brain-ingest-gotchas`.
