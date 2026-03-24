#!/usr/bin/env node
/**
 * Find and remove duplicate thoughts that have NULL content_fingerprint
 * when a canonical copy (with fingerprint) already exists.
 *
 * Default behavior: REPORT ONLY. Pass --delete to actually remove duplicates.
 *
 * Strategy:
 *   1. Fetch batches of NULL-fingerprint rows (id cursor, ascending)
 *   2. Compute fingerprint for each using canonical normalization
 *   3. Batch-lookup which fingerprints already exist in the table
 *   4. Report (or delete) confirmed duplicates
 *   5. For genuine orphans (no duplicate), backfill the fingerprint
 *
 * Fingerprint normalization matches the content-fingerprint-dedup primitive:
 *   trim + collapse whitespace + lowercase + strip trailing punctuation +
 *   strip possessives + strip trailing 's' from words > 3 chars
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Parse CLI flags ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DESTRUCTIVE = args.includes("--delete");
const REPORT_ONLY = args.includes("--report-only") || !DESTRUCTIVE;

// ── Load environment ────────────────────────────────────────────────────────

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const raw = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const env = {
  ...loadEnv(path.join(__dirname, ".env")),
  ...loadEnv(path.join(__dirname, ".env.local")),
};

const SUPABASE_URL = env.SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY =
  env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Set them in .env, .env.local, or as environment variables."
  );
  process.exit(1);
}

const REST_BASE = `${SUPABASE_URL}/rest/v1`;
const HEADERS = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

// ── Fingerprint logic (matches content-fingerprint-dedup primitive) ─────────

function normalizeForFingerprint(text) {
  let s = String(text ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (!s) return "";
  s = s.replace(/[.!?;:,]+$/, "");
  s = s.replace(/['\u2019]s\b/g, "");
  s = s.replace(/(\w{4,})s$/, "$1");
  return s.trim();
}

function buildFingerprint(text) {
  const normalized = normalizeForFingerprint(text);
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

// ── REST helpers ────────────────────────────────────────────────────────────

async function fetchBatch(cursorId, batchSize) {
  const url =
    `${REST_BASE}/thoughts` +
    `?content_fingerprint=is.null` +
    `&id=gt.${cursorId}` +
    `&select=id,content` +
    `&limit=${batchSize}` +
    `&order=id.asc`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Fetch HTTP ${res.status} — ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  if (!text) return [];
  return JSON.parse(text);
}

async function checkFingerprintsExist(hashes) {
  if (!hashes.length) return new Set();
  const CHUNK = 100;
  const existingSet = new Set();
  for (let i = 0; i < hashes.length; i += CHUNK) {
    const chunk = hashes.slice(i, i + CHUNK);
    const inList = chunk.join(",");
    const url = `${REST_BASE}/thoughts?content_fingerprint=in.(${inList})&select=content_fingerprint&limit=${CHUNK * 2}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`CheckExists HTTP ${res.status} — ${body.slice(0, 200)}`);
    }
    const rows = await res.json();
    for (const r of rows) {
      if (r.content_fingerprint) existingSet.add(r.content_fingerprint);
    }
  }
  return existingSet;
}

async function deleteIds(ids) {
  if (!ids.length) return 0;
  const CHUNK = 200;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const url = `${REST_BASE}/thoughts?id=in.(${chunk.join(",")})`;
    const res = await fetch(url, { method: "DELETE", headers: HEADERS });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`DELETE HTTP ${res.status} — ${body.slice(0, 200)}`);
    }
    deleted += chunk.length;
  }
  return deleted;
}

async function patchFingerprint(id, fingerprint) {
  const url = `${REST_BASE}/thoughts?id=eq.${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify({ content_fingerprint: fingerprint }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `PATCH id=${id}: HTTP ${res.status} — ${body.slice(0, 200)}`
    );
  }
}

// ── State ───────────────────────────────────────────────────────────────────

const STATE_FILE = path.join(__dirname, "cleanup-state.json");

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {
      cursorId: 0,
      totalDeleted: 0,
      totalPatched: 0,
      totalWouldDelete: 0,
      totalErrors: 0,
      batches: 0,
    };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Main ────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 500;

async function main() {
  const state = loadState();

  if (REPORT_ONLY) {
    console.log("=== Duplicate Report (read-only) ===");
    console.log(
      "Run with --delete to actually remove duplicates.\n"
    );
  } else {
    console.log("=== Delete Duplicate NULL-Fingerprint Rows ===");
    console.log("WARNING: This will DELETE rows. Ctrl+C to abort.\n");
  }

  console.log(
    `Resuming from cursor id=${state.cursorId} (deleted: ${state.totalDeleted}, patched: ${state.totalPatched})`
  );
  console.log(`Batch size: ${BATCH_SIZE}\n`);

  while (true) {
    state.batches++;
    process.stdout.write(
      `Batch ${state.batches}: fetching from id>${state.cursorId}… `
    );

    let rows;
    try {
      rows = await fetchBatch(state.cursorId, BATCH_SIZE);
    } catch (err) {
      console.error("\n  Fetch error:", err.message, "— retrying in 5s…");
      await new Promise((r) => setTimeout(r, 5000));
      state.batches--;
      continue;
    }

    if (!rows || rows.length === 0) {
      console.log("(no rows) — Done.");
      break;
    }

    console.log(`${rows.length} rows`);

    const rowsWithFp = rows.map((row) => ({
      id: row.id,
      fingerprint: buildFingerprint(row.content),
    }));

    const allHashes = rowsWithFp.map((r) => r.fingerprint);
    let existingSet;
    try {
      existingSet = await checkFingerprintsExist(allHashes);
    } catch (err) {
      console.error(
        "  Check-exists error:",
        err.message,
        "— retrying in 5s…"
      );
      await new Promise((r) => setTimeout(r, 5000));
      state.batches--;
      continue;
    }

    const duplicateRows = rowsWithFp.filter((r) =>
      existingSet.has(r.fingerprint)
    );
    const orphanRows = rowsWithFp.filter(
      (r) => !existingSet.has(r.fingerprint)
    );

    process.stdout.write(
      `  ${duplicateRows.length} duplicates, ${orphanRows.length} orphans. `
    );

    if (REPORT_ONLY) {
      state.totalWouldDelete += duplicateRows.length;
      console.log(`(would delete ${duplicateRows.length})`);
    } else {
      // Delete duplicates
      let deletedThisBatch = 0;
      if (duplicateRows.length > 0) {
        try {
          deletedThisBatch = await deleteIds(
            duplicateRows.map((r) => r.id)
          );
          state.totalDeleted += deletedThisBatch;
        } catch (err) {
          state.totalErrors++;
          console.error("\n  DELETE error:", err.message);
        }
      }

      // Patch genuine orphans
      let patchedThisBatch = 0;
      for (const { id, fingerprint } of orphanRows) {
        try {
          await patchFingerprint(id, fingerprint);
          patchedThisBatch++;
          state.totalPatched++;
        } catch (err) {
          state.totalErrors++;
          console.warn(
            `  PATCH orphan error id=${id}:`,
            err.message.slice(0, 120)
          );
        }
      }

      console.log(
        `Deleted ${deletedThisBatch}, patched ${patchedThisBatch}.`
      );
    }

    // Advance cursor
    const maxId = rows[rows.length - 1].id;
    state.cursorId = maxId;
    saveState(state);

    console.log(
      `  Totals: deleted=${state.totalDeleted}, patched=${state.totalPatched}, ` +
        `would-delete=${state.totalWouldDelete}, errors=${state.totalErrors}. ` +
        `Cursor: ${state.cursorId}`
    );

    await new Promise((r) => setTimeout(r, 200));
  }

  console.log();
  console.log("=== COMPLETE ===");
  if (REPORT_ONLY) {
    console.log(`Total rows that would be deleted: ${state.totalWouldDelete}`);
    console.log(`\nRun with --delete to actually remove them.`);
  } else {
    console.log(`Total rows deleted  : ${state.totalDeleted}`);
    console.log(`Total rows patched  : ${state.totalPatched}`);
    console.log(`Total errors        : ${state.totalErrors}`);
  }

  try {
    fs.unlinkSync(STATE_FILE);
  } catch {}
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
