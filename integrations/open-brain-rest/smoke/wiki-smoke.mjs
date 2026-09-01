#!/usr/bin/env node

// Live smoke for the wiki surface of open-brain-rest. Requires a brain with the
// wiki-pages schema applied and the gateway deployed. Run:
//   OB1_REST_URL=... OB1_REST_KEY=... node wiki-smoke.mjs [--keep]
// Self-cleaning: archives the page it creates (the schema never hard-deletes).

const baseUrl = (process.env.OB1_REST_URL || "http://127.0.0.1:3025/open-brain-rest").replace(/\/$/, "");
const accessKey = process.env.OB1_REST_KEY || process.env.MCP_ACCESS_KEY;
const keep = process.argv.includes("--keep");

if (!accessKey) fail("Set OB1_REST_KEY or MCP_ACCESS_KEY.");

const slug = `ob1-wiki-smoke-${Date.now()}`;
let sectionId = null;

try {
  await request("GET", "/health");

  // Create -----------------------------------------------------------------
  const created = await request("POST", "/wiki/pages", {
    slug,
    title: "OB1 Wiki Smoke Page",
    page_kind: "topic",
  });
  assert(typeof created.page_id === "string" && created.page_id.length > 0, "create returns a page_id");
  assert(created.created === true, "create reports created:true for a brand new slug");

  // List (+ section_count present) ------------------------------------------
  const list = await request("GET", `/wiki/pages?page_kind=topic&per_page=100`);
  const listedRow = list.data.find((row) => row.slug === slug);
  assert(listedRow, "list finds the created page");
  assert(typeof listedRow.section_count === "number", "list row carries a numeric section_count");
  assert(listedRow.section_count === 0, "brand new page has zero sections");

  // Reject invalid page_kind (list filter + create) --------------------------
  const badKindResponse = await fetch(`${baseUrl}/wiki/pages?page_kind=not-a-real-kind`, {
    headers: { "x-brain-key": accessKey },
  });
  assert(badKindResponse.status === 400, "invalid page_kind filter is rejected with 400");

  const badCreateResponse = await fetch(`${baseUrl}/wiki/pages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-brain-key": accessKey },
    body: JSON.stringify({ slug: `${slug}-bogus-kind`, title: "Bogus Kind", page_kind: "bogus" }),
  });
  assert(badCreateResponse.status === 400, "invalid page_kind on create is rejected with 400");

  // Get by slug (no sections yet) -------------------------------------------
  const detail = await request("GET", `/wiki/pages/${slug}`);
  assert(detail.page?.slug === slug, "detail returns the page");
  assert(Array.isArray(detail.sections) && detail.sections.length === 0, "detail starts with no sections");

  // PUT section: first write creates it -------------------------------------
  const createdSection = await request("PUT", `/wiki/pages/${slug}/sections/overview`, {
    body_md: "First draft of the overview section.",
    heading: "Overview",
  });
  assert(createdSection.action === "created", "first section write action is created");
  sectionId = createdSection.section_id;
  assert(typeof sectionId === "string" && sectionId.length > 0, "section write returns a section_id");

  // PUT section: second write updates it in place ---------------------------
  const updatedSection = await request("PUT", `/wiki/pages/${slug}/sections/overview`, {
    body_md: "Revised overview section text.",
  });
  assert(updatedSection.action === "updated", "second section write action is updated");
  assert(updatedSection.section_id === sectionId, "update targets the same section_id");

  // Detail now shows the section, with body reflecting the latest write -----
  const detailAfterWrite = await request("GET", `/wiki/pages/${slug}`);
  const section = detailAfterWrite.sections.find((row) => row.id === sectionId);
  assert(section, "detail lists the written section");
  assert(section.body_md === "Revised overview section text.", "detail reflects the latest section body");

  // Lock true then false ------------------------------------------------------
  const lockedTrue = await request("POST", `/wiki/sections/${sectionId}/lock`, { locked: true });
  assert(lockedTrue.locked === true, "lock true is applied");
  const lockedFalse = await request("POST", `/wiki/sections/${sectionId}/lock`, { locked: false });
  assert(lockedFalse.locked === false, "lock false is applied");

  // Reject-pending on a section with no pending draft (valid negative check).
  // A positive pending-draft path requires a 'generated' write against a
  // human-owned (manual/locked) section — that requires a generator/worker
  // writer and is covered by wiki-mcp / worker E2E, not this REST smoke.
  const rejected = await request("POST", `/wiki/sections/${sectionId}/reject-pending`);
  assert(rejected.action === "no_pending", "reject-pending on a clean section reports no_pending");

  // Archive (never hard-delete) ----------------------------------------------
  if (!keep) {
    const archived = await request("DELETE", `/wiki/pages/${slug}`);
    assert(archived.slug === slug, "archive returns the slug");
    assert(archived.status === "archived", "archive sets status to archived");

    const listAfterArchive = await request("GET", `/wiki/pages?page_kind=topic&per_page=100`);
    assert(!listAfterArchive.data.some((row) => row.slug === slug), "archived page is absent from the active list");
  }

  console.log(`wiki smoke passed (${keep ? "kept" : "archived"} page ${slug}).`);
} catch (error) {
  if (!keep) {
    await request("DELETE", `/wiki/pages/${slug}`).catch(() => {});
  }
  fail(error instanceof Error ? error.message : String(error));
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
