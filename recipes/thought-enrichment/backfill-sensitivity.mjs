#!/usr/bin/env node
/**
 * Backfill sensitivity_tier for existing thoughts.
 * Scans thoughts with sensitivity_tier = 'standard' (or null/empty),
 * runs regex-based sensitivity detection on their content, and updates
 * any that should be 'personal' or 'restricted'.
 *
 * Usage:
 *   node backfill-sensitivity.mjs --dry-run    # scan only
 *   node backfill-sensitivity.mjs --apply       # update DB
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchWithTimeout,
  resolveTimeoutMs,
  DEFAULT_SUPABASE_TIMEOUT_MS,
} from "./lib/memory-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_TIMEOUT_MS = resolveTimeoutMs(process.env.FETCH_TIMEOUT_MS, DEFAULT_SUPABASE_TIMEOUT_MS);

// Load env from .env.local
const envPath = path.resolve(__dirname, ".env.local");
const envVars = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      envVars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1).replace(/^['"]|['"]$/g, "");
    }
  }
}

const SUPABASE_URL = envVars.SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL) {
  console.error("Missing SUPABASE_URL in .env.local or environment");
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local or environment");
  process.exit(1);
}

const BASE_URL = `${SUPABASE_URL}/rest/v1`;

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

// --- Sensitivity detection (shared patterns from sensitivity-patterns.json) ---

import { RESTRICTED_PATTERNS, PERSONAL_PATTERNS } from "./lib/sensitivity-patterns.mjs";

function detectSensitivity(text) {
  const reasons = [];

  for (const [pattern, reason] of RESTRICTED_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push(reason);
      return { tier: "restricted", reasons };
    }
  }

  for (const [pattern, reason] of PERSONAL_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push(reason);
    }
  }

  if (reasons.length > 0) {
    return { tier: "personal", reasons };
  }

  return { tier: "standard", reasons: [] };
}

// --- Main ---

const dryRun = process.argv.includes("--dry-run");
const apply = process.argv.includes("--apply");

if (!dryRun && !apply) {
  console.log("Usage:");
  console.log("  node backfill-sensitivity.mjs --dry-run    # scan only");
  console.log("  node backfill-sensitivity.mjs --apply       # update DB");
  process.exit(0);
}

console.log(`Mode: ${dryRun ? "DRY RUN (no changes)" : "APPLY (will update DB)"}`);
console.log();

const BATCH_SIZE = 500;
const PROGRESS_EVERY = 5000;
let afterId = 0;
let scanned = 0;
let scannedAtLastProgress = 0;
let upgradedPersonal = 0;
let upgradedRestricted = 0;
let errors = 0;

// Cursor-based pagination on id. Offset-pagination is unsafe here:
// successful PATCHes shift the "where sensitivity_tier in
// (null,standard,'')" result set, so `offset += BATCH_SIZE` would skip
// un-processed rows. Cursor on id ASC is stable under mutation.
while (true) {
  const url = `${BASE_URL}/thoughts?select=id,content,sensitivity_tier&or=(sensitivity_tier.is.null,sensitivity_tier.eq.standard,sensitivity_tier.eq.)&id=gt.${afterId}&order=id.asc&limit=${BATCH_SIZE}`;
  const res = await fetchWithTimeout(url, { headers }, SUPABASE_TIMEOUT_MS);

  if (!res.ok) {
    console.error(`Query error after id ${afterId}: ${res.status} ${await res.text()}`);
    errors++;
    break;
  }

  const data = await res.json();
  if (!data || data.length === 0) break;

  for (const row of data) {
    scanned++;
    const result = detectSensitivity(row.content || "");

    if (result.tier !== "standard") {
      if (result.tier === "personal") upgradedPersonal++;
      if (result.tier === "restricted") upgradedRestricted++;

      if (apply) {
        const updateUrl = `${BASE_URL}/thoughts?id=eq.${row.id}`;
        const updateRes = await fetchWithTimeout(updateUrl, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ sensitivity_tier: result.tier }),
        }, SUPABASE_TIMEOUT_MS);

        if (!updateRes.ok) {
          console.error(`  Failed to update thought #${row.id}: ${updateRes.status}`);
          errors++;
        }
      }

      if (scanned <= 30 || result.tier === "restricted") {
        console.log(
          `  ${result.tier.toUpperCase()} #${row.id}: ${result.reasons.join(", ")} — "${(row.content || "").slice(0, 80)}..."`
        );
      }
    }
  }

  // Advance the cursor past the last id seen, regardless of whether
  // any rows in this page were upgraded.
  afterId = data[data.length - 1].id;
  if (data.length < BATCH_SIZE) break;

  // Progress reporter independent of a multiple-of-offset check, so
  // partial batches do not silently stop emitting progress.
  if (Math.floor(scanned / PROGRESS_EVERY) > Math.floor(scannedAtLastProgress / PROGRESS_EVERY)) {
    console.log(`  ... scanned ${scanned} thoughts so far (${upgradedPersonal} personal, ${upgradedRestricted} restricted)`);
    scannedAtLastProgress = scanned;
  }
}

console.log();
console.log("=== Results ===");
console.log(`  Scanned:              ${scanned}`);
console.log(`  Upgraded to personal: ${upgradedPersonal}`);
console.log(`  Upgraded to restricted: ${upgradedRestricted}`);
console.log(`  Unchanged:            ${scanned - upgradedPersonal - upgradedRestricted}`);
console.log(`  Errors:               ${errors}`);
console.log(`  Mode:                 ${dryRun ? "DRY RUN (no changes made)" : "APPLIED"}`);
