import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewCaptured } from "../dist/review.js";
import { options } from "../dist/client.js";

const excerpt = "user: Use unsigned subtraction for timer rollover.";
const quote = "Use unsigned subtraction for timer rollover.";
const memory = () => ({ id: "m1", workspace_id: "test", project_id: "project", task_id: "ses_test",
  runtime_name: "opencode", provenance_status: "generated", review_status: "pending", lifecycle_status: "active",
  requires_user_confirmation: true, can_use_as_instruction: false, content: quote, updated_at: "v1" });
function harness() {
  const calls = []; let current = memory();
  const config = options({ endpoint: "http://localhost/api", workspaceId: "test", autoReview: true,
    reviewModel: { providerID: "subscription", id: "reviewer" } }, {});
  const h = { calls, config, decision: { reviews: [{ memory_id: "m1", decision: "approve_evidence", source_quote: quote, reason: "Explicit routine project decision." }] },
    get memory() { return current; }, set memory(m) { current = m; },
    args: { config, ids: ["m1"], project: "project", session: "ses_test", excerpt,
      signal: new AbortController().signal, stillAllowed: async () => true,
      ctx: { experimental: { generate: { text: async ({ model, prompt }) => {
        calls.push({ model, prompt }); if (h.afterGeneration) h.afterGeneration();
        if (h.fail) throw new Error("Reviewer unavailable");
        return { text: typeof h.decision === "string" ? h.decision : JSON.stringify(h.decision) };
      } } } },
      client: {
        get: async path => { calls.push({ get: path }); return { memory: { ...current } }; },
        patch: async (path, body) => { calls.push({ patch: path, body }); current = { ...current,
          review_status: "evidence_only", requires_user_confirmation: false, can_use_as_instruction: false };
          return { memory: current }; },
      },
    },
  };return h;
}
test("review requires explicit opt-in and model; never silently selects a fallback", async () => {
  assert.throws(() => options({ endpoint: "http://localhost/api", workspaceId: "test", autoReview: true }, {}));
  const h = harness(); h.config.autoReview = false; await reviewCaptured(h.args); assert.equal(h.calls.length, 0);
});
test("supported routine findings become generated evidence, never confirmed instructions", async () => {
  const h = harness(); await reviewCaptured(h.args);
  const patch = h.calls.find(c => c.patch);
  assert.equal(patch.body.action, "evidence_only");
  assert.match(patch.body.actor_label, /automated reviewer/);
  assert.equal(h.memory.provenance_status, "generated");
  assert.equal(h.memory.can_use_as_instruction, false);
  assert.equal(h.calls.find(c => c.model).model.id, "reviewer");
});
test("foreign, edited, confirmed or opted-out memories cannot be auto-approved", async () => {
  for (const change of [{ workspace_id: "other" }, { project_id: "other" }, { task_id: "other" },
    { runtime_name: "other" }, { review_status: "confirmed" }, { provenance_status: "user_confirmed" }]) {
    const h = harness(); h.memory = { ...h.memory, ...change }; await reviewCaptured(h.args);
    assert.ok(!h.calls.some(c => c.patch || c.model));
  }
  const h = harness(); h.afterGeneration = () => h.memory = { ...h.memory, content: "Edited by human", updated_at: "v2" };
  await reviewCaptured(h.args); assert.ok(!h.calls.some(c => c.patch));
  const optout = harness(); optout.args.stillAllowed = async () => false;
  await reviewCaptured(optout.args); assert.ok(!optout.calls.some(c => c.patch));
});
test("hold decisions, invented IDs, unsupported quotes and forbidden actions never mutate memories", async () => {
  for (const change of [{ decision: "needs_human" }, { decision: "confirm" }, { memory_id: "foreign" },
    { source_quote: "Not in the actual conversation" }, { source_quote: "" }]) {
    const h = harness(); Object.assign(h.decision.reviews[0], change);
    await reviewCaptured(h.args); assert.ok(!h.calls.some(c => c.patch));
  }
});
test("malformed output and model failure leave memories pending", async () => {
  for (const bad of ["not json", '{"reviews":{}}']) {
    const h = harness(); h.decision = bad; await assert.rejects(reviewCaptured(h.args));
    assert.equal(h.memory.review_status, "pending");
  }
  const h = harness(); h.fail = true; await assert.rejects(reviewCaptured(h.args));
  assert.equal(h.memory.review_status, "pending");
});
