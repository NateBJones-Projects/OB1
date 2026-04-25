/**
 * open-brain-rest — Cloudflare Worker REST gateway.
 *
 * Backs the Next.js dashboard at dashboards/open-brain-dashboard-next/ by
 * implementing the endpoints its lib/api.ts expects. Reads from / writes to
 * the existing Open Brain Supabase schema using the service-role key.
 *
 * Tech: Hono on Cloudflare Workers. Auth: x-brain-key (or Authorization:
 * Bearer / ?key=) — same shared secret used by open-brain-mcp.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { health } from "./routes/health";
import { thoughts } from "./routes/thoughts";
import { search } from "./routes/search";
import { stats } from "./routes/stats";
import { capture } from "./routes/capture";
import { ingestionJobs } from "./routes/ingestion-jobs";
import { requireApiKey } from "./lib/auth";
import type { Env } from "./lib/types";

const app = new Hono<{ Bindings: Env }>();

// Open CORS — the dashboard's server-side fetches don't need it (they go
// from Worker to Worker), but local development hits the Worker directly
// from the browser via curl/devtools, and other clients (e.g. Insomnia)
// also benefit. Allow the headers we actually accept; reject by default
// at the auth layer instead.
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-brain-key"],
    maxAge: 86400,
  }),
);

// Mount /health pre-auth. The dashboard's login validates the API URL with
// an unauthenticated GET, then makes a second authenticated call to confirm
// the key — so /health must respond regardless of credentials.
app.route("/", health);

// Everything below this point requires a valid x-brain-key.
app.use("*", requireApiKey);

app.route("/", thoughts);
app.route("/", search);
app.route("/", stats);
app.route("/", capture);
app.route("/", ingestionJobs);

// Catch-all: anything unmatched returns 404. Hono's default is 200 with an
// empty body, which is more confusing than a clear miss.
app.notFound((c) => c.json({ error: "Not Found" }, 404));

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: err.message || "Internal error" }, 500);
});

export default app;
