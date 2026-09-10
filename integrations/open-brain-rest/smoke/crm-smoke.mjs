#!/usr/bin/env node

// Live smoke for the CRM surface of open-brain-rest. Requires a brain with the
// crm-core + crm-engagement schemas applied and the gateway deployed. Run:
//   OB1_REST_URL=... OB1_REST_KEY=... node crm-smoke.mjs [--keep]
// Self-cleaning: archives the contact it creates and deletes the card thought.

const baseUrl = (process.env.OB1_REST_URL || "http://127.0.0.1:3025/open-brain-rest").replace(/\/$/, "");
const accessKey = process.env.OB1_REST_KEY || process.env.MCP_ACCESS_KEY;
const keep = process.argv.includes("--keep");

if (!accessKey) fail("Set OB1_REST_KEY or MCP_ACCESS_KEY.");

let contactId = null;
let cardThoughtId = null;

try {
  await request("GET", "/health");

  // Create -----------------------------------------------------------------
  const created = await request("POST", "/crm/contacts", {
    display_name: "OB1 CRM Smoke Contact",
    canonical_email: "smoke@example.com",
    organization_name: "Smoke Test Co",
    actor: "crm-smoke",
  });
  contactId = created.contact_id;
  assert(typeof contactId === "string" && contactId.length > 0, "create returns a contact_id");
  cardThoughtId = created.record?.card_thought_id || null;

  // Detail ------------------------------------------------------------------
  const detail = await request("GET", `/crm/contacts/${contactId}`);
  assert(detail.record?.id === contactId, "detail returns the contact record");
  assert(Array.isArray(detail.methods), "detail returns a methods array");

  // List (search) -----------------------------------------------------------
  const list = await request("GET", "/crm/contacts?q=Smoke&per_page=50");
  assert(list.data.some((row) => row.id === contactId), "list search finds the contact");

  // Patch (guarded write + card write-back) ---------------------------------
  const patched = await request("PATCH", `/crm/contacts/${contactId}`, {
    patch: { job_title: "Head of Smoke" },
    actor: "crm-smoke",
  });
  assert(Array.isArray(patched.applied) && patched.applied.includes("job_title"), "patch applies job_title");

  // Method (+ write-back) ---------------------------------------------------
  const method = await request("POST", `/crm/contacts/${contactId}/methods`, {
    method_type: "phone",
    value: "+15550100",
    actor: "crm-smoke",
  });
  assert(method.method?.id, "method add returns a method");

  // Field lock --------------------------------------------------------------
  const lock = await request("POST", `/crm/contacts/${contactId}/field-lock`, {
    field_key: "organization_name",
    locked: true,
    actor: "crm-smoke",
  });
  assert(lock.field === "organization_name", "field lock returns the field");

  // Notes / tasks / important dates ----------------------------------------
  const note = await request("POST", `/crm/contacts/${contactId}/notes`, {
    body: "Smoke note about the relationship.",
    actor: "crm-smoke",
  });
  assert(note.note?.id, "note add returns a note");

  const task = await request("POST", `/crm/contacts/${contactId}/tasks`, {
    title: "Follow up after smoke test",
    actor: "crm-smoke",
  });
  assert(task.task?.id, "task add returns a task");

  const date = await request("POST", `/crm/contacts/${contactId}/important-dates`, {
    label: "Smoke anniversary",
    date_value: "2020-01-15",
    date_kind: "anniversary",
    actor: "crm-smoke",
  });
  assert(date.important_date?.id, "important date add returns a date");

  const items = await request("GET", `/crm/contacts/${contactId}/relationship-items`);
  assert(items.notes.length >= 1 && items.tasks.length >= 1 && items.important_dates.length >= 1, "relationship items bundle populated");

  // Interactions ------------------------------------------------------------
  const interaction = await request("POST", "/crm/interactions", {
    contact_ids: [contactId],
    kind: "call",
    occurred_at: new Date().toISOString(),
    summary: "Smoke call to verify interaction logging.",
    actor: "crm-smoke",
  });
  assert(interaction.interaction_id, "interaction log returns an id");

  const interactions = await request("GET", `/crm/contacts/${contactId}/interactions`);
  assert(interactions.interactions.length >= 1, "interaction list sees the logged call");

  // History + timeline ------------------------------------------------------
  const history = await request("GET", `/crm/contacts/${contactId}/history`);
  assert(history.total >= 1, "history has change-log rows");

  const timeline = await request("GET", `/crm/contacts/${contactId}/timeline`);
  assert(Array.isArray(timeline.timeline) && timeline.timeline.length >= 1, "timeline merges events");

  // Proposals count (nav badge) --------------------------------------------
  const count = await request("GET", "/crm/proposals/count");
  assert(typeof count.open === "number", "proposals count returns an open number");

  await cleanup();
  console.log(`crm smoke passed (${keep ? "kept" : "cleaned"} contact ${contactId}).`);
} catch (error) {
  await cleanup().catch(() => {});
  fail(error instanceof Error ? error.message : String(error));
}

async function cleanup() {
  if (keep) return;
  if (contactId) {
    await request("PATCH", `/crm/contacts/${contactId}`, { patch: { lifecycle_status: "archived" }, actor: "crm-smoke" }).catch(() => {});
  }
  if (cardThoughtId) {
    await request("DELETE", `/thought/${cardThoughtId}`).catch(() => {});
  }
}

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-brain-key": accessKey },
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
