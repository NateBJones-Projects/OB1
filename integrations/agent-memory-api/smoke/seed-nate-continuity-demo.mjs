#!/usr/bin/env node

const endpoint = requiredEnv("OB1_AGENT_MEMORY_ENDPOINT").replace(/\/$/, "");
const accessKey = process.env.OB1_AGENT_MEMORY_KEY || process.env.MCP_ACCESS_KEY;
if (!accessKey) fail("Set OB1_AGENT_MEMORY_KEY or MCP_ACCESS_KEY.");

const workspaceId = process.env.OB1_AGENT_MEMORY_WORKSPACE_ID || "nate-jones-personal-ob1";
const projectId = process.env.OB1_AGENT_MEMORY_PROJECT_ID || "continuity-os";
const runId = process.env.OB1_AGENT_MEMORY_DEMO_ID || "nate-continuity-v1";
const dashboardBaseUrl = process.env.OB1_DASHBOARD_BASE_URL || "http://localhost:3020";
const sourceTimestamp = process.env.OB1_AGENT_MEMORY_SOURCE_TIMESTAMP || "2026-05-04T00:00:00.000Z";

const summary = {
  run_id: runId,
  endpoint,
  workspace_id: workspaceId,
  project_id: projectId,
  batches: [],
  status_counts: {},
};

