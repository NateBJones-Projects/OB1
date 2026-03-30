#!/usr/bin/env node
/**
 * Backfill content_fingerprint for all thoughts rows where it is NULL.
 *
 * Fingerprint normalization (matches content-fingerprint-dedup primitive):
 *   1. Trim + collapse whitespace + lowercase
 *   2. Strip trailing punctuation (.!?;:,)
 *   3. Strip possessives ('s / \u2019s)
 *   4. Strip trailing 's' from last word (if word length > 3)
 *   5. SHA-256 hex of the normalized string
 *
 * Uses an id cursor so interrupted runs can resume from where they left off.
 * State is saved to a local JSON file after each batch.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

/**
 * Normalize text for fingerprint comparison.
 * Must match the SQL `normalize_for_fingerprint(text)` function exactly.
 */
function normalizeForFingerprint(text) {
  let s = String(text ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (!s) return "";

  // Strip trailing punctuation
  s = s.replace(/[.!?;:,]+$/, "");

  // Strip possessives
  s = s.replace(/['\u2019]s\b/g, "");

  // Strip trailing 's' from last word if word length > 3
  s = s.replace(/(\w{4,})s$/, "$1");

  return s.trim();
}

function buildContentFingerprint(text) {
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

async function patchFingerprint(id, fingerprint) {
  const url = `${REST_BASE}/thoughts?id=eq.${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify({ content_fingerprint: fingerprint }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PATCH id=${id}: HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
}

async function patchBatch(updates) {
  const CONCURRENCY = 20;
  let done = 0;
  let duplicates = 0;
  let errors = 0;

  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    const chunk = updates.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(({ id, fingerprint }) => patchFingerprint(id, fingerprint))
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        done++;
      } else {
        const msg = result.reason?.message ?? String(result.reason);
        if (msg.includes("409") || msg.includes("23505")) {
          duplicates++;
        } else {
          errors++;
          console.warn("  PATCH error:", msg.slice(0, 180));
        }
      }
    }
  }
  return { done, duplicates, errors };
}

// ── State file for resume ───────────────────────────────────────────────────

const STATE_FILE = path.join(__dirname, "backfill-state.json");

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {
      cursorId: 0,
      totalDone: 0,
      totalDuplicates: 0,
      totalErrors: 0,
      batches: 0,
    };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Main ────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 1000;

async function main() {
  const state = loadState();
  console.log("=== Backfill content_fingerprint ===");
  console.log(
    `Resuming from cursor id=${state.cursorId} (${state.totalDone} already done)`
  );
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log();

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

    console.log(`${rows.length} rows. Patching…`);

    const updates = rows.map((row) => ({
      id: row.id,
      fingerprint: buildContentFingerprint(row.content ?? ""),
    }));

    const { done, duplicates, errors } = await patchBatch(updates);
    state.totalDone += done;
    state.totalDuplicates += duplicates;
    state.totalErrors += errors;

    const maxId = rows[rows.length - 1].id;
    state.cursorId = typeof maxId === "number" ? maxId : maxId;
    saveState(state);

    const dupeStr =
      duplicates > 0 ? `, ${duplicates} duplicates (skipped)` : "";
    const errStr = errors > 0 ? `, ${errors} errors` : "";
    console.log(
      `  → ${done} patched${dupeStr}${errStr}. ` +
        `Total: ${state.totalDone} patched, ${state.totalDuplicates} duplicates, ${state.totalErrors} errors. ` +
        `Cursor: ${state.cursorId}`
    );

    await new Promise((r) => setTimeout(r, 150));
  }

  console.log();
  console.log("=== COMPLETE ===");
  console.log(`Total rows backfilled   : ${state.totalDone}`);
  console.log(`Total duplicate skipped : ${state.totalDuplicates}`);
  console.log(`Total other errors      : ${state.totalErrors}`);

  try {
    fs.unlinkSync(STATE_FILE);
    console.log("State file cleaned up.");
  } catch {}
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
