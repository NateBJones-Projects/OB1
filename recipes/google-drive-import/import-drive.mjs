#!/usr/bin/env node
/**
 * import-drive.mjs — One-time Google Takeout (Drive) importer.
 *
 * Extracts text from docx, md, txt, html, csv files inside a Google
 * Takeout export, then captures each as a thought via Supabase REST
 * (direct upsert_thought RPC) for speed.
 *
 * Usage:
 *   node import-drive.mjs /path/to/Takeout/Drive --dry-run
 *   node import-drive.mjs /path/to/Takeout/Drive --limit 50
 *   node import-drive.mjs /path/to/Takeout/Drive --exts md,docx
 *   node import-drive.mjs /path/to/Takeout/Drive --min-chars 200
 *
 * Env (.env.local in CWD or exported):
 *   OPEN_BRAIN_URL          required — https://<ref>.supabase.co
 *   OPEN_BRAIN_SERVICE_KEY  required — service role key
 *   OPENAI_API_KEY          required — for embeddings
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, extname, basename } from "node:path";
import mammoth from "mammoth";

const PAGE_SIZE = 50;
const MIN_CHARS_DEFAULT = 100;
const MAX_CONTENT = 5000;

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.dir) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const dir = resolve(args.dir);
  if (!existsSync(dir)) fail(`Directory not found: ${dir}`);

  const env = loadEnv();
  if (!env.OPEN_BRAIN_URL) fail("OPEN_BRAIN_URL missing");
  if (!env.OPEN_BRAIN_SERVICE_KEY) fail("OPEN_BRAIN_SERVICE_KEY missing");
  if (!args.dryRun && !env.OPENAI_API_KEY) fail("OPENAI_API_KEY missing (or pass --dry-run)");

  const wantedExts = (args.exts || "md,txt,docx,html,htm,csv").split(",").map(e => `.${e}`.replace(/^\./, "."));
  const minChars = parseInt(args.minChars) || MIN_CHARS_DEFAULT;

  log(`Scanning ${dir} for files (${wantedExts.join(", ")})...`);
  const files = walkDir(dir).filter(f => {
    const ext = extname(f).toLowerCase();
    return wantedExts.includes(ext);
  });
  log(`Found ${files.length} candidate files`);

  let captured = 0, skipped = 0, errors = 0;

  // Build set of transcript basenames for dedup (prefer Transcript over Live Notes)
  const transcriptStems = new Set();
  for (const f of files) {
    const name = basename(f).toLowerCase();
    if (name.includes("transcript")) {
      // Extract the date-stem prefix (e.g., "20250210 - cloudfix bi-weekly checkpoint")
      const stem = name.replace(/[- ]*transcript\.docx/i, "").replace(/[- ]*live notes\.docx/i, "");
      transcriptStems.add(stem);
    }
  }

  for (const filePath of files) {
    if (args.limit && captured >= parseInt(args.limit)) break;

    // Skip "Live Notes" if matching "Transcript" exists
    const nameLC = basename(filePath).toLowerCase();
    if (nameLC.includes("live notes")) {
      const stem = nameLC.replace(/[- ]*live notes\.docx/i, "");
      if (transcriptStems.has(stem)) continue;
    }

    const ext = extname(filePath).toLowerCase();
    let text;
    try {
      text = await extractText(filePath, ext);
    } catch (e) {
      log(`  [skip] ${basename(filePath)}: extract error: ${e.message.slice(0, 100)}`);
      errors++;
      continue;
    }

    if (!text || text.length < minChars) {
      skipped++;
      continue;
    }

    // Truncate very long content
    const content = text.slice(0, MAX_CONTENT);
    const relativePath = filePath.replace(dir + "/", "");
    const title = basename(filePath, ext);
    const dateHint = extractDate(relativePath) || extractDate(text.slice(0, 200));
    const sourceType = guessSourceType(relativePath);

    const metadata = {
      source: "google_drive_import",
      file_path: relativePath,
      file_ext: ext,
      original_length: text.length,
      captured_length: content.length,
      ...(dateHint ? { life_date: dateHint } : {}),
    };

    if (args.dryRun) {
      log(`  [dry] ${relativePath} (${text.length} chars, ${sourceType})`);
      if (args.verbose) log(`        ${content.slice(0, 120).replace(/\n/g, " ")}...`);
      captured++;
      continue;
    }

    // Capture via Supabase REST (direct insert)
    try {
      const embedding = await getEmbedding(env, content.slice(0, 2000));
      await insertThought(env, content, embedding, sourceType, metadata);
      captured++;
      if (captured % 10 === 0) log(`  ${captured} captured...`);
    } catch (e) {
      log(`  [err] ${relativePath}: ${e.message.slice(0, 120)}`);
      errors++;
      // Rate limit backoff
      if (e.message.includes("429") || e.message.includes("rate")) {
        log("  Rate limited, waiting 5s...");
        await sleep(5000);
      }
    }
  }

  log(`\nDone: ${captured} captured, ${skipped} skipped (too short), ${errors} errors`);
}

// ── Text extraction ─────────────────────────────────────────────────────────

async function extractText(filePath, ext) {
  switch (ext) {
    case ".md":
    case ".txt":
    case ".csv":
      return readFileSync(filePath, "utf8");
    case ".docx":
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    case ".html":
    case ".htm":
      const html = readFileSync(filePath, "utf8");
      return stripHtml(html);
    default:
      return readFileSync(filePath, "utf8");
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Embedding ───────────────────────────────────────────────────────────────

async function getEmbedding(env, text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Embedding ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.data[0].embedding;
}

// ── Direct Supabase insert ──────────────────────────────────────────────────

async function insertThought(env, content, embedding, sourceType, metadata) {
  const url = `${env.OPEN_BRAIN_URL}/rest/v1/rpc/upsert_thought`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: env.OPEN_BRAIN_SERVICE_KEY,
      Authorization: `Bearer ${env.OPEN_BRAIN_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      p_content: content,
      p_embedding: embedding,
      p_source_type: sourceType,
      p_metadata: metadata,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Fallback: direct insert
    if (body.includes("function") || body.includes("does not exist")) {
      return directInsert(env, content, embedding, sourceType, metadata);
    }
    throw new Error(`Insert ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function directInsert(env, content, embedding, sourceType, metadata) {
  const url = `${env.OPEN_BRAIN_URL}/rest/v1/thoughts`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: env.OPEN_BRAIN_SERVICE_KEY,
      Authorization: `Bearer ${env.OPEN_BRAIN_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      content,
      embedding,
      source_type: sourceType,
      metadata,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Direct insert ${res.status}: ${body.slice(0, 200)}`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function walkDir(dir) {
  const results = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry === "Trash") continue; // Skip deleted files
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function extractDate(str) {
  // Match YYYY-MM-DD or YYYY_MM_DD or DD-MM-YYYY patterns
  const m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = str.match(/(\d{4})_(\d{2})_(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  // Match 20250602 pattern
  const m3 = str.match(/(\d{4})(\d{2})(\d{2})/);
  if (m3 && m3[2] <= "12" && m3[3] <= "31") return `${m3[1]}-${m3[2]}-${m3[3]}`;
  return null;
}

function guessSourceType(path) {
  const lower = path.toLowerCase();
  if (lower.includes("read ai notes")) return "read_ai_transcript";
  if (lower.includes("my computer/notes")) return "drive_notes";
  if (lower.includes("n8n work")) return "n8n_workflow";
  if (lower.includes("website")) return "seo_analytics";
  if (lower.includes("finder details")) return "finder_docs";
  if (lower.includes("unorganized")) return "drive_document";
  if (lower.includes("bill.gleeson")) return "drive_document";
  return "google_drive_import";
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--verbose" || a === "-v") out.verbose = true;
    else if (a === "--limit") out.limit = argv[++i];
    else if (a === "--exts") out.exts = argv[++i];
    else if (a === "--min-chars") out.minChars = argv[++i];
    else if (!a.startsWith("-")) out.dir = a;
  }
  return out;
}

function printHelp() {
  console.log(`import-drive.mjs — Google Takeout Drive importer

Usage:
  node import-drive.mjs <path-to-Takeout/Drive> [options]

Options:
  --dry-run          Show what would be imported without writing
  --limit N          Max files to process
  --exts LIST        File extensions to process (default: md,txt,docx,html,htm,csv)
  --min-chars N      Skip files with fewer chars (default: 100)
  --verbose          Show content preview
  -h / --help        This text`);
}

function loadEnv() {
  const env = {};
  // Try .env.local in CWD
  const envPath = resolve(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  // Process env overrides
  for (const key of ["OPEN_BRAIN_URL", "OPEN_BRAIN_SERVICE_KEY", "OPENAI_API_KEY"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg) { process.stdout.write(`[drive-import] ${msg}\n`); }
function fail(msg) { process.stderr.write(`[drive-import] ERROR: ${msg}\n`); process.exit(1); }

await main();
