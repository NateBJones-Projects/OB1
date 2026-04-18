#!/usr/bin/env node
/**
 * backup-brain.mjs -- Export all Open Brain Supabase tables to local JSON files.
 *
 * Paginates through PostgREST (1000 rows per request) and writes each table
 * to backup/<table>-YYYY-MM-DD.json. Shows progress and prints a summary.
 *
 * Usage:
 *   node backup-brain.mjs
 *
 * The script reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
 * environment variables or from a .env.local file in the current directory.
 */

import fs from "node:fs";
import path from "node:path";

const SCRIPT_DIR = process.cwd();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PAGE_SIZE = 1000;

// Stock Open Brain only has `thoughts`. The other tables are from optional
// companion contributions (entity extraction, smart ingest). Missing tables
// are skipped at runtime so this recipe works against any Open Brain install.
const TABLES = [
  { name: "thoughts",         orderBy: "id", required: true  },
  { name: "entities",         orderBy: "id", required: false },
  { name: "edges",            orderBy: "id", required: false },
  { name: "thought_entities", orderBy: "thought_id,entity_id", required: false },
  { name: "ingestion_jobs",   orderBy: "id", required: false },
  { name: "ingestion_items",  orderBy: "id", required: false },
];

// ---------------------------------------------------------------------------
// Env loading
// ---------------------------------------------------------------------------

function loadEnvFile() {
  const envPath = path.join(SCRIPT_DIR, ".env.local");
  const vars = {};
  if (fs.existsSync(envPath)) {
    let isFirstLine = true;
    for (let line of fs.readFileSync(envPath, "utf8").split("\n")) {
      // Strip UTF-8 BOM from the first line -- Notepad and some VS Code
      // configurations on Windows write it, which would otherwise poison
      // the first key name (e.g. "\uFEFFSUPABASE_URL") and cause a
      // confusing "SUPABASE_URL not found" even though it's right there.
      if (isFirstLine && line.charCodeAt(0) === 0xFEFF) line = line.slice(1);
      isFirstLine = false;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1).replace(/^['"]|['"]$/g, "");
      }
    }
  }
  return vars;
}

const envVars = loadEnvFile();

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  envVars.SUPABASE_URL ||
  "";

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  envVars.SUPABASE_SERVICE_ROLE_KEY ||
  "";

if (!SUPABASE_URL) {
  console.error(
    "ERROR: SUPABASE_URL not found.\n" +
    "Either export it or add it to .env.local in the current directory."
  );
  process.exit(1);
}

if (!SERVICE_KEY) {
  console.error(
    "ERROR: SUPABASE_SERVICE_ROLE_KEY not found.\n" +
    "Either export it or add it to .env.local in the current directory."
  );
  process.exit(1);
}

const REST_BASE = `${SUPABASE_URL}/rest/v1`;

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "count=exact",
};

// Bounded per-request timeout. Unattended backup jobs must either finish or
// fail within a predictable window -- a hung connection should not keep a
// cron job alive forever. 60s is generous for a 1000-row page; override with
// FETCH_TIMEOUT_MS for slow tiers or very large tables.
const FETCH_TIMEOUT_MS = (() => {
  const raw =
    process.env.FETCH_TIMEOUT_MS ||
    envVars.FETCH_TIMEOUT_MS ||
    "";
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10);
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Fetch a single page of rows from a table. */
async function fetchPage(table, orderBy, offset, limit) {
  const url = `${REST_BASE}/${table}?order=${orderBy}&limit=${limit}&offset=${offset}`;
  const rangeEnd = offset + limit - 1;

  // Node 18+ fetch() has no default timeout. Wire up AbortController so a
  // hung Supabase connection can't hang the whole backup run.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      headers: {
        ...HEADERS,
        Range: `${offset}-${rangeEnd}`,
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error(
        `PostgREST request for ${table} timed out after ${FETCH_TIMEOUT_MS} ms ` +
        `(raise FETCH_TIMEOUT_MS if this table is legitimately slow)`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) {
    // PostgREST returns 404 with `code: "PGRST205"` when the table is not in
    // the schema cache. Any other 404 (typo in SUPABASE_URL, paused project,
    // wrong schema, custom API gateway) should surface loudly, not be
    // silently treated as "table missing" -- that's how backup tools lose
    // data without anyone noticing.
    const rawBody = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(rawBody); } catch {}
    if (parsed && parsed.code === "PGRST205") {
      return { rows: [], total: null, missing: true };
    }
    throw new Error(`PostgREST error 404 on ${table}: ${rawBody}`);
  }

  if (!res.ok && res.status !== 206) {
    const body = await res.text();
    throw new Error(`PostgREST error ${res.status} on ${table}: ${body}`);
  }

  let total = null;
  const cr = res.headers.get("content-range");
  if (cr) {
    const match = cr.match(/\/(\d+|\*)/);
    if (match && match[1] !== "*") total = parseInt(match[1], 10);
  }

  const rows = await res.json();
  return { rows, total };
}

