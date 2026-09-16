---
name: ob1-local-http
description: |
  Capture and search thoughts against a self-hosted Open Brain over plain
  HTTPS, with no MCP transport involved. Use this skill in environments
  where Claude Code's MCP feature is disabled or the network blocks remote
  MCP endpoints, but the brain stack from the companion `local-brain-no-mcp`
  recipe is reachable on the local network. Triggers: prompts like
  "remember this", "save that for later", "what did I note about X",
  "search my brain for Y", "what thoughts touched on Z", or any explicit
  request to record or recall personal memory.
author: dhanjit
version: 0.1.0
---

# OB1 Local HTTP

## Problem

The canonical Open Brain stack assumes Claude Code can talk to a remote
Supabase MCP server. In environments that disable MCP entirely -- corporate
networks, air-gapped offices, restricted Claude Code builds -- that path is
not available. This skill replaces it with `curl` calls to a LAN-resident
Open Brain (see the `local-brain-no-mcp` recipe), keeping the same
capture-and-recall behavior without any MCP protocol involvement.

## When to Use

- The user wants to remember, record, save, capture, or note something.
- The user wants to search, recall, retrieve, find, or look up something
  they previously captured.
- The user wants to see recent thoughts (e.g. "what have I been thinking
  about", "show me today's notes").

## When Not to Use

- The environment has a working remote Open Brain MCP connection -- prefer
  the canonical MCP-based capture/search tools.
- The required environment variables `BRAIN_URL` and `BRAIN_ANON_KEY` are
  not set on the dev host -- this skill cannot function without them; ask
  the user to follow `local-brain-no-mcp`'s install instructions first.

## Required Environment

On each dev host that will use this skill, the user must export:

```sh
export BRAIN_URL="http://<brain-host>:8000"   # Supabase Kong gateway
export BRAIN_ANON_KEY="eyJhbGciOi..."          # written by setup.sh
```

If either is missing, stop and tell the user. Do not guess values.

## Process

### Capture

When the user says something like "remember X" or "save this thought":

```sh
curl -fsS -X POST "$BRAIN_URL/functions/v1/capture" \
  -H "apikey: $BRAIN_ANON_KEY" \
  -H "Authorization: Bearer $BRAIN_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content":"<the thought>","metadata":{"source":"claude-code"}}'
```

Optional `metadata` fields: `source`, `tags` (array of strings),
`thread_id`, anything else useful. The server fingerprints content and
de-duplicates -- re-capturing identical text returns the existing id.

### Search

When the user wants to recall:

```sh
curl -fsS -X POST "$BRAIN_URL/functions/v1/search" \
  -H "apikey: $BRAIN_ANON_KEY" \
  -H "Authorization: Bearer $BRAIN_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"<what to find>","match_count":10,"match_threshold":0.65}'
```

`match_threshold` defaults to 0.7. Lower it to 0.5-0.65 for broader recall;
raise to 0.8+ for precision. Cap `match_count` at 100.

### Browse recent

When the user asks "what have I been thinking about" or wants a list rather
than a similarity search:

```sh
curl -fsS "$BRAIN_URL/functions/v1/list?limit=20" \
  -H "apikey: $BRAIN_ANON_KEY" \
  -H "Authorization: Bearer $BRAIN_ANON_KEY"
```

## Output

- For captures: confirm the id and the de-dupe fingerprint to the user in
  one sentence. Don't paraphrase the captured content back at them.
- For searches: surface the top results with similarity scores and
  created_at timestamps. Order by similarity descending. If no results
  cross the threshold, say so plainly and suggest lowering it.
- For browse: a compact bullet list with truncated content (first ~120
  chars) and timestamps.

## Failure Modes

- HTTP 502 with "unable to reach Ollama": the brain host's Ollama service
  is down. Tell the user to `docker compose ps` on the brain host.
- HTTP 502 with "did you 'ollama pull...'": the embedding model isn't
  loaded. Tell the user to run the documented `ollama pull` step.
- HTTP 502 with "embedding-dim mismatch": the brain's `EMBED_DIM` env was
  changed after the volume was initialized. Tell the user to read the
  "one-way door" section of `local-brain-no-mcp`'s README.
- HTTP 401 or 403: `BRAIN_ANON_KEY` is wrong or expired. Tell the user to
  check `supabase-docker/docker/.env` on the brain host.
- Network timeout: the brain host is unreachable. Tell the user to ping
  the brain host from this dev host.

## Notes

- Never log or echo `BRAIN_ANON_KEY` -- it's a long-lived JWT.
- This skill never installs or invokes any MCP server, by design.
- The brain host generates embeddings itself; this dev host doesn't need
  Ollama or any model files.
