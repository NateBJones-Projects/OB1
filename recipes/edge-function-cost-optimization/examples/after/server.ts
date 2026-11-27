// ✅ One McpServer per MCP session, built by buildServer().
//
// Each tool module exports a `register(server)` function. Adding a new
// extension means: drop a new file in `tools/`, add one import, add one
// `register()` call. index.ts calls buildServer() once when it mints a session
// and keeps the server with that session's transport, so a warm session never
// rebuilds it.
//
// Not a module-scope singleton: McpServer.connect() hands the server to the
// newest transport, so once a second client opens a session every response
// for the first client's session goes to the second transport, and the first
// client's requests hang.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as registerOpenBrain } from "./tools/open-brain.ts";
import { register as registerHousehold } from "./tools/household.ts";
import { register as registerMeal } from "./tools/meal.ts";
import { register as registerCrm } from "./tools/crm.ts";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "open-brain-unified",
    version: "2.0.0",
  });

  registerOpenBrain(server);
  registerHousehold(server);
  registerMeal(server);
  registerCrm(server);

  return server;
}
