#!/usr/bin/env node

const endpoint = requiredEnv("OB1_AGENT_MEMORY_ENDPOINT").replace(/\/$/, "");
const accessKey = process.env.OB1_AGENT_MEMORY_KEY || process.env.MCP_ACCESS_KEY;
if (!accessKey) {
  fail("Set OB1_AGENT_MEMORY_KEY or MCP_ACCESS_KEY.");
}

const workspaceId = process.env.OB1_AGENT_MEMORY_WORKSPACE_ID || "ob1-staging";
const projectId = process.env.OB1_AGENT_MEMORY_PROJECT_ID || "agent-memory-api-smoke";
const runId = process.env.OB1_AGENT_MEMORY_RUN_ID || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const taskId = `agent-memory-api-smoke-${runId}`;

const summary = {
  run_id: runId,
  endpoint,
  workspace_id: workspaceId,
  project_id: projectId,
  checks: {},
};

async function main() {
  const health = await request("/health");
  assert(health.ok === true, "health did not return ok=true");
  summary.checks.health = "passed";

  const writeback = await request("/writeback", {
    method: "POST",
    body: writebackPayload(),
  });
  const writtenIds = (writeback.memories || []).map((memory) => memory.memory_id);
  assert(writtenIds.length >= 3, `expected at least 3 written memories, got ${writtenIds.length}`);
  assert(writeback.memories.every((memory) => memory.use_policy?.can_use_as_instruction === false), "generated writeback became instruction-grade");
  assert(writeback.memories.every((memory) => memory.use_policy?.can_use_as_evidence === true), "generated writeback was not evidence-enabled");
  assert(writeback.memories.every((memory) => memory.use_policy?.requires_user_confirmation === true), "generated writeback did not require review");
  summary.checks.writeback = { status: "passed", memory_count: writtenIds.length };

  const conservativeRecall = await request("/recall", {
    method: "POST",
    body: recallPayload(false),
  });
  const conservativeIds = new Set((conservativeRecall.memories || []).map((memory) => memory.memory_id));
  assert(writtenIds.every((id) => !conservativeIds.has(id)), "pending generated memory appeared in conservative recall");
  summary.checks.conservative_recall_gate = {
    status: "passed",
    returned_count: conservativeRecall.memories?.length || 0,
  };

  const inclusiveRecall = await request("/recall", {
    method: "POST",
    body: recallPayload(true),
  });
  const recalledIds = (inclusiveRecall.memories || []).map((memory) => memory.memory_id);
  const recalledWrittenId = writtenIds.find((id) => recalledIds.includes(id));
  assert(recalledWrittenId, "include_unconfirmed recall did not return any newly written memory");
  summary.checks.include_unconfirmed_recall = {
    status: "passed",
    request_id: inclusiveRecall.request_id,
    returned_count: recalledIds.length,
    used_memory_id: recalledWrittenId,
  };

  await request(`/recall/${inclusiveRecall.request_id}/usage`, {
    method: "POST",
    body: {
      used_memory_ids: [recalledWrittenId],
      ignored: recalledIds.filter((id) => id !== recalledWrittenId).slice(0, 2).map((memory_id) => ({
        memory_id,
        reason: "not needed for live API smoke assertion",
      })),
    },
  });
  summary.checks.usage_reporting = "passed";

  const reviewed = await request(`/memories/${writtenIds[0]}/review`, {
    method: "PATCH",
    body: {
      action: "evidence_only",
      actor_label: "OB1 Agent Memory API live smoke",
      notes: `API smoke run ${runId}`,
    },
  });
  assert(reviewed.memory?.review_status === "evidence_only", "review action did not set evidence_only");
  assert(reviewed.memory?.can_use_as_instruction === false, "evidence_only memory became instruction-grade");
  summary.checks.review_action = {
    status: "passed",
    reviewed_memory_id: writtenIds[0],
    review_status_after: reviewed.memory.review_status,
  };

  const inspected = await request(`/memories/${writtenIds[0]}`);
  assert(inspected.memory?.id === writtenIds[0], "inspect returned the wrong memory");
  summary.checks.inspect_memory = "passed";

  const trace = await request(`/recall-traces/${inclusiveRecall.request_id}`);
  assert(trace.items?.some((item) => item.memory_id === recalledWrittenId && item.used === true), "recall trace did not mark used memory");
  summary.checks.recall_trace = {
    status: "passed",
    trace_item_count: trace.items?.length || 0,
  };

  const unsafe = await request("/writeback", {
    method: "POST",
    body: unsafeWritebackPayload(),
    expectedStatus: 422,
  });
  assert(unsafe.error === "Unsafe write-back blocked", "unsafe writeback was not blocked");
  summary.checks.unsafe_writeback_block = "passed";

  console.log(JSON.stringify({
    ok: true,
    ...summary,
  }, null, 2));
}

