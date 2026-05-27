import type { Hono } from "hono";
import type { Context } from "hono";
import { getIdentity } from "../identity.js";
import { captureThought } from "../handlers/capture.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

export function mountCaptureExternal(app: Hono): void {
  app.post("/capture-external", async (c: Context) => {
    const identity = getIdentity(c);

    let body: {
      content?: string;
      source?: string;
      title?: string;
      url?: string;
      visibility?: "private" | "shared";
    };

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400, corsHeaders);
    }

    if (!body.content || body.content.trim() === "") {
      return c.json({ error: "content is required" }, 400, corsHeaders);
    }

    try {
      const { id, type, topics } = await captureThought(
        body.content.trim(),
        identity,
        {
          source: body.source,
          title: body.title,
          url: body.url,
          visibility: body.visibility,
        }
      );
      return c.json({ id, type, topics }, 200, corsHeaders);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500, corsHeaders);
    }
  });
}
