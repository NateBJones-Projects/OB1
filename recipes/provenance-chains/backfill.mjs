#!/usr/bin/env node
/**
 * Backfill provenance on existing Open Brain thoughts.
 *
 * Scans thoughts where source_type matches a derived-artifact pattern (default:
 * any source_type ending in '_pointer' or '_digest' or '_summary') and flips
 * derivation_layer to 'derived' with derivation_method='synthesis'.
 *
 * If the artifact on disk exposes source thought IDs — e.g., a wiki that cites
 * `[#123]` references or a UUID like `#6f7…` — they will be parsed and written
 * to derived_from. If the artifact format lacks IDs (common in human-readable
 * digests), derived_from stays NULL and the row is still marked derived.
 *
 * The script is idempotent: rows already at derivation_layer='derived' are
 * skipped unless --force is passed.
 *
 * Usage:
 *   OPEN_BRAIN_URL=https://<ref>.supabase.co \
 *   OPEN_BRAIN_SERVICE_KEY=<service-role-key> \
 *   node backfill.mjs --dry-run
 *
 *   node backfill.mjs --patterns '_pointer,_digest' --root ./artifacts
 *
 * Flags:
 *   --dry-run          Don't PATCH, just log intended changes
 *   --force            Re-process rows already marked derived
 *   --patterns         Comma-separated source_type suffixes (default: _pointer)
 *   --root             Absolute path to resolve metadata.*_path entries against
 *                      when the stored path is relative. Defaults to cwd.
 *   --limit N          Stop after N candidates (useful for smoke tests)
 *
 * Environment variables:
 *   OPEN_BRAIN_URL           Your Supabase project URL (e.g., https://abc.supabase.co)
 *   OPEN_BRAIN_SERVICE_KEY   service_role key (never the anon key)
 */

import fs from "node:fs";
import path from "node:path";

// ── CLI + env ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    dryRun: false,
    force: false,
    patterns: ["_pointer"],
    root: process.cwd(),
    limit: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else if (a === "--patterns") args.patterns = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--root") args.root = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]) || null;
  }
  return args;
}

