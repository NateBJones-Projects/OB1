# Open Brain Capture-Hook Authoring

> Authoring and debugging guide for session-end auto-capture hooks that ship an AI CLI transcript to Open Brain.

## What It Does

Codifies the hard-won knowledge for building and debugging session-end capture
hooks — the per-agent transcript formats and the Open Brain ingest limits that
make these hooks fail **silently** (logging `skipped:too_short` / `turns=0`
while capturing nothing). It complements the `auto-capture-*` reference
implementations: those are install recipes, this is the authoring/debugging
layer that explains *why* they are shaped the way they are and *what fails
silently* when they aren't.

## Supported Clients

- Claude Code (JSONL transcripts)
- Codex (rollout JSONL, no `SessionEnd` event)
- Grok (native `SessionEnd`, `chat_history.jsonl`)

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- An AI client whose session-end hook writes a transcript you can parse
- Node.js 18+ for the reference hook scripts

## Installation

1. Copy `SKILL.md` into the right folder for your client (e.g.
   `~/.claude/skills/open-brain-capture-hook-authoring/SKILL.md`)
2. Restart or reload the client so it picks up the new skill
3. It fires automatically on the trigger conditions below

## Trigger Conditions

- A capture hook logs `disposition=skipped:too_short` or `turns=0` after a real,
  multi-turn session
- Writing a new `Stop` / `SessionEnd` hook that parses a Claude Code, Codex, or
  Grok transcript
- `/ingest` (or the smart-ingest edge function) returns HTTP 500 on long sessions
- A row appears in the `thoughts` table with a null embedding

## Expected Outcome

You correctly parse each agent's real transcript format (not the assumed
plaintext one), cap the payload under the embedding token limit, and recognize
the two ingest gotchas — so the hook logs `disposition=captured` instead of
silently skipping.

## Troubleshooting

**Issue: Hook always logs `skipped:too_short` (turns=0) after a long session**
Solution: The parser assumes plaintext `Human:/Assistant:` but the transcript is
JSONL. Parse the JSONL: Claude Code uses `type:user/assistant` with a `message`
object; take only `text` content blocks; skip `tool_result`-only user lines and
`isSidechain` (subagent) turns.

**Issue: Codex `Stop` fires with `session=unknown, turns=0` but a rollout exists**
Solution: Codex's stdin `transcript_path` is unreliable. Resolve the rollout by
the `session_id` embedded in the filename under `~/.codex/sessions`, and only
accept a path that parses as a real rollout.

**Issue: `/ingest` returns HTTP 500 on long sessions**
Solution: `/ingest` embeds with text-embedding-3-small (~8191-token limit). Cap
the payload at ~24k chars, truncating the middle so the start and end survive.
Note the 500 still upserts an embedding-less orphan row — verify via the DB, not
just the HTTP status.

## Notes for Other Clients

Each agent's transcript format drifts independently — re-verify against a fresh
transcript when a client updates rather than assuming the parser still holds.
The generalizable debugging lesson: trust the log/DB, not the config. Hooks load
at session start, so a "fixed" hook that was never reloaded is still running the
old code.