/** Export one table, streaming rows to disk. */
async function exportTable(tableName, orderBy, backupDir, dateStr, required) {
  const filePath = path.join(backupDir, `${tableName}-${dateStr}.json`);
  // Write to a sibling .tmp file and atomically rename on success. Any crash
  // (network error, process kill) leaves only the .tmp behind, so yesterday's
  // valid backup is never overwritten by today's partial one.
  const tmpPath = `${filePath}.tmp`;
  let offset = 0;
  let total = null;
  let rowCount = 0;

  const first = await fetchPage(tableName, orderBy, 0, PAGE_SIZE);

  const label = `  ${tableName}`;
  if (first.missing) {
    if (required) {
      throw new Error(`Required table "${tableName}" not found in Supabase project`);
    }
    process.stdout.write(`${label}: skipped (table not present)\n`);
    return { rowCount: 0, filePath: null, fileSize: 0, skipped: true };
  }

  total = first.total;

  if (first.rows.length === 0) {
    process.stdout.write(`${label}: 0 rows (empty table)\n`);
    // Even the two-byte "[]" path writes via tmp+rename so we never leave a
    // half-written file in the final location.
    try {
      fs.writeFileSync(tmpPath, "[]");
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch {}
      throw err;
    }
    return { rowCount: 0, filePath, fileSize: 2 };
  }

  const fd = fs.openSync(tmpPath, "w");
  let closed = false;
  try {
    fs.writeSync(fd, "[\n");
    let firstRow = true;

    function writeRows(rows) {
      for (const row of rows) {
        if (!firstRow) fs.writeSync(fd, ",\n");
        fs.writeSync(fd, JSON.stringify(row));
        firstRow = false;
        rowCount++;
      }
    }

    writeRows(first.rows);
    process.stdout.write(
      `${label}: ${rowCount}${total != null ? "/" + total : ""} rows\r`
    );

    let lastPageSize = first.rows.length;
    offset = PAGE_SIZE;
    while (lastPageSize === PAGE_SIZE && (total == null || offset < total)) {
      const page = await fetchPage(tableName, orderBy, offset, PAGE_SIZE);
      lastPageSize = page.rows.length;
      if (lastPageSize === 0) break;
      writeRows(page.rows);
      offset += lastPageSize;

      process.stdout.write(
        `${label}: ${rowCount}${total != null ? "/" + total : ""} rows\r`
      );
    }

    fs.writeSync(fd, "\n]");
    fs.closeSync(fd);
    closed = true;

    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (!closed) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }

  const fileSize = fs.statSync(filePath).size;

  process.stdout.write(
    `${label}: ${rowCount} rows (${humanSize(fileSize)})               \n`
  );

  return { rowCount, filePath, fileSize };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dateStr = today();
  const backupDir = path.join(SCRIPT_DIR, "backup");

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    console.log(`Created ${backupDir}`);
  }

  console.log(`\nOpen Brain Backup -- ${dateStr}`);
  console.log(`Target: ${backupDir}\n`);

  const results = [];
  for (const table of TABLES) {
    try {
      const result = await exportTable(table.name, table.orderBy, backupDir, dateStr, table.required);
      results.push({ table: table.name, ...result });
    } catch (err) {
      console.error(`\n  ERROR exporting ${table.name}: ${err.message}`);
      results.push({ table: table.name, rowCount: 0, filePath: null, fileSize: 0, error: err.message });
    }
  }

  const totalRows = results.reduce((s, r) => s + r.rowCount, 0);
  const totalSize = results.reduce((s, r) => s + r.fileSize, 0);

  console.log("\n--- Backup Summary ---");
  console.log(`Date:  ${dateStr}`);
  console.log(`Dir:   ${backupDir}\n`);

  const colTable = "Table".padEnd(20);
  const colRows  = "Rows".padStart(8);
  const colSize  = "Size".padStart(10);
  console.log(`${colTable}${colRows}${colSize}`);
  console.log("-".repeat(38));

  for (const r of results) {
    const name = r.table.padEnd(20);
    const rows = String(r.rowCount).padStart(8);
    const size = (r.error ? "ERROR" : humanSize(r.fileSize)).padStart(10);
    console.log(`${name}${rows}${size}`);
  }

  console.log("-".repeat(38));
  console.log(`${"TOTAL".padEnd(20)}${String(totalRows).padStart(8)}${humanSize(totalSize).padStart(10)}`);
  console.log(`\nDone. ${results.filter(r => !r.error).length}/${results.length} tables exported successfully.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
