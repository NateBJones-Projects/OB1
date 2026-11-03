import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "../dist/index.js";

function harness(extra = {}) {
  const hooks = {}, calls = [], storage = new Map(), queue = [];
  let wake;
  const session = { id: "ses_a", projectID: "project-a", location: { directory: "/project-a" },
    model: { id: "test-model", providerID: "local" }, outcome: "succeeded" };
  const ctx = {
    options: { endpoint: "http://localhost:8000/api", workspaceId: "test", keyEnv: "OB1_TEST_KEY", ...extra },
    app: { version: "2.2.5" }, location: { directory: "/project-a", project: { id: "project-a" } },
    session: {
      get: async ({ sessionID }) => ({ ...session, id: sessionID }),
      hook: async (name, fn) => { hooks[name] = fn; return { dispose: async () => delete hooks[name] }; },
      context: async () => [{ type: "user", text: "Use unsigned timers." }, { type: "assistant", content: [
        { type: "text", text: "The timer fix is verified." }, { type: "reasoning", text: "SECRET REASONING" },
        { type: "tool", state: { output: "SECRET TOOL OUTPUT" } }] }],
    },
    storage: { get: async k => storage.get(k), set: async (k, v) => storage.set(k, v) },
    experimental: { generate: { text: async ({ prompt }) => {
      calls.push({ generation: prompt });
      return { text: '{"decisions":["Use unsigned subtraction for timers."]}' };
    } } },
    event: { subscribe: async function* ({ signal }) {
      signal.addEventListener("abort", () => wake?.(), { once: true });
      while (!signal.aborted) {
        if (!queue.length) await new Promise(r => wake = r);
        while (queue.length) yield queue.shift();
      }
    } },
  };
  const request = (text = "What timer convention applies?") => ({ sessionID: "ses_a", model: session.model, system: [],
    messages: [{ role: "user", content: [{ type: "text", text }] }], options: {}, tools: {} });
  return { ctx, hooks, calls, storage, session, request, emit: event => { queue.push(event); wake?.(); } };
}
const recalled = { request_id: "trace", memories: [{ memory_id: "m1", summary: "Timer", content: "Use unsigned subtraction.",
  scope: { workspace_id: "test", project_id: "opencode:project-a" },
  use_policy: { can_use_as_instruction: false, can_use_as_evidence: true, requires_user_confirmation: false } }] };

async function withHarness(extra, run) {
  const h = harness(extra), original = globalThis.fetch;
  process.env.OB1_TEST_KEY = "test-only-key";
  globalThis.fetch = async (url, init) => {
    h.calls.push({ url, body: JSON.parse(init.body) });
    if (h.failure) throw new Error("private network failure");
    if (url.endsWith("/writeback") && h.rejectWrite) return Response.json({ blocked: true }, { status: 422 });
    return Response.json(url.endsWith("/recall") ? recalled : { memories: [{ memory_id: "saved" }] });
  };
  const cleanup = await setup(h.ctx);
  try { await run(h); } finally { await cleanup(); globalThis.fetch = original; delete process.env.OB1_TEST_KEY; }
}
test("recalls once per turn, reinjects on continuations, and refreshes after compaction", async () => {
  await withHarness({}, async h => {
    const first = h.request(); await h.hooks.context(first);
    assert.match(first.system[0].text, /unsigned subtraction/);
    const next = h.request(); await h.hooks.context(next);
    assert.equal(h.calls.length, 1); assert.equal(next.system.length, 1);
    await h.hooks.compaction(h.request()); await h.hooks.context(h.request());
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[0].body.scope.include_unconfirmed, false);
    assert.equal(h.calls[0].body.runtime.name, "opencode");
    assert.ok(h.calls.every(c => c.url.endsWith("/recall"))); // no automatic writes or false used reports
  });
});
test("concurrent identical requests share one recall; distinct sessions never share cache", async () => {
  await withHarness({}, async h => {
    await Promise.all([h.hooks.context(h.request()), h.hooks.context(h.request())]);
    assert.equal(h.calls.length, 1);
    await h.hooks.context({ ...h.request(), sessionID: "ses_b" });
    assert.equal(h.calls.length, 2);
  });
});
test("foreign locations, foreign projects, child sessions and session opt-outs do not send requests", async () => {
  await withHarness({}, async h => {
    for (const change of [{ location: { directory: "/other" } }, { projectID: "other" }, { parentID: "ses_parent" }, { metadata: { ob1Memory: false } }]) {
      const original = { ...h.session }; Object.assign(h.session, change);
      await h.hooks.context(h.request());
      for (const k of Object.keys(h.session)) delete h.session[k]; Object.assign(h.session, original);
    }
    assert.equal(h.calls.length, 0);
  });
});
test("network failure is non-blocking and backs off on tool continuations", async () => {
  await withHarness({}, async h => {
    h.failure = true;
    const event = h.request();
    await h.hooks.context(event); await h.hooks.context(h.request());
    assert.equal(event.system.length, 0);
    assert.equal(h.calls.length, 1);
  });
});
test("opt-in compaction checkpoints exclude reasoning/tools and deduplicate successful receipts", async () => {
  await withHarness({ autoCapture: true }, async h => {
    const event = h.request("Use unsigned timers.");
    event.messages.push({ role: "assistant", content: [{ type: "text", text: "Verified." },
      { type: "reasoning", text: "SECRET REASONING" }, { type: "tool-result", text: "SECRET TOOL OUTPUT" }] });
    await h.hooks.compaction(event); await h.hooks.compaction(event);
    const writes = h.calls.filter(c => c.url?.endsWith("/writeback"));
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.provenance.requires_review, true);
    assert.equal(writes[0].body.provenance.default_status, "generated");
    assert.ok(!JSON.stringify(h.calls).includes("SECRET"));
    assert.equal(h.storage.size, 1);
    assert.equal(event.result, undefined); // native compaction remains intact
  });
});
test("idle captures only successful sessions, and cleanup removes hooks", async () => {
  await withHarness({ autoCapture: true }, async h => {
    h.emit({ type: "session.idle", data: { sessionID: "ses_a" } });
    for (let i = 0; i < 50 && !h.storage.size; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(h.storage.size, 1);
  });
});
test("rejected write does not advance the receipt; retry uses the same idempotency key", async () => {
  await withHarness({ autoCapture: true }, async h => {
    h.rejectWrite = true;
    await h.hooks.compaction(h.request());
    assert.equal(h.storage.size, 0);
    h.rejectWrite = false;
    await h.hooks.compaction(h.request());
    const writes = h.calls.filter(c => c.url?.endsWith("/writeback"));
    assert.equal(writes.length, 2);
    assert.equal(writes[0].body.idempotency_key, writes[1].body.idempotency_key);
    assert.equal(h.storage.size, 1);
  });
});
test("failed sessions and credential-like user input are not captured or recalled", async () => {
  await withHarness({ autoCapture: true }, async h => {
    await h.hooks.context(h.request("password=example-secret-value"));
    h.session.outcome = "failed";
    h.emit({ type: "session.idle", data: { sessionID: "ses_a" } });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(h.calls.length, 0);
  });
});
test("disabled plugin requires neither configuration nor credentials", async () => {
  assert.equal(await setup({ options: { enabled: false } }), undefined);
});