const batches = [
  {
    slug: "core-operating-rules",
    reviewAction: null,
    provenance: { default_status: "imported", confidence: 0.97, requires_review: false },
    retention: { stale_after_days: 180 },
    source_refs: [
      source("proposal", "repo://docs/drafts/nate-agent-memory-proposal.md", "Nate Jones Agent Memory proposal", sourceTimestamp),
      source("repo", "repo://recipes/openclaw-agent-memory/README.md", "OpenClaw Agent Memory recipe", sourceTimestamp),
    ],
    payload: {
      decisions: [
        "Rule: OB1 Agent Memory is the runtime-neutral continuity layer for agent work; OpenClaw is the flagship launch runtime, not the product boundary.",
        "Rule: Instruction-grade agent memory requires human confirmation or trusted import; inferred and generated memories remain evidence until reviewed.",
        "Rule: Write-back stores compact decisions, lessons, failures, next steps, and artifact references; raw transcripts and model reasoning traces are not durable memory.",
        "Rule: Code Review Memory is the flagship OpenClaw workflow because repo-specific lessons compound across repeated reviews.",
        "Rule: TaskFlow Work Log memory must let a second agent continue without reading a raw transcript.",
      ],
      entities: commonEntities(["governance", "use policy", "OpenClaw launch", "code review memory", "TaskFlow"]),
    },
  },
  {
    slug: "public-reference-pack",
    reviewAction: "evidence_only",
    provenance: { default_status: "imported", confidence: 0.91, requires_review: true },
    retention: { stale_after_days: 45 },
    source_refs: [
      source("website", "https://www.natebjones.com/", "Nate Jones personal site", sourceTimestamp),
      source("substack", "https://natesnewsletter.substack.com/", "Nate's Substack", sourceTimestamp),
      source("youtube", "https://www.youtube.com/@NateBJones", "AI News & Strategy Daily | Nate B Jones", sourceTimestamp),
      source("podcast", "https://podcasts.apple.com/us/podcast/ai-news-strategy-daily-with-nate-b-jones/id1877109372", "AI News & Strategy Daily with Nate B. Jones", sourceTimestamp),
    ],
    payload: {
      lessons: [
        "Reference: Nate B. Jones positions his public work around practical AI strategy, implementation frameworks, and a zero-hype editorial stance.",
        "Reference: Nate's Substack describes daily AI strategy, news, and implementation writing for practitioners and leaders who are past hype and ready to build.",
        "Reference: AI News & Strategy Daily with Nate B. Jones is an updated-daily business podcast and video feed for AI-curious builders and executives.",
        "Reference: Nate's public audience surfaces include Substack, YouTube, Apple Podcasts, Spotify, and community offerings linked from natebjones.com.",
        "Reference: Public audience metrics and channel descriptions are dated evidence; agents should refresh them before using them in external copy.",
      ],
      entities: commonEntities(["Nate B. Jones", "Substack", "YouTube", "AI News & Strategy Daily", "public presence"]),
    },
  },
  {
    slug: "ob1-repo-map",
    reviewAction: "evidence_only",
    provenance: { default_status: "imported", confidence: 0.94, requires_review: true },
    retention: { stale_after_days: 120 },
    source_refs: [
      source("repo", "repo://README.md", "Open Brain README", sourceTimestamp),
      source("repo", "repo://docs/01-getting-started.md", "Open Brain setup guide", sourceTimestamp),
      source("repo", "repo://integrations/agent-memory-api/README.md", "Agent Memory API README", sourceTimestamp),
    ],
    payload: {
      lessons: [
        "Repo map: OB1 setup starts in docs/01-getting-started.md; companion prompts, FAQ, and AI-assisted setup live in docs/02, docs/03, and docs/04.",
        "Repo map: Contributions are organized by recipes, skills, dashboards, integrations, schemas, primitives, and extensions; agents should cite the folder they are changing.",
        "Repo map: Agent Memory API lives under integrations/agent-memory-api and exposes recall, write-back, usage reporting, review, inspector, and trace endpoints.",
        "Repo map: OpenClaw launch assets live under recipes/openclaw-agent-memory, skills/openclaw-agent-memory, and integrations/openclaw-agent-memory.",
      ],
      entities: commonEntities(["OB1 repo", "docs", "recipes", "skills", "integrations", "schemas"]),
    },
  },
  {
    slug: "pending-agent-work",
    reviewAction: null,
    provenance: { default_status: "generated", confidence: 0.82, requires_review: true },
    retention: { stale_after_days: 30 },
    source_refs: [
      source("demo_run", `ob1-demo://${runId}/openclaw-review`, "OpenClaw demo run", sourceTimestamp),
    ],
    payload: {
      outputs: [
        "Pending: OpenClaw code review agent found that dashboard review actions need screenshot coverage before the launch tutorial is cut.",
        "Pending: TaskFlow handoff agent summarized the current state as schema, API, plugin, skill, dashboard, smoke harness, and visual docs all moving together.",
      ],
      lessons: [
        "Pending: Maintainer correction candidate - keep dashboard copy dense and operational; remove repeated helper text when sidebar and table labels already orient the user.",
        "Pending: Screenshot asset candidate - show Pending, Evidence, Confirmed, Rejected, Stale, and Recall Trace views with Nate continuity demo data.",
      ],
      unresolved_questions: [
        "Open question: Should Memory Review live as a global dashboard surface, a workflow-specific page, or both?",
        "Open question: Which OpenClaw registry path should be canonical for launch - native plugin package, ClawHub skill, or both in parallel?",
      ],
      next_steps: [
        "Capture demo screenshots after the NBJ OB1 microtype background and Nate continuity seed data are approved.",
        "Turn this seed pack into a documented starter-knowledge bootstrap for new OB1 Agent Memory databases.",
      ],
      entities: commonEntities(["dashboard review", "screenshots", "OpenClaw registry", "ClawHub", "starter knowledge"]),
    },
  },
  {
    slug: "rejected-false-positives",
    reviewAction: "reject",
    provenance: { default_status: "inferred", confidence: 0.6, requires_review: true },
    retention: { stale_after_days: 14 },
    source_refs: [
      source("demo_run", `ob1-demo://${runId}/rejected`, "Rejected demo assumptions", sourceTimestamp),
    ],
    payload: {
      failures: [
        "Rejected: All OpenClaw memories should auto-promote to workspace-wide instruction after write-back.",
        "Rejected: Store full Slack, meeting, or task transcripts inside agent_memories so retrieval has everything in one row.",
      ],
      entities: commonEntities(["false positive", "auto-promotion", "raw transcript", "memory hygiene"]),
    },
  },
  {
    slug: "stale-assumptions",
    reviewAction: "mark_stale",
    provenance: { default_status: "generated", confidence: 0.72, requires_review: true },
    retention: { stale_after_days: 7 },
    source_refs: [
      source("demo_run", `ob1-demo://${runId}/stale`, "Stale planning assumptions", sourceTimestamp),
    ],
    payload: {
      lessons: [
        "Stale: SQLite/local adapter support belongs in the v1 launch scope instead of a later portability path.",
        "Stale: Final demo screenshots should use smoke-harness memory rows instead of a purpose-built Nate continuity data set.",
      ],
      entities: commonEntities(["stale assumption", "SQLite", "demo screenshots", "scope control"]),
    },
  },
];

