import { Hono } from "hono";
import type { Env } from "../lib/types";

// Pre-auth route. The dashboard hits /health on login to validate that the
// API URL is reachable AND that the key the user pasted works — so /health
// itself stays open, but the dashboard's login-side flow then calls another
// authed endpoint to confirm the key. Returning bare {status:"ok"} matches
// the pattern other Open Brain functions use.
export const health = new Hono<{ Bindings: Env }>();

health.get("/health", (c) =>
  c.json({ status: "ok", service: "open-brain-rest", version: "0.1.0" }),
);
