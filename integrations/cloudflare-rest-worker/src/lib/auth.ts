import type { MiddlewareHandler } from "hono";
import type { Env } from "./types";

// Three accepted auth shapes, matching the rest of the OB1 ecosystem
// (open-brain-mcp, entity-extraction-worker):
//   1. `x-brain-key: <value>` header
//   2. `Authorization: Bearer <value>`
//   3. `?key=<value>` query param (last resort — discouraged because the
//      key lands in proxy logs and Referer headers, but supported for
//      parity with existing patterns)
export function readClientKey(req: Request): string {
  const headerKey = req.headers.get("x-brain-key")?.trim();
  if (headerKey) return headerKey;

  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();

  return new URL(req.url).searchParams.get("key")?.trim() ?? "";
}

// Auth middleware. Mounted at the app level after the /health pass-through.
// Constant-time compare isn't strictly necessary against an opaque shared
// secret over TLS — tcompare with === works fine for our threat model — but
// we still avoid logging the comparison values.
export const requireApiKey: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const expected = c.env.MCP_ACCESS_KEY;
  if (!expected) {
    // Misconfiguration — refuse all requests instead of silently allowing.
    console.error("MCP_ACCESS_KEY is not set on the Worker.");
    return c.json({ error: "Server misconfigured" }, 500);
  }
  const provided = readClientKey(c.req.raw);
  if (!provided || provided !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};
