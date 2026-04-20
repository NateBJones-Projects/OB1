#!/usr/bin/env node
/**
 * backfill-type.mjs
 *
 * Backfills the `type` column in the `thoughts` table from metadata.type,
 * for rows where type = 'reference' but metadata contains a valid different type.
 *
 * Usage: node backfill-type.mjs [--dry-run] [--batch-size N]
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  fetchWithTimeout,
  resolveTimeoutMs,
  DEFAULT_SUPABASE_TIMEOUT_MS,
} from "./lib/memory-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_TIMEOUT_MS = resolveTimeoutMs(process.env.FETCH_TIMEOUT_MS, DEFAULT_SUPABASE_TIMEOUT_MS);

// Load env
function loadEnv() {
  const envPath = join(__dirname, ".env.local");
  if (!readFileSync) return {};
  let text;
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    console.error("Missing .env.local — copy .env.local.example and fill in your values.");
    process.exit(1);
  }
  const env = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1).replace(/^['"]|['"]$/g, "");
  }
  return env;
}

const VALID_TYPES = new Set(["idea", "task", "person_note", "reference", "decision", "lesson", "meeting", "journal"]);

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const batchSizeArg = args.indexOf("--batch-size");
const BATCH_SIZE = batchSizeArg !== -1 ? parseInt(args[batchSizeArg + 1], 10) : 500;

const env = loadEnv();
const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error("Missing SUPABASE_URL in .env.local");
  process.exit(1);
}
if (!SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const BASE = `${SUPABASE_URL}/rest/v1`;

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cursor-based pagination on id. Offset pagination is unsafe here:
// every successful PATCH removes a row from the `type=eq.reference`
// filter, so `offset += rows.length` would skip unprocessed rows. The
// cursor pattern is id > afterId ORDER BY id ASC. `includeCount` is
// used once on the first call to populate the total for the progress
// bar — every subsequent call omits the count=exact header so
// PostgreSQL does not COUNT(*) the filtered set per page (LOW-7).
async function fetchBatch(afterId, { includeCount = false } = {}, retries = 4) {
  const url = `${BASE}/thoughts?select=id,metadata->>type&type=eq.reference&id=gt.${afterId}&order=id.asc&limit=${BATCH_SIZE}`;
  const batchHeaders = includeCount ? { ...headers, Prefer: "count=exact" } : { ...headers };
  for (let attempt = 0; attempt <= retries; attempt++) {
    let r;
    try {
      r = await fetchWithTimeout(url, { headers: batchHeaders }, SUPABASE_TIMEOUT_MS);
    } catch (err) {
      // Treat AbortError/timeouts and other network errors as transient.
      const msg = err?.message || String(err);
      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 16000);
        process.stderr.write(`\n[retry] fetch afterId ${afterId} ${msg.slice(0, 120)}, waiting ${delay}ms\n`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
    if (r.ok) {
      const contentRange = r.headers.get("content-range");
      const total = contentRange ? parseInt(contentRange.split("/")[1], 10) : null;
      const rows = await r.json();
      return { rows, total };
    }
    const body = await r.text();
    const isTransient = r.status === 502 || r.status === 503 || r.status === 504 || r.status === 429;
    if (isTransient && attempt < retries) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 16000);
      process.stderr.write(`\n[retry] fetch afterId ${afterId} got ${r.status}, waiting ${delay}ms\n`);
      await sleep(delay);
      continue;
    }
    throw new Error(`Fetch failed after id ${afterId}: ${r.status} ${body.slice(0, 200)}`);
  }
}

async function updateRow(id, newType, retries = 6) {
  const url = `${BASE}/thoughts?id=eq.${id}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let r;
    try {
      r = await fetchWithTimeout(url, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ type: newType }),
      }, SUPABASE_TIMEOUT_MS);
    } catch (err) {
      const msg = err?.message || String(err);
      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 16000);
        process.stderr.write(`\n[retry] id ${id} ${msg.slice(0, 120)}, waiting ${delay}ms (attempt ${attempt + 1}/${retries})\n`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
    if (r.ok) return;
    const body = await r.text();
    const isTransient = r.status === 502 || r.status === 503 || r.status === 504 || r.status === 429;
    if (isTransient && attempt < retries) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 16000);
      process.stderr.write(`\n[retry] id ${id} got ${r.status}, waiting ${delay}ms (attempt ${attempt + 1}/${retries})\n`);
      await sleep(delay);
      continue;
    }
    throw new Error(`Update failed for id ${id}: ${r.status} ${body.slice(0, 200)}`);
  }
}

async function updateBatch(updates) {
  const CONCURRENCY = 5;
  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    const chunk = updates.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(({ id, type }) => updateRow(id, type)));
    if (i + CONCURRENCY < updates.length) await sleep(200);
  }
}

async function main() {
  console.log(`Starting type backfill${DRY_RUN ? " (DRY RUN — no writes)" : ""}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log("");

  // Cursor replaces offset. afterId starts at 0 (all thought ids are
  // positive) and advances to the last id seen in each page, so a
  // PATCH that removes rows from the `type=eq.reference` filter cannot
  // cause the cursor to skip un-processed rows.
  let afterId = 0;
  let processedRows = 0;
  let total = null;
  let firstCountDone = false;
  let totalUpdated = 0;
  let totalSkippedInvalidType = 0;
  let totalSkippedAlreadyCorrect = 0;
  let totalSkippedNullType = 0;

  const invalidTypeLog = {};
  const typeDistribution = {};

  while (true) {
    const { rows, total: fetchedTotal } = await fetchBatch(afterId, {
      includeCount: !firstCountDone,
    });
    firstCountDone = true;

    if (total === null && fetchedTotal !== null) {
      total = fetchedTotal;
      console.log(`Total rows with type='reference': ${total}`);
      console.log("");
    }

    if (!rows || rows.length === 0) break;

    const updates = [];

    for (const row of rows) {
      const metaType = row.type; // aliased from metadata->>type

      if (!metaType || metaType === "" || metaType === "null") {
        totalSkippedNullType++;
        continue;
      }

      if (!VALID_TYPES.has(metaType)) {
        invalidTypeLog[metaType] = (invalidTypeLog[metaType] || 0) + 1;
        totalSkippedInvalidType++;
        continue;
      }

      if (metaType === "reference") {
        totalSkippedAlreadyCorrect++;
        continue;
      }

      updates.push({ id: row.id, type: metaType });
      typeDistribution[metaType] = (typeDistribution[metaType] || 0) + 1;
    }

    if (updates.length > 0) {
      if (!DRY_RUN) {
        await updateBatch(updates);
      }
      totalUpdated += updates.length;
    }

    processedRows += rows.length;
    // Advance cursor past the highest id seen (rows are ordered by id ASC).
    afterId = rows[rows.length - 1].id;

    const pct = total ? ((processedRows / total) * 100).toFixed(1) : "?";
    process.stdout.write(`\rProgress: ${processedRows}/${total ?? "?"} (${pct}%) — updated so far: ${totalUpdated}`);

    if (rows.length < BATCH_SIZE) break;
  }

  console.log("\n");
  console.log("=== BACKFILL COMPLETE ===");
  console.log("");
  console.log(`Rows processed:              ${processedRows}`);
  console.log(`Rows updated:                ${totalUpdated}${DRY_RUN ? " (dry run, not written)" : ""}`);
  console.log(`Skipped (already reference): ${totalSkippedAlreadyCorrect}`);
  console.log(`Skipped (null/empty type):   ${totalSkippedNullType}`);
  console.log(`Skipped (invalid type):      ${totalSkippedInvalidType}`);

  if (Object.keys(invalidTypeLog).length > 0) {
    console.log("");
    console.log("Invalid (non-canonical) type values found in metadata (skipped):");
    for (const [t, c] of Object.entries(invalidTypeLog)) {
      console.log(`  ${t}: ${c}`);
    }
  }

  if (Object.keys(typeDistribution).length > 0) {
    console.log("");
    console.log("Type distribution of updated rows:");
    const sorted = Object.entries(typeDistribution).sort((a, b) => b[1] - a[1]);
    for (const [t, c] of sorted) {
      console.log(`  ${t}: ${c}`);
    }
  }

  console.log("");
  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