const BASE_URL = (process.env.OPEN_BRAIN_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.OPEN_BRAIN_SERVICE_KEY ?? "";

if (!BASE_URL || !SERVICE_KEY) {
  console.error(
    "[backfill] missing env. Set OPEN_BRAIN_URL and OPEN_BRAIN_SERVICE_KEY." +
    "\n  OPEN_BRAIN_URL should look like https://<project-ref>.supabase.co" +
    "\n  OPEN_BRAIN_SERVICE_KEY is your service_role key (never the anon key).",
  );
  process.exit(1);
}

const REST = `${BASE_URL}/rest/v1`;
const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// ── HTTP helpers ───────────────────────────────────────────────────────────

async function sbGet(queryPath) {
  const res = await fetch(`${REST}/${queryPath}`, { headers: HEADERS });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${queryPath}: ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function sbPatch(queryPath, body) {
  const res = await fetch(`${REST}/${queryPath}`, {
    method: "PATCH",
    headers: { ...HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PATCH ${queryPath}: ${res.status} ${text.slice(0, 300)}`);
  }
}

// ── ID extractors ──────────────────────────────────────────────────────────

// Matches UUIDv4-like strings in markdown: "citations: 6f7e…" or "#<uuid>".
// Accepts standard 8-4-4-4-12 hex, case-insensitive.
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

// Matches BIGINT-style `#123` references. The canonical OB1 install uses
// UUIDs, and trace_provenance / find_derivatives cast every derived_from
// element to ::uuid — so writing integer strings here would silently
// corrupt provenance and make downstream RPCs throw 22P02. We detect the
// pattern only so we can FAIL LOUDLY instead of writing junk.
const INT_REF_RE = /#(\d{1,18})\b/g;

function parseParentIds(markdown, rowId) {
  if (!markdown) return [];
  const ids = new Set();
  const uuidMatches = markdown.match(UUID_RE) ?? [];
  for (const u of uuidMatches) ids.add(u.toLowerCase());
  const intMatches = markdown.match(INT_REF_RE) ?? [];
  if (intMatches.length > 0) {
    // Reject — canonical OB1 is UUID-typed and downstream consumers cast
    // every parent id to ::uuid. A user on a BIGINT fork must skip backfill
    // and repopulate derived_from themselves (or hand-edit the INT_REF_RE
    // logic to return the integers uncasted).
    throw new Error(
      `id=${rowId}: refusing to write ${intMatches.length} integer ref(s) ` +
      `(${intMatches.slice(0, 3).map((m) => m).join(", ")}${intMatches.length > 3 ? ", …" : ""}) ` +
      `to derived_from on a UUID install. Integer IDs are not supported by the ` +
      `canonical trace_provenance / find_derivatives helpers. If your fork uses ` +
      `BIGINT, remove the integer refs from the artifact or skip this row.`,
    );
  }
  return Array.from(ids);
}

function resolveArtifactPath(pointer, rootDir) {
  const m = pointer.metadata ?? {};
  // Conventions used by common Open Brain recipes:
  //   wiki_pointer.metadata.wiki_path
  //   lint_sweep_pointer.metadata.report_path
  //   weekly_digest_pointer.metadata.digest_path
  // The script also accepts a generic 'artifact_path' key.
  const raw = m.wiki_path ?? m.report_path ?? m.digest_path ?? m.artifact_path;
  if (!raw || typeof raw !== "string") return null;
  return path.isAbsolute(raw) ? raw : path.join(rootDir, raw);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[backfill] dry-run=${args.dryRun} force=${args.force} patterns=${args.patterns.join("|")} root=${args.root}`);

  // Fetch pointer candidates — any source_type ending in one of our patterns.
  // Use PostgREST 'or=' with 'like' filters to avoid N round-trips.
  const orClauses = args.patterns.map((p) => `source_type.like.*${p}`).join(",");
  const limitClause = args.limit ? `&limit=${args.limit}` : "";
  const query = `thoughts?select=id,source_type,metadata,derivation_layer&or=(${orClauses})&order=created_at.asc${limitClause}`;
  const rows = await sbGet(query);
  console.log(`[backfill] found ${rows.length} candidate thoughts`);

  const summary = {
    total: rows.length,
    patched: 0,
    skippedAlreadyDerived: 0,
    patchedWithParents: 0,
    patchedWithoutParents: 0,
    errors: 0,
  };

  for (const row of rows) {
    if (row.derivation_layer === "derived" && !args.force) {
      summary.skippedAlreadyDerived++;
      continue;
    }

    const artifactPath = resolveArtifactPath(row, args.root);
    let derivedFrom = null;
    let reason = "no artifact path on metadata";

    if (artifactPath) {
      try {
        if (fs.existsSync(artifactPath)) {
          const md = fs.readFileSync(artifactPath, "utf8");
          // Throws on any integer-style (#123) reference. We surface the
          // error on this row and keep processing the rest — the row is
          // still flipped to derivation_layer='derived' but without
          // derived_from, so operators can fix the artifact and re-run
          // with --force.
          const parsed = parseParentIds(md, row.id);
          if (parsed.length > 0) {
            derivedFrom = parsed;
            reason = `parsed ${parsed.length} parent id(s) from ${path.basename(artifactPath)}`;
          } else {
            reason = `artifact has no parsable parent IDs (${path.basename(artifactPath)})`;
          }
        } else {
          reason = `artifact file not found: ${artifactPath}`;
        }
      } catch (err) {
        reason = `parse error: ${err.message}`;
      }
    }

    const patch = {
      derivation_layer: "derived",
      derivation_method: "synthesis",
    };
    if (derivedFrom) patch.derived_from = derivedFrom;

    console.log(
      `  ${args.dryRun ? "[DRY]" : "[PATCH]"} id=${row.id} source=${row.source_type} ` +
      `derived_from=${derivedFrom ? `${derivedFrom.length} ids` : "NULL"} (${reason})`,
    );

    if (!args.dryRun) {
      try {
        await sbPatch(`thoughts?id=eq.${row.id}`, patch);
        summary.patched++;
        if (derivedFrom) summary.patchedWithParents++;
        else summary.patchedWithoutParents++;
      } catch (err) {
        console.error(`  ERROR id=${row.id}: ${err.message}`);
        summary.errors++;
      }
    }
  }

  console.log("\n[backfill] summary:", summary);
  if (summary.errors > 0) process.exit(2);
}

main().catch((err) => {
  console.error("[backfill] FAILED:", err.message);
  process.exit(1);
});
