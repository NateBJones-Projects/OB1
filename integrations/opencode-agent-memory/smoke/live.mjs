// Read-only live acceptance check: no memories are created or changed.
import assert from "node:assert/strict";
import { options, MemoryClient } from "../dist/client.js";
import { renderRecall } from "../dist/memory.js";

const config = options({
  allowInsecureHttp: process.env.OB1_SMOKE_ALLOW_HTTP === "1",
  timeoutMs: 30000,
});
const project = process.env.OB1_SMOKE_PROJECT_ID ?? "opencode-read-only-smoke";
const result = await new MemoryClient(config).post("/recall", {
  schema_version: "openbrain.agent_memory.recall.v1",
  workspace_id: config.workspaceId, project_id: project,
  runtime: { name: "opencode", version: "2.2.5" },
  query: "OpenCode integration connectivity check",
  scope: { project_only: true, include_unconfirmed: false },
  limits: { max_items: config.maxItems, max_tokens: config.maxTokens },
});
const rendered = renderRecall(result, config.workspaceId, project, config.maxItems, config.maxContextBytes);
assert.ok(rendered.requestId);
console.log(JSON.stringify({ ok: true, request_id: rendered.requestId,
  injected_items: rendered.memoryIds.length, context_bytes: Buffer.byteLength(rendered.text), writes: 0 }));
