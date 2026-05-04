# Xenith Bulk Import

> Import Google Docs exports, meeting transcripts, pasted text batches, and
> Slack messages into the Xenith Open Brain while preserving the original
> meeting or message date.

## What It Does

This recipe adds a local Deno importer that sends source material through the
existing `rvt-brain` MCP tools. It preserves source references and original
event dates by passing `event_at` and `source_ref` into `capture_transcript`, so
imported thoughts land in the Xenith timeline when the meeting/message happened,
not just when you imported it.

## Prerequisites

- Local `rvt-brain` MCP server running at `http://localhost:8000/`.
- `server/.env.xenith.local` filled in with Supabase, Anthropic, and MCP values.
- Ollama running with `qwen3-embedding:4b`.
- For Slack imports only: a Slack bot token with `channels:history` or
  `groups:history`, depending on channel type.

## Supported Sources

- `.txt`, `.md`, `.vtt`, and `.srt` files from transcripts or Google Docs
  exports.
- Manifest JSON entries for pasted text, exported docs, or Google Doc URLs with
  copied text.
- Slack messages fetched via `conversations.history`.

Live Google Docs links are not fetched directly yet. Export the doc as `.txt` or
`.md`, or create a manifest entry with the copied text and original URL.

## Date Preservation

The importer looks for original dates in this order:

1. Manifest field: `event_at` or `date`
2. Filename, such as `2026-04-21 Xenith Standup.txt`
3. Top of the file, such as `Date: April 21, 2026`
4. Slack message timestamp from the Slack API

The extracted date is passed as `event_at`. The database `created_at` still
records import/capture time, while `metadata.event_at` records when the original
meeting/message happened.

## File Import

Put files anywhere local, then dry-run first:

```bash
deno run --config server/deno.json \
  --allow-env --allow-net --allow-read \
  --env-file=server/.env.xenith.local \
  recipes/xenith-bulk-import/import-xenith-bulk.ts \
  --path imports/xenith/inbox \
  --dry-run
```

Live import:

```bash
deno run --config server/deno.json \
  --allow-env --allow-net --allow-read \
  --env-file=server/.env.xenith.local \
  recipes/xenith-bulk-import/import-xenith-bulk.ts \
  --path imports/xenith/inbox
```

## Manifest Import

Use a JSON file when you want to preserve Google Doc URLs or paste text
directly:

```json
[
  {
    "title": "Xenith exec sync",
    "date": "2026-04-21",
    "url": "https://docs.google.com/document/d/...",
    "source": "google_docs",
    "source_ref": "Xenith exec sync Google Doc",
    "text": "Paste exported or copied document text here"
  }
]
```

Run:

```bash
deno run --config server/deno.json \
  --allow-env --allow-net --allow-read \
  --env-file=server/.env.xenith.local \
  recipes/xenith-bulk-import/import-xenith-bulk.ts \
  --manifest imports/xenith/manifest.json
```

## Slack Import

Set your Slack bot token locally. Do not commit it.

```bash
export SLACK_BOT_TOKEN=xoxb-your-token
```

Dry-run a channel:

```bash
deno run --config server/deno.json \
  --allow-env --allow-net --allow-read \
  --env-file=server/.env.xenith.local \
  recipes/xenith-bulk-import/import-xenith-bulk.ts \
  --slack-channel C0123456789 \
  --after 2026-04-01 \
  --dry-run
```

Live import:

```bash
deno run --config server/deno.json \
  --allow-env --allow-net --allow-read \
  --env-file=server/.env.xenith.local \
  recipes/xenith-bulk-import/import-xenith-bulk.ts \
  --slack-channel C0123456789 \
  --after 2026-04-01
```

## Expected Outcome

Each source item is decomposed by Anthropic into atomic Xenith thoughts,
embedded locally through Ollama, and routed through the same confidence
thresholds as live capture:

- `confidence >= 0.85`: stored in `thoughts`
- `0.70 <= confidence < 0.85`: stored in `thoughts` with
  `metadata.needs_review = true`
- `confidence < 0.70`: routed to `thoughts_pending`

## Troubleshooting

**Issue: dates are missing**\
Solution: Add `YYYY-MM-DD` to the filename or add `date` / `event_at` in a
manifest entry.

**Issue: live Google Doc URLs are skipped**\
Solution: Export the docs to `.txt` / `.md`, or paste the doc text into a
manifest entry. Direct Google Drive auth is intentionally not part of this first
importer.

**Issue: Slack returns `missing_scope` or `not_in_channel`**\
Solution: Invite the bot to the channel and add the right history scope for
public or private channels.
