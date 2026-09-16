#!/usr/bin/env node

const endpoint = requiredEnv("OB1_AGENT_MEMORY_ENDPOINT").replace(/\/$/, "");
const accessKey = process.env.OB1_AGENT_MEMORY_KEY || process.env.MCP_ACCESS_KEY;
if (!accessKey) fail("Set OB1_AGENT_MEMORY_KEY or MCP_ACCESS_KEY.");

const workspaceId = process.env.OB1_AGENT_MEMORY_WORKSPACE_ID || "ob1-staging";
const projectIds = (process.env.OB1_AGENT_MEMORY_TEST_PROJECT_IDS || "agent-memory-api-smoke,agent-memory-openclaw-smoke")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const apply = process.argv.includes("--apply");

if (projectIds.length === 0) fail("No test project ids configured.");
for (const projectId of projectIds) {
  if (!isTestScope(projectId)) {
    fail(`Refusing to clean non-test project id: ${projectId}`);
  }
}

const result = {
  ok: true,
  mode: apply ? "apply" : "dry-run",
  workspace_id: workspaceId,
  project_ids: projectIds,
  projects: [],
};

for (const projectId of projectIds) {
  const listed = await request(`/memories?${new URLSearchParams({
    workspace_id: workspaceId,
    project_id: projectId,
    lifecycle_status: "active",
    limit: "200",
  })}`);
  const memories = listed.memories || [];
  const project = {
    project_id: projectId,
    active_count: memories.length,
    memory_ids: memories.map((memory) => memory.memory_id),
    rejected_count: 0,
  };

  if (apply) {
    for (const memory of memories) {
      await request(`/memories/${memory.memory_id}/review`, {
        method: "PATCH",
        body: {
          action: "reject",
          actor_label: "OB1 Agent Memory test cleanup harness",
          notes: "Rejected smoke/test memory so it cannot influence personal recall.",
        },
      });
      project.rejected_count += 1;
    }
  }

  result.projects.push(project);
}

console.log(JSON.stringify(result, null, 2));

async function request(path, options = {}) {
  const response = await fetch(`${endpoint}${path}`, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      "x-brain-key": accessKey,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    fail(`API ${response.status} from ${path}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

function isTestScope(projectId) {
  return /(^|[-_])(smoke|test|testing|sandbox)([-_]|$)/i.test(projectId);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) fail(`Set ${name}.`);
  return value;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
