#!/usr/bin/env node
/**
 * crm-quick-start.mjs -- Drive the Open Brain CRM truth layer end to end.
 *
 * Three things, each independently runnable:
 *
 *   --backfill   Read `person` entities from your brain and turn each one into
 *                a CRM contact. Dry run by default; pass --apply to write.
 *   --demo       Seed one fictional contact, have a "machine" try to overwrite a
 *                human-set field (which the truth layer diverts into a proposal),
 *                accept the proposal, then read back the change-log receipt that
 *                proves the change went through a human. Self-cleaning.
 *   (no flag)    Runs --demo.
 *
 * The demo talks to the open-brain-rest gateway (the same one the dashboard
 * uses). The backfill additionally reads the `entities` table straight from
 * PostgREST with the service role key, because the gateway has no entity route.
 *
 * Usage:
 *   node crm-quick-start.mjs --demo
 *   node crm-quick-start.mjs --backfill              # dry run
 *   node crm-quick-start.mjs --backfill --apply --limit 25
 *   node crm-quick-start.mjs --demo --keep           # leave the demo contact
 *
 * Env (read from the shell or a .env.local in the current directory):
 *   OB1_REST_URL   https://<project>.supabase.co/functions/v1/open-brain-rest
 *   OB1_REST_KEY   the MCP_ACCESS_KEY the gateway was deployed with
 *   SUPABASE_URL              (backfill only) https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY (backfill only) service role key, for reading entities
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Env loading (.env.local, BOM-tolerant -- see brain-backup for the same guard)
// ---------------------------------------------------------------------------

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env.local");
  const vars = {};
  if (!fs.existsSync(envPath)) return vars;
  let first = true;
  for (let line of fs.readFileSync(envPath, "utf8").split("\n")) {
    if (first) {
      line = line.replace(/^﻿/, "");
      first = false;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

const fileEnv = loadEnvFile();
const env = (name) => process.env[name] || fileEnv[name] || "";

const baseUrl = env("OB1_REST_URL").replace(/\/$/, "");
const accessKey = env("OB1_REST_KEY") || env("MCP_ACCESS_KEY");

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const intArg = (flag, fallback) => {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return fallback;
  const n = parseInt(args[i + 1], 10);
  return Number.isFinite(n) ? n : fallback;
};

const mode = has("--backfill") ? "backfill" : "demo";
const apply = has("--apply");
const keep = has("--keep");
const limit = intArg("--limit", 50);

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function gateway(method, routePath, body) {
  if (!baseUrl) fail("Set OB1_REST_URL (your open-brain-rest function URL).");
  if (!accessKey) fail("Set OB1_REST_KEY (your MCP_ACCESS_KEY).");
  const res = await fetch(`${baseUrl}${routePath}`, {
    method,
    headers: { "content-type": "application/json", "x-brain-key": accessKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${routePath} -> ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function postgrest(routePath) {
  const url = env("SUPABASE_URL").replace(/\/$/, "");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) fail("Backfill needs SUPABASE_URL (https://<project>.supabase.co).");
  if (!serviceKey) fail("Backfill needs SUPABASE_SERVICE_ROLE_KEY to read entities.");
  const res = await fetch(`${url}/rest/v1${routePath}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GET ${routePath} -> ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Backfill: person entities -> CRM contacts
// ---------------------------------------------------------------------------

async function runBackfill() {
  log(`Backfill (${apply ? "APPLY" : "dry run"}), reading up to ${limit} person entities...`);

  let people;
  try {
    people = await postgrest(
      `/entities?entity_type=eq.person&select=canonical_name,summary,metadata&order=canonical_name.asc&limit=${limit}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/relation .*entities.* does not exist|42P01|Could not find the table/i.test(message)) {
      fail(
        "No `entities` table found. Backfill needs the entity-extraction schema " +
          "(schemas/entity-extraction). Apply it and extract some entities first, " +
          "or skip --backfill and run the --demo instead.",
      );
    }
    throw error;
  }

  if (!Array.isArray(people) || people.length === 0) {
    log("No person entities found -- nothing to backfill.");
    return;
  }

  let created = 0;
  let skipped = 0;
  for (const person of people) {
    const name = (person.canonical_name || "").trim();
    if (!name) continue;

    // Idempotency: skip if a contact with this display name already exists.
    const existing = await gateway(
      "GET",
      `/crm/contacts?q=${encodeURIComponent(name)}&per_page=100&lifecycle_status=all`,
    );
    if ((existing.data || []).some((row) => (row.display_name || "").toLowerCase() === name.toLowerCase())) {
      skipped += 1;
      continue;
    }

    if (!apply) {
      log(`  would create: ${name}`);
      created += 1;
      continue;
    }

    const meta = person.metadata || {};
    const contact = await gateway("POST", "/crm/contacts", {
      display_name: name,
      canonical_email: typeof meta.email === "string" ? meta.email : undefined,
      organization_name: typeof meta.organization === "string" ? meta.organization : undefined,
      actor: "recipe:crm-quick-start",
    });
    log(`  created: ${name} -> ${contact.contact_id}`);
    created += 1;
  }

  log(
    apply
      ? `Backfill done: created ${created}, skipped ${skipped} already-present.`
      : `Dry run: would create ${created}, would skip ${skipped} already-present. Re-run with --apply.`,
  );
}

// ---------------------------------------------------------------------------
// Demo: propose -> resolve -> verify the correction receipt
// ---------------------------------------------------------------------------

async function runDemo() {
  log("Demo: seed a contact, divert a machine write into a proposal, accept it, read the receipt.");

  await gateway("GET", "/health");

  let contactId = null;
  let cardThoughtId = null;
  try {
    // 1. A human creates the contact. crm_create_contact stamps the seeded
    //    fields as 'manual', so job_title is human-owned from here on.
    const created = await gateway("POST", "/crm/contacts", {
      display_name: "Ada Lovelace",
      canonical_email: "ada@example.com",
      organization_name: "Analytical Engines",
      job_title: "Engineer",
      actor: "recipe:crm-quick-start",
    });
    contactId = created.contact_id;
    cardThoughtId = created.record?.card_thought_id || null;
    assert(typeof contactId === "string" && contactId.length > 0, "create returned a contact_id");
    log(`  1. created contact ${contactId} (job_title = "Engineer", provenance manual)`);

    // 2. A machine (origin=extraction) tries to change the human-set job_title.
    //    The truth layer diverts it: applied is empty, proposed carries the value.
    const patched = await gateway("PATCH", `/crm/contacts/${contactId}`, {
      patch: { job_title: "Senior Engineer" },
      origin: "extraction",
      run_id: "crm-quick-start-demo",
      actor: "recipe:crm-quick-start-machine",
    });
    assert(
      Array.isArray(patched.applied) && patched.applied.length === 0,
      "machine write did NOT apply to the human-set field",
    );
    assert(
      Array.isArray(patched.proposed) && patched.proposed.length > 0,
      "machine write was diverted into a proposal",
    );
    log('  2. machine write to job_title was diverted -> proposed, live field still "Engineer"');

    // 3. Find the open proposal for this contact.
    const proposals = await gateway(
      "GET",
      `/crm/proposals?contact_id=${contactId}&status=open&per_page=50`,
    );
    const proposal = (proposals.data || []).find((p) => p.field_key === "job_title");
    assert(proposal && proposal.id, "found the open job_title proposal");
    log(`  3. found open proposal ${proposal.id} for job_title`);

    // 4. A human accepts it. Only now does the canonical field change.
    const resolved = await gateway("POST", `/crm/proposals/${proposal.id}/resolve`, {
      decision: "accept",
      actor: "recipe:crm-quick-start-human",
    });
    assert(resolved.status === "accepted" || resolved.decision === "accept", "proposal was accepted");
    log("  4. human accepted the proposal");

    // 5. The canonical field now reflects the accepted value.
    const detail = await gateway("GET", `/crm/contacts/${contactId}`);
    assert(detail.record?.job_title === "Senior Engineer", "canonical job_title updated after accept");
    log('  5. canonical job_title is now "Senior Engineer"');

    // 6. The correction receipt: the change-log carries a `contact.update` row
    //    whose changed_fields.via_proposal points at the proposal we accepted.
    //    That is the proof the change went through a human, not a silent write.
    const history = await gateway("GET", `/crm/contacts/${contactId}/history`);
    const receipt = (history.history || []).find(
      (row) => row.action === "contact.update" && row.changed_fields?.via_proposal === proposal.id,
    );
    assert(receipt, "found the correction receipt linking the change to the accepted proposal");
    log(`  6. correction receipt found: change-log row ${receipt.id} via_proposal=${proposal.id}`);

    log("Demo passed. The truth layer proposed, a human accepted, and the receipt is on record.");
  } finally {
    if (!keep && contactId) {
      await gateway("PATCH", `/crm/contacts/${contactId}`, {
        patch: { lifecycle_status: "archived" },
        actor: "recipe:crm-quick-start",
      }).catch(() => {});
      if (cardThoughtId) {
        await gateway("DELETE", `/thought/${cardThoughtId}`).catch(() => {});
      }
      log(`Cleaned up demo contact ${contactId} (pass --keep to keep it).`);
    }
  }
}

// ---------------------------------------------------------------------------

function log(message) {
  console.log(message);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

try {
  if (mode === "backfill") {
    await runBackfill();
  } else {
    await runDemo();
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
