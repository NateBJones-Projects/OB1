import { Hono } from "hono";
import type { Env } from "../lib/types";
import { fail } from "../lib/responses";

// /ingest and /ingestion-jobs/* are P2 endpoints used by the dashboard's
// "Add to Brain" smart-extraction flow. The upstream repo doesn't ship a
// smart-ingest integration yet, so we stub these conservatively:
//
//   GET  /ingestion-jobs              → empty list (the Ingest page renders
//                                       a clean empty state when no jobs
//                                       exist, so this is non-disruptive)
//   POST /ingest                      → 501 Not Implemented
//   GET  /ingestion-jobs/:id          → 404
//   POST /ingestion-jobs/:id/execute  → 501 Not Implemented
//
// A future PR can replace these with real implementations once a
// smart-ingest integration lands upstream.
export const ingestionJobs = new Hono<{ Bindings: Env }>();

ingestionJobs.get("/ingestion-jobs", (c) => {
  return c.json({ jobs: [], count: 0 });
});

ingestionJobs.get("/ingestion-jobs/:id", (c) =>
  fail(
    c,
    404,
    "Ingestion job not found (smart-ingest integration not deployed)",
  ),
);

ingestionJobs.post("/ingestion-jobs/:id/execute", (c) =>
  fail(
    c,
    501,
    "Smart-ingest not implemented in this Worker. See the integration's README under 'Known limitations'.",
  ),
);

ingestionJobs.post("/ingest", (c) =>
  fail(
    c,
    501,
    "Smart-ingest not implemented in this Worker. Use /capture for single-thought writes.",
  ),
);