function writebackPayload() {
  return {
    schema_version: "openbrain.openclaw.writeback.v1",
    workspace_id: workspaceId,
    project_id: projectId,
    task_id: taskId,
    step_id: "writeback-1",
    idempotency_key: `${taskId}:writeback-1`,
    channel: { kind: "cli", id: "api-smoke", thread_id: runId },
    runtime: { name: "smoke-harness", version: "0.1.0" },
    models_used: [{ provider: "harness", model: "direct-api", role: "smoke" }],
    source_refs: [{
      kind: "repo",
      uri: "repo://integrations/agent-memory-api/smoke/live-smoke.mjs",
      title: "Agent Memory API live smoke harness",
    }],
    memory_payload: {
      decisions: [],
      outputs: [`OB1 Agent Memory API live smoke ${runId} wrote governed memory through the live endpoint.`],
      lessons: [`Live API smoke ${runId} verifies generated memory remains evidence-only until review.`],
      constraints: ["Smoke harnesses must never print OB1 Agent Memory access keys."],
      unresolved_questions: [],
      next_steps: ["Keep this smoke harness in the release checklist before OpenClaw/ClawHub publishing."],
      failures: [],
      artifacts: [{
        kind: "script",
        uri: "repo://integrations/agent-memory-api/smoke/live-smoke.mjs",
        description: "Repeatable API smoke harness",
      }],
      entities: {
        topics: ["OB1 Agent Memory", "smoke test", "writeback", "recall trace"],
        repos: ["OB1"],
      },
    },
    provenance: { default_status: "generated", confidence: 0.83, requires_review: true },
    retention: { stale_after_days: 30 },
    visibility: { workspace: "private", project: "project", channel: "cli" },
  };
}

function recallPayload(includeUnconfirmed) {
  return {
    schema_version: "openbrain.openclaw.recall.v1",
    workspace_id: workspaceId,
    project_id: projectId,
    task_id: taskId,
    task_type: "smoke",
    channel: { kind: "cli", id: "api-smoke", thread_id: runId },
    runtime: { name: "smoke-harness", version: "0.1.0" },
    model_intent: { provider: "harness", model: "direct-api" },
    query: `OB1 Agent Memory API live smoke ${runId} governed memory evidence-only recall trace`,
    entities: { topics: ["OB1 Agent Memory", "smoke test"], repos: ["OB1"] },
    scope: {
      visibility: "project",
      project_only: true,
      include_unconfirmed: includeUnconfirmed,
      include_stale: false,
    },
    limits: { max_items: 10, max_tokens: 4000, recency_days: 7 },
    sensitivity: { contains_code: false, contains_customer_data: false, contains_private_meeting_data: false },
  };
}

function unsafeWritebackPayload() {
  return {
    ...writebackPayload(),
    task_id: `${taskId}-unsafe`,
    step_id: "unsafe-writeback",
    idempotency_key: `${taskId}:unsafe-writeback`,
    memory_payload: {
      ...writebackPayload().memory_payload,
      outputs: ["This fake unsafe payload contains api_key: sk-or-v1-0000000000000000000000000000000000000000"],
      lessons: [],
      constraints: [],
      next_steps: [],
      artifacts: [],
    },
  };
}

async function request(path, options = {}) {
  const expectedStatus = options.expectedStatus || 200;
  const response = await fetch(`${endpoint}${path}`, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      "x-brain-key": accessKey,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (response.status !== expectedStatus) {
    fail(`Expected ${expectedStatus} from ${path}, got ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) fail(`Set ${name}.`);
  return value;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

main().catch((error) => fail(error?.message || String(error)));
