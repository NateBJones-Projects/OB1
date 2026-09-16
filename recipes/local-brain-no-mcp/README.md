# Local Brain (No MCP)

Self-hosted Open Brain on a single LAN host: the official Supabase docker-compose stack plus an Ollama sidecar for local embeddings and two Edge Functions (`capture`, `search`) wired up for OB1's `thoughts` schema. Reached from each dev host through `curl`, via the companion [`ob1-local-http`](../../skills/ob1-local-http/) skill -- no MCP transport involved.

## Why this exists (deliberate exception to canonical OB1)

The canonical OB1 architecture assumes (a) Claude Code can call a remote Supabase MCP server and (b) Supabase Cloud is reachable. This recipe is intentionally for environments where neither is true:

- **No third-party cloud reachable** -- the host can only talk to other LAN hosts. Supabase Cloud is off the table; everything runs on a single Linux box in the office.
- **MCP feature disabled in Claude Code** -- corporate policy or a locked-down build blocks Claude Code from speaking MCP at all (stdio or remote). The canonical capture/search tools therefore can't run.

So this recipe diverges from `CLAUDE.md`'s rule "MCP servers must be remote Supabase Edge Functions." It still uses Edge Functions, but exposes them as plain HTTPS endpoints -- not as MCP -- because the network won't let MCP through. The skill on each dev host calls those endpoints with `curl`. Cloud-shaped OB1 recipes that target PostgREST/Edge Functions still work locally with a base-URL swap; only the MCP transport is gone.

If your environment does NOT have these constraints, use the canonical cloud OB1 instead -- this recipe trades roughly 30 minutes of setup, ~3 GB RAM, and operational complexity for the air-gapped/no-MCP property.

## What you get

After setup, on one office Linux host:

- Postgres 15 with `pgvector` (HNSW index on a configurable embedding dim, default 768)
- The full Supabase stack (Kong gateway, PostgREST, GoTrue, Realtime, Storage, Studio, Edge Functions runtime, Logflare) -- canonical, unmodified, just self-hosted
- An `ollama` sidecar that the Edge Functions call for embedding generation -- dev hosts never need Ollama
- A `thoughts` table that mirrors the canonical OB1 schema exactly, plus `match_thoughts(...)` and `upsert_thought(...)` RPCs with the same signatures as cloud
- Three Edge Functions reachable through Kong:
  - `POST /functions/v1/capture` -- embed and store
  - `POST /functions/v1/search` -- embed query and run match_thoughts
  - `GET  /functions/v1/list` -- recent thoughts for browsing or downstream digest skills
- Supabase Studio at `http://<brain-host>:3000` -- your day-one read-only dashboard, free
- A `BRAIN_URL` + `BRAIN_ANON_KEY` pair that you paste into each dev host's environment for the [`ob1-local-http`](../../skills/ob1-local-http/) skill

## Prerequisites

On the **brain host** (one Linux box on the office network):

- Docker 24+ with Compose v2.20+ (`include:` directive required)
- `git`, `openssl`, `python3` (stdlib only -- no `pip install`)
- ~8 GB RAM available, ~5 GB disk for images and the embedding model
- Outbound HTTPS to GitHub and to the configured Docker registry, *one-time*, for the clone and image pulls
- A stable hostname or IP reachable from every dev host (e.g., `brain.local`)

On each **dev host**:

- `curl`
- Claude Code (or any skill-aware AI tool that reads `~/.claude/skills/`)

## Setup

> Run all of these on the **brain host**, from this directory (`recipes/local-brain-no-mcp/`).

1. Copy `.env.example` to `.env` and edit the overlay values if you want non-defaults. The important one is `EMBED_DIM` -- see the one-way door warning below before you change it.

   ```sh
   cp .env.example .env
   $EDITOR .env
   ```

2. Run the one-time setup. It clones `supabase/supabase`, generates secrets (POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, dashboard password, vault key, logflare tokens), writes them to `supabase-docker/docker/.env`, symlinks the Edge Functions into the supabase volume, and installs the SQL init scripts.

   ```sh
   ./setup.sh
   ```

   `setup.sh` is idempotent. Re-running preserves an existing `.env` so already-captured data stays accessible.

3. Bring up the stack.

   ```sh
   docker compose up -d
   docker compose ps
   ```

   First boot pulls ~3 GB of images and runs the Postgres init scripts (creating the `thoughts` table, indexes, RPCs).

