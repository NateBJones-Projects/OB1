#!/usr/bin/env node
/**
 * Retrofit-citations — one-off (but reusable) fixer that rewrites inline
 * thought citations across a compiled wiki vault into clickable markdown
 * links pointing at the thought's row in the Supabase table editor.
 *
 * Companion to retrofit-links.mjs, which linkifies Relationships bullets
 * into [[wikilinks]]. This script targets the OTHER kind of reference these
 * pages carry — inline citations the LLM emits per SYSTEM_PROMPT in
 * generate-wiki.mjs, which show up in the wild as either an 8-char id
 * prefix ("[#5da0ac86]"), a full uuid ("[#5da0ac86-1694-4d42-b1f1-
 * e3b16b506cac]"), or several refs sharing one bracket ("[#5da0ac86,
 * #ee6f5dab]"). generate-wiki.mjs now does this linkification at generation
 * time (see linkifyCitations there) for wikis produced going forward; this
 * script is the one-off fixer for a vault compiled before that change.
 *
 * The citation-token parsing/resolution logic below is intentionally kept
 * in sync BY HAND with generate-wiki.mjs's linkifyCitations. It isn't a
 * straight import because the source of truth differs: generate-wiki.mjs
 * resolves against a single entity's own provenance list (in-memory during
 * a run); this script resolves against the live `thoughts` table, globally,
 * fetched via PostgREST — a wiki compiled today can cite thoughts that have
 * since been deleted, which the entity-scoped list would never see.
 *
 * Everything else on every line is left byte-identical, by construction:
 * the rewrite is a single String.replace() over spans matching
 * "[#...]" — text outside those spans is never touched. Bullets already
 * containing "[[" (Relationships wikilinks) don't match this pattern at
 * all, so retrofit-links.mjs's output is untouched here.
 *
 * Usage:
 *   node recipes/entity-wiki/retrofit-citations.mjs <vaultDir> [--dry-run]
 *     [--citation-url-template <T>] [--backup-suffix <S>]
 *
 * Required env (loaded from .env.local in cwd, like generate-wiki.mjs):
 *   OPEN_BRAIN_URL          https://<ref>.supabase.co
 *   OPEN_BRAIN_SERVICE_KEY  service-role key (server-side only, NEVER anon)
 *
 * Optional env:
 *   OB_WIKI_CITATION_URL_TEMPLATE  see generate-wiki.mjs; must contain a
 *                                   "<uuid>" placeholder.
 *
 * Rerunnable: brackets already turned into markdown links (a "[#...]"
 * immediately followed by "(") are skipped, so running this twice on the
 * same vault is a no-op the second time — same guarantee retrofit-links.mjs
 * documents for its own [[wikilinks]] pass.
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------
// Config + CLI parsing
// ---------------------------------------------------------------

function loadDotEnv() {
  // Same best-effort loader as generate-wiki.mjs — does not overwrite
  // existing env, checks .env.local then .env.
  const candidates = [".env.local", ".env"];
  for (const rel of candidates) {
    const p = path.resolve(process.cwd(), rel);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const k = m[1];
      if (process.env[k] !== undefined) continue;
      process.env[k] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

// There is deliberately no built-in default template: the Supabase project ref
// and table-editor id are deployment-specific (see generate-wiki.mjs). Pass
// --citation-url-template or set OB_WIKI_CITATION_URL_TEMPLATE.
// Matches the ticket's request literally (a fixed, named backup dir) rather
// than deriving today's date at runtime — avoids ambiguity if this script is
// rerun on a different calendar day than the retrofit it was written for.
const DEFAULT_BACKUP_SUFFIX = "2026-07-13-citations";

function parseArgs(argv) {
  const args = {
    vaultDir: null,
    dryRun: false,
    citationUrlTemplate: null,
    backupSuffix: DEFAULT_BACKUP_SUFFIX,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--citation-url-template") args.citationUrlTemplate = next();
    else if (a.startsWith("--citation-url-template=")) args.citationUrlTemplate = a.slice(24);
    else if (a === "--backup-suffix") args.backupSuffix = next();
    else if (a.startsWith("--backup-suffix=")) args.backupSuffix = a.slice(16);
    else if (!args.vaultDir) args.vaultDir = a;
  }
  return args;
}

// ---------------------------------------------------------------
// PostgREST client (service-role key, server-side only)
// ---------------------------------------------------------------

function createSupabase(env) {
  const base = String(env.OPEN_BRAIN_URL || "").replace(/\/$/, "");
  const key = env.OPEN_BRAIN_SERVICE_KEY;
  if (!base || !key) {
    throw new Error("OPEN_BRAIN_URL and OPEN_BRAIN_SERVICE_KEY are required.");
  }
  const restBase = `${base}/rest/v1`;
  const defaultHeaders = {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    // Supabase's gateway rejects secret/service-role key requests that carry
    // a browser-like User-Agent ("Forbidden use of secret API key in
    // browser"). Node's fetch doesn't send one by default, but set an
    // explicit non-browser UA so this keeps working regardless of runtime.
    "user-agent": "ob1-retrofit-script",
  };
  async function get(resource, query) {
    const url = `${restBase}/${resource}${query ? `?${query}` : ""}`;
    const res = await fetch(url, { method: "GET", headers: defaultHeaders });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GET ${url} -> ${res.status}: ${text.slice(0, 500)}`);
    }
    return res.json();
  }
  return { get };
}

async function fetchAllThoughtIds(sb, pageSize = 1000) {
  const ids = [];
  let offset = 0;
  for (;;) {
    const rows =
      (await sb.get("thoughts", `select=id&order=id.asc&limit=${pageSize}&offset=${offset}`)) || [];
    for (const r of rows) if (r.id) ids.push(r.id);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return ids;
}

// ---------------------------------------------------------------
// Citation-token parsing/resolution — kept in sync by hand with
// generate-wiki.mjs's linkifyCitations (see file header for why this isn't
// a shared import). Differs only in resolveCitationToken's return shape
// (carries a reason so this script can report linked/missing/ambiguous
// counts) and in taking a prebuilt prefixMap/fullSet instead of building one
// from a single entity's provenance list each call.
// ---------------------------------------------------------------

const CITATION_BRACKET_RE = /\[#[^\]\n]*\](?!\()/g;
const FULL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_PREFIX_RE = /^[0-9a-f]{8}$/i;

function buildIdIndex(allIds) {
  const prefixMap = new Map();
  const fullSet = new Set();
  for (const id of allIds) {
    if (typeof id !== "string" || !FULL_UUID_RE.test(id)) continue;
    const lower = id.toLowerCase();
    fullSet.add(lower);
    const prefix = lower.slice(0, 8);
    const list = prefixMap.get(prefix) || [];
    list.push(lower);
    prefixMap.set(prefix, list);
  }
  return { prefixMap, fullSet };
}

// reason is one of: null (resolved), "missing", "ambiguous", "not-an-id".
function resolveCitationToken(token, prefixMap, fullSet) {
  if (FULL_UUID_RE.test(token)) {
    const lower = token.toLowerCase();
    return fullSet.has(lower) ? { uuid: lower, reason: null } : { uuid: null, reason: "missing" };
  }
  if (SHORT_PREFIX_RE.test(token)) {
    const matches = prefixMap.get(token.toLowerCase());
    if (!matches || matches.length === 0) return { uuid: null, reason: "missing" };
    if (matches.length > 1) return { uuid: null, reason: "ambiguous" };
    return { uuid: matches[0], reason: null };
  }
  return { uuid: null, reason: "not-an-id" };
}

function linkifyCitations(text, prefixMap, fullSet, urlTemplate, stats) {
  return text.replace(CITATION_BRACKET_RE, (whole) => {
    const inner = whole.slice(2, -1);
    const rawParts = inner.split(",");
    const tokens = [];
    for (let i = 0; i < rawParts.length; i++) {
      let part = rawParts[i].trim();
      if (i > 0) {
        if (!part.startsWith("#")) return whole; // unexpected shape — leave untouched
        part = part.slice(1).trim();
      }
      if (!part) return whole;
      tokens.push(part);
    }

    const resolutions = tokens.map((t) => resolveCitationToken(t, prefixMap, fullSet));
    const tally = (r) => {
      if (r.reason === "missing") stats.missing++;
      else if (r.reason === "ambiguous") stats.ambiguous++;
      else if (r.reason === "not-an-id") stats.notAnId++;
    };

    if (resolutions.every((r) => !r.uuid)) {
      resolutions.forEach(tally);
      return whole; // nothing resolvable — byte-identical, no rewrite
    }

    const pieces = tokens.map((token, i) => {
      const r = resolutions[i];
      if (!r.uuid) {
        tally(r);
        return `[#${token}]`;
      }
      stats.linked++;
      const url = urlTemplate.replace(/<uuid>/g, r.uuid);
      return `[#${token}](${url})`;
    });
    return pieces.join(", ");
  });
}

// ---------------------------------------------------------------
// Vault I/O
// ---------------------------------------------------------------

function listMarkdownFiles(vaultDir) {
  const out = [];
  for (const sub of ["entities", "topics"]) {
    const dir = path.join(vaultDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.toLowerCase().endsWith(".md")) out.push(path.join(dir, name));
    }
  }
  return out;
}

function backupVault(vaultDir, suffix) {
  const parent = path.dirname(vaultDir);
  const base = path.basename(vaultDir);
  const backupDir = path.join(parent, `${base}-backup-${suffix}`);
  if (fs.existsSync(backupDir)) {
    throw new Error(`Backup dir already exists, refusing to overwrite: ${backupDir}`);
  }
  fs.cpSync(vaultDir, backupDir, { recursive: true }); // includes dotfiles, e.g. .obsidian
  return backupDir;
}

// ---------------------------------------------------------------
// Verification
// ---------------------------------------------------------------

// (a) every inserted link's displayed prefix must equal the first 8 chars of
// the uuid embedded in its URL.
function verifyPrefixesMatch(files) {
  const LINK_RE = /\[#([0-9a-f-]+)\]\(([^)]+)\)/gi;
  const mismatches = [];
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    let m;
    while ((m = LINK_RE.exec(content))) {
      const [, token, url] = m;
      const urlMatch = url.match(/id%3Aeq%3A([0-9a-f-]{36})/i);
      const uuidInUrl = urlMatch ? urlMatch[1].toLowerCase() : null;
      const displayedPrefix = token.slice(0, 8).toLowerCase();
      if (!uuidInUrl || uuidInUrl.slice(0, 8) !== displayedPrefix) {
        mismatches.push({ file: filePath, token, url });
      }
    }
  }
  return mismatches;
}

// (b) diff against the backup: every changed line must differ from its
// backup counterpart ONLY by citation-bracket rewrites. We check this by
// stripping every "[#...]" / "[#...](url)" run from both versions of a
// changed line and requiring the remainder to match exactly. This is a
// corroborating empirical check on top of the structural guarantee that
// String.replace() with CITATION_BRACKET_RE cannot touch text outside its
// matches in the first place.
function verifyNoCollateralChanges(files, backupDir, vaultDir) {
  const CITATION_RUN_RE =
    /\[#[^\]]*\](\(https:\/\/supabase\.com\/dashboard\/[^)]*\))?(,\s*\[#[^\]]*\](\(https:\/\/supabase\.com\/dashboard\/[^)]*\))?)*/g;
  const suspect = [];
  for (const filePath of files) {
    const rel = path.relative(vaultDir, filePath);
    const backupPath = path.join(backupDir, rel);
    if (!fs.existsSync(backupPath)) continue;
    const oldLines = fs.readFileSync(backupPath, "utf8").split("\n");
    const newLines = fs.readFileSync(filePath, "utf8").split("\n");
    if (oldLines.length !== newLines.length) {
      suspect.push({ file: filePath, reason: "line count changed" });
      continue;
    }
    for (let i = 0; i < oldLines.length; i++) {
      if (oldLines[i] === newLines[i]) continue;
      const strippedOld = oldLines[i].replace(CITATION_RUN_RE, "\u0000");
      const strippedNew = newLines[i].replace(CITATION_RUN_RE, "\u0000");
      if (strippedOld !== strippedNew) {
        suspect.push({ file: filePath, line: i + 1, old: oldLines[i], new: newLines[i] });
      }
    }
  }
  return suspect;
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.vaultDir) {
    console.error(
      "Usage: node retrofit-citations.mjs <vaultDir> [--dry-run] [--citation-url-template <T>] [--backup-suffix <S>]",
    );
    process.exit(2);
  }
  const vaultDir = path.resolve(args.vaultDir);
  if (!fs.existsSync(vaultDir)) {
    console.error(`Vault dir not found: ${vaultDir}`);
    process.exit(2);
  }
  for (const k of ["OPEN_BRAIN_URL", "OPEN_BRAIN_SERVICE_KEY"]) {
    if (!process.env[k]) {
      console.error(`Missing required env var: ${k}`);
      process.exit(2);
    }
  }
  const urlTemplate =
    args.citationUrlTemplate || process.env.OB_WIKI_CITATION_URL_TEMPLATE || null;
  if (!urlTemplate || !urlTemplate.includes("<uuid>")) {
    console.error(
      "Missing citation URL template: pass --citation-url-template or set OB_WIKI_CITATION_URL_TEMPLATE.\n" +
        'It must contain a "<uuid>" placeholder, e.g.\n' +
        "  https://supabase.com/dashboard/project/<project-ref>/editor/<table-id>?schema=public&filter=id%3Aeq%3A<uuid>",
    );
    process.exit(2);
  }

  return run(args, vaultDir, urlTemplate);
}

