# Edge Function Cost Optimization

> Cuts Supabase Edge Function invocations ~73% by consolidating MCP servers, adding session reuse, and caching hot paths. Stays on the free tier (500K/month).

## The Problem

Open Brain extensions are deployed as separate Supabase Edge Functions — one per extension (`open-brain-mcp`, `household-knowledge-mcp`, `meal-planning-mcp`, `professional-crm-mcp`, …). This is the architecture mandated by [`CLAUDE.md`](../../CLAUDE.md), and it works — but at scale it blows through the **500,000 invocations/month** Supabase free tier surprisingly fast.

Real measurement: an organization running these four extensions hit **1,835,479 invocations in 7 days** — 3.3× the monthly quota — without any unusual workload. The repo had no recipe addressing this. This recipe fills that gap.

### Where the invocations actually go

The MCP `StreamableHTTPTransport` is **stateless** in its default configuration. Every "tool call" the user sees in Claude is actually 4 HTTP requests under the hood:

| MCP request | Purpose | Counts as invocation |
|---|---|---|
| `initialize` | Handshake | ✅ |
| `notifications/initialized` | Ack | ✅ |
| `tools/list` | Enumerate tools | ✅ |
| `tools/call` | Run the tool | ✅ |

Multiply that by **4 connectors** at session startup → **16 invocations** before the user has done anything useful. Add the per-request `McpServer` reconstruction in 3 of 4 functions and the missing OPTIONS handlers (which don't bill themselves but cause client retries that DO bill), and you have a free-tier-burning machine.

## The Three Fixes

### 1. Consolidate N edge functions into 1

Tools are uniquely named across extensions. There's no technical reason they need separate functions — splitting them only multiplies the per-session handshake cost. One Hono app + one `McpServer` + N `register(server)` calls covers all extensions and exposes them via a single connector URL.

```
4 connectors × 4-step handshake = 16 invocations per session start
1 connector  × 4-step handshake =  4 invocations per session start
                                   ─────────────
                                   75% reduction at startup alone
```

### 2. Mcp-Session-Id reuse

The MCP spec includes a `Mcp-Session-Id` header for stateful sessions, but `@hono/mcp`'s `StreamableHTTPTransport` doesn't issue or honor one by default. Add a tiny module-scope `Map<sid, Session>`:

- First request from a client → mint a UUID, create a `StreamableHTTPTransport`, `await server.connect(transport)`, return `Mcp-Session-Id` in the response
- Subsequent requests with the same header → reuse the warm transport
- 30-min TTL with opportunistic sweep

Edge Function isolates stay warm for minutes-to-hours under steady traffic. With session reuse, **10 sequential tool calls collapse from ~13 invocations down to ~10** — and on a fully warm session, 1 user-visible tool call = 1 HTTP invocation.

### 3. Cache hot read paths + fix `thought_stats`

Three things bloat per-call cost:

| Issue | Fix |
|---|---|
| `thought_stats` selects every row of `thoughts` to count metadata in JS | New `thought_stats_summary()` SQL RPC — single aggregation query |
| Same query embedded multiple times during a search session | 10-min cache keyed by SHA-256 of query text |
| `capture_thought` inserts content, then runs a separate `UPDATE` to set the embedding | New 3-arg `upsert_thought(text, jsonb, vector)` overload writes both in one round-trip |

Plus a moderate cache layer with tag-based invalidation: `thought_stats` (5 min, invalidated on `capture_thought`), `list_vendors` no-filter (5 min, invalidated on `add_vendor`), `get_follow_ups_due` (5 min, invalidated on `log_interaction` / `create_opportunity`).

## Measured Impact

| Metric | Before | After (projected) |
|---|---|---|
| Monthly invocations | 1,835,479 | ~440,000 |
| Edge functions deployed | 4 | 1 (+ 3 410 Gone stubs for 2 weeks) |
| Connectors in Claude Desktop | 4 | 1 |
| Invocations per "open Claude" | ~16 | ~4 (drops to 1 after warm session) |
| `thought_stats` data transferred | full table scan | single aggregated row |

Free tier: **500,000/month**. This recipe brings a 1.8M/month workload comfortably under the cap.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Supabase CLI installed and linked to your project
- Multiple MCP edge functions deployed (this recipe consolidates them)

## Step-by-Step Guide

### Step 1 — Apply the SQL migrations

In the Supabase SQL Editor, paste and run [`migrations/20260417_edge_fn_optimizations.sql`](./migrations/20260417_edge_fn_optimizations.sql). It's additive (no schema changes) and creates two functions:

- `thought_stats_summary()` — single-query aggregation replacing the JS loop
- `upsert_thought(text, jsonb, vector)` — 3-arg overload that stores embedding in one round-trip (the existing 2-arg signature continues to work)

### Step 2 — Restructure your edge function

Convert your N MCP functions into **one** function with the structure shown in [`examples/after/`](./examples/after/):

```
supabase/functions/open-brain-mcp/
  index.ts            # Hono app, auth, CORS, session map, transport wiring
  server.ts           # module-scope McpServer; calls register() per tool module
  lib/
    cache.ts          # TTL Map with tag-based invalidation
    supabase.ts       # createClient() singleton
    embeddings.ts     # getEmbedding() + 10-min cache
    metadata.ts       # extractMetadata() (LLM call)
  tools/
    <extension-1>.ts  # exports register(server)
    <extension-2>.ts
    ...
```

Each extension's tools live in their own module, exporting a `register(server)` function called once at module load. **Move tool implementations verbatim** from the old per-extension files; only the wrapper changes.

### Step 3 — Add session reuse to `index.ts`

The minimal pattern (full version in [`examples/after/index.ts`](./examples/after/index.ts)):

```ts
type Session = { transport: StreamableHTTPTransport; lastSeen: number };
const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 30 * 60 * 1000;

app.all("*", async (c) => {
  // ... auth check first ...

  const sid = c.req.header("mcp-session-id") || undefined;
  let session = sid ? sessions.get(sid) : undefined;
  let id = sid;

  if (!session) {
    id = crypto.randomUUID();
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    session = { transport, lastSeen: Date.now() };
    sessions.set(id, session);
  } else {
    session.lastSeen = Date.now();
  }

  c.header("Mcp-Session-Id", id!);
  return session.transport.handleRequest(c);
});
```

Don't forget `Access-Control-Expose-Headers: mcp-session-id` in your CORS config — without it, browser clients can't read the session ID off the response.

### Step 4 — Stub the deprecated functions

Replace the `index.ts` of each consolidated extension with a tiny HTTP 410 Gone handler (see [`examples/after/410-stub.ts`](./examples/after/410-stub.ts)). This tells reconfigured clients exactly where to point. After 2 weeks, run `supabase functions delete <name>` to remove them entirely.

### Step 5 — Deploy

```bash
supabase functions deploy open-brain-mcp
supabase functions deploy household-knowledge-mcp  # the 410 stub
supabase functions deploy meal-planning-mcp        # the 410 stub
supabase functions deploy professional-crm-mcp     # the 410 stub
```

### Step 6 — Reconfigure Claude Desktop

In Claude Desktop → Settings → Connectors:

1. **Delete** the old connectors (one per extension)
2. **Add** a single new connector pointing to:
   ```
   https://<your-project-ref>.supabase.co/functions/v1/open-brain-mcp?key=<MCP_ACCESS_KEY>
   ```
3. Restart Claude Desktop. All your tools (now from a single server) appear in the tools panel.

### Step 7 — Verify the savings

Check the [Supabase Usage Dashboard](https://supabase.com/dashboard/project/_/usage) at 24h and 7d intervals:

- Daily rate should drop **~75%** within 24h
- Monthly projection should fit comfortably under 500K

If the rate is still high after 24h, check per-function logs to find which tool dominates and add it to the cache layer.

## Architecture Notes

### Why session reuse works on Edge Functions

Supabase Edge Functions run in Deno isolates. Under steady traffic an isolate stays warm anywhere from minutes to hours; cold starts are measured in tens of milliseconds. Module-scope state (like the `Map<sid, Session>`) survives the entire warm window. When the isolate eventually recycles, the next request mints a new session ID transparently — Claude Desktop silently re-initializes and continues. Zero behavior change to the user.

### Why CORS needs `Expose-Headers`

Browser-based MCP clients (Claude Desktop, claude.ai web) treat `Mcp-Session-Id` as a custom response header. The browser hides custom headers from JavaScript unless `Access-Control-Expose-Headers` lists them. Without this, the client never sees the session ID and falls back to stateless mode — defeating the entire optimization.

### Why we use a unique-content fingerprint, not the SHA-256 of the request

The new `upsert_thought(text, jsonb, vector)` RPC computes the same `content_fingerprint` as the original 2-arg version (lower-trim-collapse-whitespace + SHA-256 hex). This keeps the fingerprint dedup behavior identical and means the new RPC is a drop-in replacement.

## Troubleshooting

**Issue: Claude Desktop doesn't seem to reuse sessions**
Check the response headers: the `Mcp-Session-Id` header must be present AND your CORS config must include `Access-Control-Expose-Headers: mcp-session-id`. Without the expose header, browsers strip custom headers from the JavaScript-visible response.

**Issue: Old connector URLs still work**
If you skipped Step 4 (the 410 stubs), the old per-extension functions continue to serve traffic. Run `supabase functions deploy <name>` for each stubbed function. After confirming everything works on the unified URL for ~2 weeks, run `supabase functions delete <name>` to remove the stubs entirely.

**Issue: `thought_stats` returns stale data**
Default cache TTL is 5 min, invalidated on `capture_thought`. If a write isn't reflected, check that `capture_thought` is calling `invalidate("thoughts")` after the upsert. Cross-isolate invalidation isn't possible (each warm isolate has its own cache), but TTL bounds staleness to 5 min worst case.

**Issue: Type errors after restructuring**
Run `deno check` from inside `supabase/functions/<name>/` to validate. Common gotcha: `import` paths in Deno must include the `.ts` extension.

## Works Well With

- **[Content Fingerprint Dedup](../content-fingerprint-dedup/)** — the new `upsert_thought(text, jsonb, vector)` overload preserves fingerprint behavior
- **[Fingerprint Dedup Backfill](../fingerprint-dedup-backfill/)** — run before this recipe to clean up duplicates
- Any future extensions: add their tools to the unified server instead of deploying a separate function

## Further Reading

- [Supabase Edge Function pricing](https://supabase.com/docs/guides/functions/pricing)
- [Supabase Fair Use Policy](https://supabase.com/docs/guides/platform/billing-faq#fair-use-policy)
- [MCP Streamable HTTP transport spec](https://spec.modelcontextprotocol.io/specification/basic/transports/#streamable-http) (session ID header)
- [Supabase MCP guidance](https://supabase.com/docs/guides/getting-started/byo-mcp)