4. Pull the embedding model into Ollama (one-time, model size depends on choice):

   ```sh
   docker compose exec ollama ollama pull "$(grep ^EMBED_MODEL supabase-docker/docker/.env | cut -d= -f2-)"
   ```

5. Verify reachability from the brain host itself:

   ```sh
   ANON_KEY="$(grep ^ANON_KEY supabase-docker/docker/.env | cut -d= -f2-)"
   curl -fsS -X POST "http://localhost:8000/functions/v1/capture" \
     -H "apikey: $ANON_KEY" \
     -H "Authorization: Bearer $ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"content":"first thought from setup.sh smoke test","metadata":{"source":"smoke-test"}}'
   ```

   Expected: HTTP 200 with `{"ok":true,"id":"...","fingerprint":"..."}`.

6. On each dev host, install [`ob1-local-http`](../../skills/ob1-local-http/) and export the two env vars `setup.sh` printed at the end. The skill takes over from there.

## Expected outcome

- Claude Code on any dev host can capture and search thoughts by asking in natural language ("remember X", "what did I note about Y") and the skill translates that into `curl` against the brain.
- The brain accumulates thoughts in `public.thoughts`, vector-indexed for similarity search.
- Supabase Studio at `http://<brain-host>:3000` lets you browse, edit, or delete rows manually.
- Nothing leaves the LAN.

## The embedding model is a one-way door

The `EMBED_DIM` env var is baked into the `embedding vector(N)` column when the Postgres volume is initialized. pgvector enforces this at insert time -- once the volume exists, **you cannot change `EMBED_DIM` without wiping the volume and losing all captured thoughts.**

What this means in practice:

- Pick `EMBED_MODEL` / `EMBED_DIM` once before first boot.
- If you must change them later:
  1. `docker compose down`
  2. Back up first (see below) if you want to migrate data
  3. `docker volume rm` the Postgres data volume (find it with `docker volume ls | grep db`)
  4. Edit `supabase-docker/docker/.env` to the new dim
  5. `docker compose up -d` -- Postgres re-runs the init scripts with the new dim
  6. Re-embed your backed-up content via the new model

The `embed.ts` helper does a dim check on every call and returns a clear error (`embedding-dim mismatch...`) if the model and the column disagree.

## Backup and restore

Stop the stack first, then snapshot the data volumes:

```sh
docker compose stop db
docker run --rm \
  -v "$(docker volume ls -q | grep _db-config):/from" \
  -v "$(pwd)/backups:/to" \
  alpine tar czf "/to/db-$(date +%F).tar.gz" -C /from .
docker compose start db
```

To restore: `docker compose down`, `docker volume rm` the db volume, recreate empty, untar into it, `docker compose up -d`.

## Troubleshooting

- **`docker compose` fails with `unknown field "include"`**: you're on Compose < 2.20. Upgrade Docker Desktop or install a current `docker compose` plugin.
- **`functions` service exits with module-resolution errors against `_shared/*.ts`**: the symlinks didn't take. Check `ls -la supabase-docker/docker/volumes/functions/` -- you should see `capture`, `search`, `list`, `_shared` as symlinks pointing back at this recipe. Re-run `./setup.sh`.
- **`embed.ts: did you 'ollama pull <model>'?`**: you skipped step 4. Run the `ollama pull` line.
- **`embed.ts: embedding-dim mismatch`**: someone changed `EMBED_DIM` in `.env` after the volume was initialized. Either revert the env or follow the one-way-door procedure above.
- **HTTP 401 from Kong**: `ANON_KEY` in `.env` and the one your dev host is using are out of sync. Re-export from `supabase-docker/docker/.env`.
- **Dev host can't reach `http://<brain-host>:8000`**: confirm the brain host's firewall allows `KONG_HTTP_PORT` inbound on the office network and that the hostname resolves.

## Related

- [`skills/ob1-local-http`](../../skills/ob1-local-http/) -- the companion skill pack that runs on each dev host
- [`docs/drafts/agent-memory-staging-base.sql`](../../docs/drafts/agent-memory-staging-base.sql) -- the canonical thoughts schema this recipe mirrors
- [`server/index.ts`](../../server/index.ts) -- the canonical MCP server this recipe deliberately does NOT use as a transport