async function run(args, vaultDir, urlTemplate) {
  const sb = createSupabase(process.env);
  console.log(`[retrofit-citations] fetching all thought ids from ${process.env.OPEN_BRAIN_URL} ...`);
  const allIds = await fetchAllThoughtIds(sb);
  console.log(`[retrofit-citations] fetched ${allIds.length} thought ids`);
  const { prefixMap, fullSet } = buildIdIndex(allIds);

  const files = listMarkdownFiles(vaultDir);
  console.log(`[retrofit-citations] found ${files.length} markdown files in ${vaultDir}`);

  let backupDir = null;
  if (!args.dryRun) {
    backupDir = backupVault(vaultDir, args.backupSuffix);
    console.log(`[retrofit-citations] backed up vault to ${backupDir}`);
  } else {
    console.log(`[retrofit-citations] --dry-run: skipping backup and writes`);
  }

  const stats = { linked: 0, missing: 0, ambiguous: 0, notAnId: 0, filesTouched: new Set() };

  for (const filePath of files) {
    const original = fs.readFileSync(filePath, "utf8");
    const rewritten = linkifyCitations(original, prefixMap, fullSet, urlTemplate, stats);
    if (rewritten !== original) {
      stats.filesTouched.add(filePath);
      if (!args.dryRun) fs.writeFileSync(filePath, rewritten, "utf8");
    }
  }

  console.log(`\n[retrofit-citations] === results ===`);
  console.log(`[retrofit-citations] files touched:        ${stats.filesTouched.size}`);
  console.log(`[retrofit-citations] refs linked:          ${stats.linked}`);
  console.log(`[retrofit-citations] left plain (missing):   ${stats.missing}`);
  console.log(`[retrofit-citations] left plain (ambiguous): ${stats.ambiguous}`);
  console.log(`[retrofit-citations] left plain (not an id, e.g. LLM hallucination): ${stats.notAnId}`);

  if (!args.dryRun && backupDir) {
    console.log(`\n[retrofit-citations] === verification ===`);
    const mismatches = verifyPrefixesMatch(files);
    console.log(
      `[retrofit-citations] (a) prefix/url consistency: ${mismatches.length === 0 ? "OK — all linked refs match their URL" : `${mismatches.length} MISMATCHES`}`,
    );
    for (const m of mismatches.slice(0, 10)) {
      console.log(`    MISMATCH ${m.file}: token=${m.token} url=${m.url}`);
    }
    const suspect = verifyNoCollateralChanges(files, backupDir, vaultDir);
    console.log(
      `[retrofit-citations] (b) collateral-change check: ${suspect.length === 0 ? "OK — every changed line differs only in citation brackets" : `${suspect.length} SUSPECT LINES`}`,
    );
    for (const s of suspect.slice(0, 10)) {
      console.log(`    SUSPECT ${s.file}:${s.line ?? ""} ${s.reason ?? ""}`);
      if (s.old !== undefined) {
        console.log(`      old: ${s.old}`);
        console.log(`      new: ${s.new}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("[retrofit-citations] FAILED:", err.stack || err.message);
  process.exit(1);
});
