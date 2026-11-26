import { McpServer } from "npm:@modelcontextprotocol/sdk@1.24.3/server/mcp.js";
import { z } from "npm:zod@4.1.13";
import type { Deps } from "./types.ts";

type ToolReply = { content: { type: "text"; text: string }[]; isError?: boolean };

const notYet = (): Promise<ToolReply> => Promise.resolve({ content: [{ type: "text", text: "not implemented" }] });

export function buildServer(_deps: Deps): McpServer {
  const server = new McpServer({ name: "open-brain", version: "1.0.0" });
  server.registerTool("search", { inputSchema: { query: z.string() } }, notYet);
  server.registerTool("fetch", { inputSchema: { id: z.string() } }, notYet);
  server.registerTool("search_thoughts", { inputSchema: { query: z.string() } }, notYet);
  server.registerTool("list_thoughts", { inputSchema: {} }, notYet);
  server.registerTool("thought_stats", { inputSchema: {} }, notYet);
  server.registerTool("capture_thought", { inputSchema: { content: z.string() } }, notYet);
  return server;
}