async function main() {
  const health = await request("/health");
  assert(health.ok === true, "health did not return ok=true");

  const allMemoryIds = [];
  for (const batch of batches) {
    const writeback = await request("/writeback", {
      method: "POST",
      body: writebackPayload(batch),
    });
    const ids = (writeback.memories || []).map((memory) => memory.memory_id);
    allMemoryIds.push(...ids);

    if (batch.reviewAction) {
      for (const id of ids) {
        await request(`/memories/${id}/review`, {
          method: "PATCH",
          body: {
            action: batch.reviewAction,
            actor_label: "OB1 Nate continuity demo seed",
            notes: `Seed ${batch.slug} as ${batch.reviewAction}`,
          },
        });
      }
    }

    summary.batches.push({
      slug: batch.slug,
      review_action: batch.reviewAction || "none",
      memory_count: ids.length,
    });
  }

  const recall = await request("/recall", {
    method: "POST",
    body: recallPayload(),
  });
  const recalledIds = (recall.memories || []).map((memory) => memory.memory_id);
  if (recalledIds.length > 0) {
    await request(`/recall/${recall.request_id}/usage`, {
      method: "POST",
      body: {
        used_memory_ids: recalledIds.slice(0, 3),
        ignored: recalledIds.slice(3, 6).map((memory_id) => ({
          memory_id,
          reason: "Useful context, but not needed for the demo agent's final recommendation.",
        })),
      },
    });
  }

  for (const status of ["pending", "evidence_only", "confirmed", "rejected", "stale", "all"]) {
    const listed = await listStatus(status);
    summary.status_counts[status] = listed.count;
  }

  console.log(JSON.stringify({
    ok: true,
    ...summary,
    recall_request_id: recall.request_id,
    recalled_count: recalledIds.length,
    dashboard_urls: {
      pending: dashboardUrl("pending"),
      evidence: dashboardUrl("evidence_only"),
      confirmed: dashboardUrl("confirmed"),
      rejected: dashboardUrl("rejected"),
      stale: dashboardUrl("stale"),
      all: dashboardUrl("all"),
      trace: `${dashboardBaseUrl}/agent-memory/traces?request_id=${encodeURIComponent(recall.request_id)}`,
    },
  }, null, 2));
}

function writebackPayload(batch) {
  return {
    schema_version: "openbrain.openclaw.writeback.v1",
    workspace_id: workspaceId,
    project_id: projectId,
    task_id: `nate-continuity-demo-${runId}`,
    step_id: batch.slug,
    idempotency_key: `${workspaceId}:${projectId}:${runId}:${batch.slug}`,
    channel: { kind: "dashboard", id: "ob1-agent-memory-demo", thread_id: runId },
    runtime: { name: "ob1-demo-seed", version: "0.1.0" },
    models_used: [{ provider: "openai", model: "gpt-5.5", role: "demo_seed" }],
    source_refs: batch.source_refs,
    memory_payload: normalizePayload(batch.payload),
    provenance: batch.provenance,
    retention: batch.retention,
    visibility: { workspace: "private", project: "project", channel: "dashboard" },
  };
}

function recallPayload() {
  return {
    schema_version: "openbrain.openclaw.recall.v1",
    workspace_id: workspaceId,
    project_id: projectId,
    task_id: `nate-continuity-demo-${runId}-recall`,
    task_type: "demo_trace",
    channel: { kind: "dashboard", id: "ob1-agent-memory-demo", thread_id: runId },
    runtime: { name: "openclaw", version: "personal-dgx-spark" },
    model_intent: { provider: "openai", model: "gpt-5.5" },
    query: "Build a Nate Jones continuity demo for OB1 Agent Memory that recalls repo rules, public reference context, OpenClaw launch guidance, and screenshot next steps.",
    entities: commonEntities(["Nate B. Jones", "OB1 Agent Memory", "OpenClaw", "Code Review Memory", "TaskFlow Work Log", "screenshots"]),
    scope: {
      visibility: "project",
      project_only: true,
      include_unconfirmed: false,
      include_stale: false,
    },
    limits: { max_items: 12, max_tokens: 5000, recency_days: 120 },
    sensitivity: { contains_code: false, contains_customer_data: false, contains_private_meeting_data: false },
  };
}

async function listStatus(status) {
  const params = new URLSearchParams({
    workspace_id: workspaceId,
    project_id: projectId,
    limit: "200",
  });
  if (status !== "all") params.set("review_status", status);
  return request(`/memories?${params.toString()}`);
}

function normalizePayload(payload) {
  return {
    decisions: payload.decisions || [],
    outputs: payload.outputs || [],
    lessons: payload.lessons || [],
    constraints: payload.constraints || [],
    unresolved_questions: payload.unresolved_questions || [],
    next_steps: payload.next_steps || [],
    failures: payload.failures || [],
    artifacts: payload.artifacts || [],
    entities: payload.entities || {},
  };
}

function commonEntities(extraTopics = []) {
  return {
    people: ["Nate B. Jones", "Jonathan Edwards"],
    repos: ["OB1"],
    topics: ["OB1 Agent Memory", "OpenBrain", "OpenClaw", ...extraTopics],
  };
}

function source(kind, uri, title, timestamp) {
  return { kind, uri, title, timestamp };
}

function dashboardUrl(status) {
  const params = new URLSearchParams({
    workspace_id: workspaceId,
    project_id: projectId,
    review_status: status,
  });
  return `${dashboardBaseUrl}/agent-memory?${params.toString()}`;
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
