#!/usr/bin/env node

import { demoThoughts } from "../../../docs/walkthroughs/ob1-agent-dashboard/seed-data.mjs";

const baseUrl = (process.env.OB1_REST_URL || "").replace(/\/$/, "");
const accessKey = process.env.OB1_REST_KEY || process.env.MCP_ACCESS_KEY;
const apply = process.argv.includes("--apply");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : demoThoughts.length;

if (!baseUrl) fail("Set OB1_REST_URL.");
if (!accessKey) fail("Set OB1_REST_KEY or MCP_ACCESS_KEY.");

const rows = demoThoughts.slice(0, Number.isFinite(limit) ? limit : demoThoughts.length);

if (!apply) {
  console.log(`Dry run: would seed ${rows.length} dashboard demo thoughts into ${baseUrl}.`);
  console.log("Run again with --apply to write rows through /capture.");
  process.exit(0);
}

let written = 0;
for (const row of rows) {
  const payload = {
    content: row.content,
    type: row.type,
    source_type: row.source_type,
    importance: row.importance,
    quality_score: row.quality_score,
    sensitivity_tier: row.sensitivity_tier,
    status: row.status,
    metadata: {
      ...row.metadata,
      walkthrough_seed_id: String(row.id),
      source: row.source_type,
      source_type: row.source_type,
      type: row.type,
      importance: row.importance,
      quality_score: row.quality_score,
    },
  };
  const result = await request("POST", "/capture", payload);
  written += 1;
  console.log(`${String(written).padStart(2, "0")}. ${result.thought_id} ${row.type} ${row.source_type}`);
}

console.log(`Seeded ${written} dashboard demo thoughts.`);

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

function fail(message) {
  console.error(message);
  process.exit(1);
}
