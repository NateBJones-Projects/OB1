#!/usr/bin/env node

const baseUrl = (process.env.OB1_REST_URL || "http://127.0.0.1:3025/open-brain-rest").replace(/\/$/, "");
const accessKey = process.env.OB1_REST_KEY || process.env.MCP_ACCESS_KEY;
const keep = process.argv.includes("--keep");

if (!accessKey) fail("Set OB1_REST_KEY or MCP_ACCESS_KEY.");

const createdIds = [];

try {
  await request("GET", "/health");

  const duplicateContent =
    "OB1 REST smoke duplicate: dashboard rows must use UUID string IDs across thoughts, workflow, audit, and duplicate review.";

  const first = await capture({
    content: duplicateContent,
    type: "task",
    source_type: "open-brain-rest-smoke",
    importance: 82,
    quality_score: 91,
    status: "new",
    metadata: {
      source: "open-brain-rest-smoke",
      topics: ["open-brain-rest", "dashboard", "uuid"],
      people: ["Jonathan Edwards"],
    },
  });

  const second = await capture({
    content: duplicateContent,
    type: "task",
    source_type: "open-brain-rest-smoke",
    importance: 78,
    quality_score: 88,
    status: "planning",
    metadata: {
      source: "open-brain-rest-smoke",
      topics: ["open-brain-rest", "dashboard", "uuid"],
      people: ["Jonathan Edwards"],
    },
  });

  const audit = await capture({
    content:
      "OB1 REST smoke audit row: raw transcripts and secrets should never become dashboard seed memories.",
    type: "reference",
    source_type: "open-brain-rest-smoke",
    importance: 12,
    quality_score: 12,
    metadata: {
      source: "open-brain-rest-smoke",
      topics: ["audit", "safety"],
      people: ["Jonathan Edwards"],
    },
  });

  createdIds.push(first.thought_id, second.thought_id, audit.thought_id);

  assert(first.thought_id, "capture returned first thought id");
  assert(typeof first.thought_id === "string", "capture ids are strings");

  const thoughts = await request("GET", "/thoughts?source_type=open-brain-rest-smoke&per_page=10");
  assert(thoughts.total >= 2, "thought browse sees smoke rows");

  const stats = await request("GET", "/stats");
  assert(Number(stats.total_thoughts) >= 1, "stats returns total thoughts");

  const search = await request("POST", "/search", {
    query: "OB1 REST smoke UUID dashboard",
    mode: "text",
    limit: 5,
  });
  assert(search.total >= 1, "text search returns smoke rows");

  const update = await request("PUT", `/thought/${first.thought_id}`, {
    status: "active",
    importance: 90,
  });
  assert(update.action === "updated", "thought update works");

  const kanban = await request("GET", "/thoughts?type=task&status=new,planning,active,review,done&per_page=20");
  assert(kanban.data.some((row) => row.id === first.thought_id), "kanban status filter sees updated task");

  const duplicates = await request("GET", "/duplicates?threshold=0.85&limit=10");
  assert(Array.isArray(duplicates.pairs), "duplicates endpoint returns pairs array");

  const auditRows = await request("GET", "/thoughts?quality_score_max=29&source_type=open-brain-rest-smoke");
  assert(auditRows.data.some((row) => row.id === audit.thought_id), "audit filter sees low-quality row");

  if (!keep) {
    for (const id of createdIds) await request("DELETE", `/thought/${id}`);
  }

  console.log(`open-brain-rest smoke passed (${keep ? "kept" : "cleaned"} ${createdIds.length} rows).`);
} catch (error) {
  if (!keep) {
    for (const id of createdIds) {
      await request("DELETE", `/thought/${id}`).catch(() => {});
    }
  }
  fail(error instanceof Error ? error.message : String(error));
}

async function capture(payload) {
  const result = await request("POST", "/capture", payload);
  return result;
}

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-brain-key": accessKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
