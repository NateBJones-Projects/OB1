import { test } from "node:test";
import assert from "node:assert/strict";
import { options, MemoryClient } from "../dist/client.js";
import { clip, tail, renderRecall, parseCheckpoint, unsafe } from "../dist/memory.js";

const config = () => options({ endpoint: "http://localhost:8000/functions/v1/agent-memory-api", workspaceId: "test" }, {});
export const memory = (id, overrides = {}) => ({
  memory_id: id, content: "Use a wrapping unsigned timer.", summary: "Timer convention",
  scope: { workspace_id: "test", project_id: "opencode:project-a" },
  use_policy: { can_use_as_instruction: false, can_use_as_evidence: true, requires_user_confirmation: false },
  ...overrides,
});
test("policy and project boundaries are enforced locally", () => {
  const memories = [memory("yes"), memory("other", { scope: { workspace_id: "test", project_id: "project-b" } }),
    memory("pending", { use_policy: { can_use_as_evidence: true, requires_user_confirmation: true } }),
    memory("missing", { use_policy: {} })];
  const r = renderRecall({ request_id: "trace", memories }, "test", "opencode:project-a", 3, 6000);
  assert.deepEqual(r.memoryIds, ["yes"]);
  assert.equal(r.ignored.length, 3);
  assert.match(r.text, /evidence only/);
});
test("hard byte budget includes JSON and policy overhead, including non-ASCII text", () => {
  const memories = Array.from({ length: 10 }, (_, i) => memory(String(i), { content: "界🙂".repeat(5000) }));
  const r = renderRecall({ request_id: "trace", memories }, "test", "opencode:project-a", 3, 1500);
  assert.ok(Buffer.byteLength(r.text) <= 1500);
  assert.ok(r.memoryIds.length <= 3);
  assert.equal(clip("🙂界a", 7), "🙂界");
  assert.equal(tail("old🙂界a", 8), "🙂界a");
});
test("checkpoint accepts compact categories but rejects code, credentials, unknown fields and oversize", () => {
  assert.deepEqual(parseCheckpoint('{"decisions":["Use Postgres"]}').decisions, ["Use Postgres"]);
  for (const value of ['null', '[]', '"invalid"', '{"transcript":"raw"}', '{"outputs":["```code```"]}', '{"outputs":["password=example-value"]}',
    JSON.stringify({ outputs: ["a".repeat(601)] }), JSON.stringify({ outputs: Array(11).fill("one") })])
    assert.throws(() => parseCheckpoint(value));
  assert.equal(unsafe("private timer variable"), false);
});
test("configuration rejects accidental capture, unsafe URL and invalid bounds", () => {
  assert.equal(config().autoCapture, false);
  for (const extra of [{ autoCapture: "false" }, { maxItems: 100 }, { endpoint: "https://host/api?key=example" },
    { endpoint: "http://remote.example/api" }, { endpoint: "file:///tmp/test" }])
    assert.throws(() => options({ endpoint: "https://host/api", workspaceId: "test", ...extra }, {}));
});
test("HTTP client blocks redirects and bounds errors without reflecting private response content", async () => {
  process.env.OB1_TEST_KEY = "test-only-key";
  const c = config(); c.keyEnv = "OB1_TEST_KEY";
  const client = new MemoryClient(c, async (_url, init) => {
    assert.equal(init.redirect, "error");
    assert.equal(init.headers["x-brain-key"], "test-only-key");
    return new Response("private backend diagnostic", { status: 403 });
  });
  await assert.rejects(client.post("/recall", {}), e => e.message === "OB1 HTTP 403");
  const oversized = new MemoryClient(c, async () => new Response("x".repeat(1_048_577)));
  await assert.rejects(oversized.post("/recall", {}), /too large/);
  delete process.env.OB1_TEST_KEY;
});
