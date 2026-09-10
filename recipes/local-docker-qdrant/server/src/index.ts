import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { PORT, MCP_ACCESS_KEY, EMBEDDING_MODEL } from "./config.js";
import { makeBedrock } from "./bedrock.js";
import * as qdrantClient from "./qdrant.js";
import { identityMiddleware, getIdentity } from "./identity.js";
import { registerCaptureHandler } from "./handlers/capture.js";
import { registerSearchHandler } from "./handlers/search.js";
import { registerListHandler } from "./handlers/list.js";
import { registerStatsHandler } from "./handlers/stats.js";
import { registerEnrichHandler } from "./handlers/enrich.js";
import { registerShareHandler } from "./handlers/share.js";
import { mountCaptureExternal } from "./rest/capture-external.js";
import { mountSearchExternal } from "./rest/search-external.js";

(async () => {
  // 1. Qdrant collection setup
  const t0 = Date.now();
  await qdrantClient.ensureCollection();
  console.log(`[qdrant] collection ready (${Date.now() - t0}ms)`);

  const t1 = Date.now();
  await qdrantClient.ensurePayloadIndexes();
  console.log(`[qdrant] payload indexes ready (${Date.now() - t1}ms)`);

  // 2. Bedrock health check — exit 1 on failure
  try {
    const cmd = new InvokeModelCommand({
      modelId: EMBEDDING_MODEL,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({ inputText: "startup health check", dimensions: 1024, normalize: true }),
    });
    await makeBedrock().send(cmd);
    console.log(`[bedrock] health check passed (profile: ${process.env.AWS_PROFILE || "default"})`);
  } catch (e) {
    console.error("FATAL: Bedrock health check failed:", (e as Error).message);
    process.exit(1);
  }

  // 3. Build Hono app
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
  };

  const app = new Hono();
  app.options("*", (c) => c.text("ok", 200, corsHeaders));

  // 4. Mount identity middleware globally (validates x-brain-key on all routes)
  app.use("*", identityMiddleware);

  // 5. Mount REST sidecars BEFORE the MCP catch-all
  mountCaptureExternal(app);
  mountSearchExternal(app);

  // 6. MCP catch-all — per-request McpServer with identity in closures
  app.all("*", async (c) => {
    const identity = getIdentity(c);

    const server = new McpServer({ name: "open-brain-qdrant", version: "1.0.0" });

    registerCaptureHandler(server, identity);
    registerSearchHandler(server, identity);
    registerListHandler(server, identity);
    registerStatsHandler(server, identity);
    registerEnrichHandler(server, identity);
    registerShareHandler(server, identity);

    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return transport.handleRequest(c);
  });

  // 7. Start server
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`Open Brain Qdrant MCP server running on port ${PORT}`);
  });
})();
