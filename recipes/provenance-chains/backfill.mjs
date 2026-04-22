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
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
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
 * Environment variables (canonical names preferred, legacy names accepted
 * with a one-time deprecation warning so existing setups keep working):
 *   SUPABASE_URL               Your Supabase project URL (https://<ref>.supabase.co)
 *   SUPABASE_SERVICE_ROLE_KEY  service_role key (never the anon key)
 *
 *   Legacy (deprecated): OPEN_BRAIN_URL, OPEN_BRAIN_SERVICE_KEY
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

// Canonical names first, legacy OPEN_BRAIN_* accepted as a fallback so
// existing setups keep working. Warn once per run if legacy names are in use.
const URL_FROM_CANONICAL = process.env.SUPABASE_URL;
const URL_FROM_LEGACY = process.env.OPEN_BRAIN_URL;
const KEY_FROM_CANONICAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KEY_FROM_LEGACY = process.env.OPEN_BRAIN_SERVICE_KEY;

if (
  (!URL_FROM_CANONICAL && URL_FROM_LEGACY) ||
  (!KEY_FROM_CANONICAL && KEY_FROM_LEGACY)
) {
  console.warn(
    "[backfill] DEPRECATION: OPEN_BRAIN_URL / OPEN_BRAIN_SERVICE_KEY are the " +
    "legacy names. Prefer SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — every " +
    "other OB1 recipe uses those and the fallback will be removed in a future " +
    "release.",
  );
}

const BASE_URL = (URL_FROM_CANONICAL ?? URL_FROM_LEGACY ?? "").replace(/\/+$/, "");
const SERVICE_KEY = KEY_FROM_CANONICAL ?? KEY_FROM_LEGACY ?? "";

if (!BASE_URL || !SERVICE_KEY) {
  console.error(
    "[backfill] missing env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." +
    "\n  SUPABASE_URL should look like https://<project-ref>.supabase.co" +
    "\n  SUPABASE_SERVICE_ROLE_KEY is your service_role key (never the anon key)." +
    "\n  (Legacy OPEN_BRAIN_URL / OPEN_BRAIN_SERVICE_KEY are still accepted.)",
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
  // `return=representation` forces PostgREST to send the affected rows back
  // in the response body, and `count=exact` adds a Content-Range header
  // with the row count. We need BOTH because under the old
  // `return=minimal` semantics a zero-row PATCH is silent — the HTTP 200
  // reply looks identical whether we updated a row or matched nothing.
  // That silence used to hide concurrent deletes (the row vanished between
  // candidate fetch and PATCH) as "half-migrated" once the follow-up RPC
  // raised `no_data_found`. Returning the rows lets the caller classify
  // "deleted during backfill" distinctly.
  //
  // See: https://docs.postgrest.org/en/v12/references/api/preferences.html
  const res = await fetch(`${REST}/${queryPath}`, {
    method: "PATCH",
    headers: {
      ...HEADERS,
      Prefer: "return=representation,count=exact",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PATCH ${queryPath}: ${res.status} ${text.slice(0, 300)}`);
  }
  // Prefer Content-Range (`0-0/1`, `*/0`, etc.) when available; fall back
  // to counting the returned body array length if the header is missing.
  let rowCount = null;
  const cr = res.headers.get("content-range");
  if (cr) {
    // Content-Range: "0-0/1" → matched 1 row, "*/0" → matched 0.
    const m = cr.match(/\/(\d+|\*)$/);
    if (m && m[1] !== "*") {
      const n = Number(m[1]);
      if (Number.isFinite(n)) rowCount = n;
    }
  }
  if (rowCount === null) {
    try {
      const body = await res.json();
      if (Array.isArray(body)) rowCount = body.length;
    } catch {
      // If we cannot parse the body, leave rowCount null so callers can
      // fall back to pre-fix behavior rather than crash.
    }
  }
  return { rowCount };
}

// POST to a PostgREST RPC endpoint. The server-side function is expected to
// RETURNS VOID, so we ask PostgREST not to send a body back (`return=minimal`)
// and we do not try to parse one here.
async function sbRpc(fnName, body) {
  const res = await fetch(`${REST}/rpc/${fnName}`, {
    method: "POST",
    headers: { ...HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RPC ${fnName}: ${res.status} ${text.slice(0, 300)}`);
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
  // Canonical public.thoughts keeps source_type inside metadata, not as a
  // top-level column, so we filter and select via metadata->>'source_type'.
  // PostgREST supports the JSON arrow in both select (returned as
  // `source_type`) and or=() predicates.
  const orClauses = args.patterns
    .map((p) => `metadata->>source_type.like.*${p}`)
    .join(",");
  const limitClause = args.limit ? `&limit=${args.limit}` : "";
  // We still select `metadata` because resolveArtifactPath reads pointer
  // paths (wiki_path / report_path / digest_path / artifact_path) from it.
  // The snapshot is READ-ONLY in this script: the metadata mirror is now
  // performed server-side via `merge_thought_provenance_metadata`, which
  // does its read-modify-write inside a single UPDATE. We never PATCH the
  // whole `metadata` blob back from a stale JS copy, so eval.mjs writes
  // (eval_score, eval_dimensions, …) landing between this GET and the
  // merge RPC cannot be silently overwritten.
  const query =
    `thoughts?select=id,source_type:metadata->>source_type,metadata,derivation_layer` +
    `&or=(${orClauses})&order=created_at.asc${limitClause}`;
  const rows = await sbGet(query);
  console.log(`[backfill] found ${rows.length} candidate thoughts`);

  const summary = {
    total: rows.length,
    patched: 0,
    skippedAlreadyDerived: 0,
    patchedWithParents: 0,
    patchedWithoutParents: 0,
    errors: 0,
    halfMigrated: 0,
    // Rows whose artifact could not be parsed (e.g., INT_REF_RE matches on
    // a UUID install). The caller still flips derivation_layer='derived'
    // with backfill_reason="parse error: ..." so the row is not left
    // half-migrated, but the provenance was NOT captured. Count separately
    // from transport errors — re-running `--force` won't help until the
    // operator fixes the artifact or the INT_REF_RE policy. Triggers
    // exit code 1 so unattended runs surface malformed refs.
    parseErrors: 0,
    // Thought IDs whose parseParentIds threw. Capped to the first 10 so
    // the end-of-run WARN stays bounded on large runs.
    parseErrorIds: [],
    // Rows that vanished between the candidate GET and the PATCH — the
    // PATCH matched zero rows. These are NOT half-migrated: there is no
    // row left to repair, so `--force` wouldn't help. Counted separately
    // so operators can tell "the row is gone" from "the row exists but
    // metadata.provenance is missing." Does not trigger non-zero exit.
    deletedDuringBackfill: 0,
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
        // Track parse failures separately from transport errors so the
        // exit code can surface them. We still flip derivation_layer to
        // 'derived' below with backfill_reason set — the row isn't half-
        // migrated, but the provenance was NOT captured. Unattended runs
        // need a non-zero exit to notice this.
        summary.parseErrors++;
        if (summary.parseErrorIds.length < 10) {
          summary.parseErrorIds.push(row.id);
        }
      }
    }

    // Build the provenance subtree. This is what gets merged into
    // metadata.provenance server-side by merge_thought_provenance_metadata,
    // so the canonical upsert_thought RPC — which only preserves the metadata
    // blob on content_fingerprint conflicts — can round-trip these fields if
    // the row is ever re-upserted. Matches the synthesis-capture pattern used
    // elsewhere in OB1 recipes: top-level columns are the query surface,
    // metadata.provenance is the durable copy.
    const provenancePatch = {
      derivation_layer: "derived",
      derivation_method: "synthesis",
      backfilled_at: new Date().toISOString(),
      backfill_reason: reason,
    };
    if (derivedFrom) provenancePatch.derived_from = derivedFrom;

    // Top-level column PATCH is independent of the metadata merge: these are
    // separate columns on public.thoughts, not fields inside metadata, so
    // concurrent writers to metadata (eval.mjs) cannot clobber them.
    const columnPatch = {
      derivation_layer: "derived",
      derivation_method: "synthesis",
    };
    if (derivedFrom) columnPatch.derived_from = derivedFrom;

    console.log(
      `  ${args.dryRun ? "[DRY]" : "[PATCH]"} id=${row.id} source=${row.source_type} ` +
      `derived_from=${derivedFrom ? `${derivedFrom.length} ids` : "NULL"} (${reason})`,
    );

    if (!args.dryRun) {
      try {
        // PATCH top-level columns first. If this fails we have not yet
        // touched metadata, so there is nothing to roll back.
        //
        // Under `return=representation,count=exact` (set in sbPatch) the
        // response includes a row count. A zero-row result means the
        // thought was deleted between our candidate GET and this PATCH —
        // concurrent delete, not a half-migration. Skip the follow-up RPC
        // (it would raise `no_data_found` anyway) and classify the row
        // as `deletedDuringBackfill`. Re-running with `--force` cannot
        // resurrect a deleted row, so this case is NOT an exit-code-1
        // signal; it's neutral info.
        const patchResult = await sbPatch(`thoughts?id=eq.${row.id}`, columnPatch);
        if (patchResult.rowCount === 0) {
          console.log(
            `  INFO id=${row.id}: thought deleted during backfill — ` +
            `skipping metadata merge (no row to repair).`,
          );
          summary.deletedDuringBackfill++;
          continue;
        }

        // Then merge the provenance subtree into metadata via a server-side
        // RPC. The RPC performs UPDATE … SET metadata = metadata || … in a
        // single statement, so any concurrent write to metadata (e.g.,
        // eval.mjs storing eval_score) either lands before and gets preserved
        // by the `||` concat, or lands after and overwrites only its own
        // keys. There is no stale JS snapshot in the loop body.
        //
        // If this RPC fails (transient network, schema cache lag, permission
        // mismatch), the row is already flipped to derivation_layer='derived'
        // at the column level but the metadata mirror is missing. We do NOT
        // roll back the column PATCH — the top-level columns are useful on
        // their own and idempotent on re-apply. Instead we log a clear
        // warning pointing the operator at `--force`, which re-processes
        // all candidate rows regardless of current state. Both writes are
        // idempotent so re-running is safe.
        try {
          await sbRpc("merge_thought_provenance_metadata", {
            p_thought_id: row.id,
            p_provenance: provenancePatch,
          });
          summary.patched++;
          if (derivedFrom) summary.patchedWithParents++;
          else summary.patchedWithoutParents++;
        } catch (rpcErr) {
          console.warn(
            `  WARN id=${row.id}: column PATCH succeeded but metadata merge ` +
            `RPC failed: ${rpcErr.message}. Row is half-migrated ` +
            `(derivation_layer='derived' set, metadata.provenance missing). ` +
            `Re-run with --force to repair; both writes are idempotent.`,
          );
          summary.halfMigrated++;
        }
      } catch (err) {
        console.error(`  ERROR id=${row.id}: ${err.message}`);
        summary.errors++;
      }
    }
  }

  console.log("\n[backfill] summary:", summary);

  // Half-migrated rows (column PATCH succeeded, metadata merge RPC failed)
  // used to leave the process with exit code 0, so unattended automation
  // had no way to detect them. Treat them as a failure condition alongside
  // hard errors; re-run with --force to repair.
  if (summary.halfMigrated > 0) {
    console.error(
      `[backfill] WARN — ${summary.halfMigrated} row(s) half-migrated ` +
      `(column PATCH applied, metadata.provenance missing). ` +
      `Re-run with --force to repair; both writes are idempotent.`,
    );
  }
  if (summary.deletedDuringBackfill > 0) {
    console.log(
      `[backfill] INFO — ${summary.deletedDuringBackfill} row(s) were ` +
      `deleted during the backfill window. These are not half-migrated — ` +
      `there is nothing to repair — and do not trigger a non-zero exit.`,
    );
  }
  if (summary.parseErrors > 0) {
    const sample = summary.parseErrorIds.join(", ");
    const suffix = summary.parseErrors > summary.parseErrorIds.length
      ? ` (showing first ${summary.parseErrorIds.length})`
      : "";
    // In --dry-run, no writes happened, so "was flipped" misleads. Prepend a
    // dry-run qualifier so the message reads as a projection, not a fact.
    const prefix = args.dryRun ? "DRY-RUN — would have: " : "";
    console.warn(
      `[backfill] WARN — ${prefix}${summary.parseErrors} row(s) had parse errors` +
      `${suffix}: ${sample}. derivation_layer was still flipped to ` +
      `'derived' with backfill_reason set, but provenance was NOT ` +
      `captured. Fix the artifact (or INT_REF_RE policy) and re-run ` +
      `with --force.`,
    );
  }
  // Exit codes:
  //   2 — hard errors (HTTP failure, RPC failure, etc.). Operator must
  //       investigate; re-running blindly may not help.
  //   1 — half-migrated rows or parse errors. Safe to re-run with --force
  //       once the underlying artifact/policy is fixed; both write paths
  //       are idempotent.
  //   0 — clean completion, including "deleted during backfill" cases
  //       (no repair possible).
  if (summary.errors > 0) process.exit(2);
  if (summary.halfMigrated > 0 || summary.parseErrors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[backfill] FAILED:", err.message);
  process.exit(1);
});
