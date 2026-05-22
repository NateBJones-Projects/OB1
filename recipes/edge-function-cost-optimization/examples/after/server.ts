// ✅ Module-scope McpServer singleton — constructed exactly ONCE per cold-start.
//
// Each tool module exports a `register(server)` function called once at module
// load. Adding a new extension means: drop a new file in `tools/`, add one
// import, add one `register()` call. No per-request reconstruction.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as registerOpenBrain } from "./tools/open-brain.ts";
import { register as registerHousehold } from "./tools/household.ts";
import { register as registerMeal } from "./tools/meal.ts";
import { register as registerCrm } from "./tools/crm.ts";

export const server = new McpServer({
  name: "open-brain-unified",
  version: "2.0.0",
});

registerOpenBrain(server);
registerHousehold(server);
registerMeal(server);
registerCrm(server);
