#!/usr/bin/env node
/**
 * backfill-authorship.mjs
 *
 * Walk existing thoughts that carry speaker attribution (e.g. captured by a
 * wearable adapter that stamps `metadata.attribution` and `metadata.attributed_to`)
 * and ensure each one the owner spoke in has a `thought_entities` author edge to
 * the self entity. Idempotent — safe to re-run; existing edges are skipped.
 *
 * This is the authorship counterpart to the atomizer's
 * `backfill-gmail-correspondents.mjs`: that links email correspondents; this
 * links the SELF side of spoken/any-source thoughts.
 *
 * Prerequisites:
 *   - Open Brain base setup
 *   - The entity-extraction schema (../../schemas/entity-extraction/) providing
 *     `public.entities` and `public.thought_entities`
 *   - Thoughts whose `metadata.attribution` is 'self' or 'mixed' (and, ideally,
 *     `metadata.attributed_to` listing the speaker labels) — e.g. rows written by
 *     the wearable-capture integrations.
 *
 * Usage:
 *   node backfill-authorship.mjs --self-name "Your Name"      # live run
 *   node backfill-authorship.mjs --self-id 1234 --dry-run     # report only
 *   node backfill-authorship.mjs --self-name "You" --since=2026-06-01 --limit=500
 *
 * Env (from .env.local or process.env):
 *   SUPABASE_URL or SUPABASE_PROJECT_REF   required
 *   SUPABASE_SERVICE_ROLE_KEY              required
 *   OB_SELF_ENTITY_ID    optional — your entities.id (overrides --self-id)
 *   OB_SELF_ENTITY_NAME  optional — your display name (overrides --self-name)
 *   WEARABLE_SELF_LABELS optional — extra self speaker labels, comma-separated
 */
import {
  getSelfEntityId,
  linkThoughtToEntity,
  loadEnv,
  makeSbClient,
} from "./lib/author-edges.mjs";
import { roleFromAttribution } from "./lib/speaker-attribution.mjs";

const enc = encodeURIComponent;
const BATCH_SIZE = 500;

function parseArgs(argv) {
  const args = { dryRun: false, since: null, limit: 0, selfId: null, selfName: null, source: "authorship-edges-backfill" };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--since=")) args.since = a.slice("--since=".length);
    else if (a.startsWith("--limit=")) args.limit = parseInt(a.slice("--limit=".length), 10) || 0;
    else if (a.startsWith("--self-id=")) args.selfId = a.slice("--self-id=".length);
    else if (a === "--self-id") args.selfId = argv[argv.indexOf(a) + 1];
    else if (a.startsWith("--self-name=")) args.selfName = a.slice("--self-name=".length);
    else if (a === "--self-name") args.selfName = argv[argv.indexOf(a) + 1];
    else if (a.startsWith("--source=")) args.source = a.slice("--source=".length);
  }
  return args;
}

async function main() {
  const env = loadEnv();
  const args = parseArgs(process.argv);

  const projectRef = env.SUPABASE_PROJECT_REF;
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || (!projectRef && !supabaseUrl)) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL/SUPABASE_PROJECT_REF.");
    process.exit(1);
  }
  const sb = makeSbClient({ projectRef, supabaseUrl, serviceRoleKey });

  const selfId = env.OB_SELF_ENTITY_ID || args.selfId;
  const selfName = env.OB_SELF_ENTITY_NAME || args.selfName;
  const selfEntityId = await getSelfEntityId(sb, { id: selfId, name: selfName });
  console.log(`Self entity id: ${selfEntityId}${args.dryRun ? "  (dry run)" : ""}`);

  const totals = { scanned: 0, linked: 0, alreadyLinked: 0, skipped: 0, errors: 0 };

  // Keyset-paginate by id (unique; UUID- or bigint-safe) so concurrent inserts
  // during a long run can't shift an offset window and skip rows.
  let cursor = null;
  for (;;) {
    let q = `thoughts?metadata->>attribution=in.(self,mixed)`
      + `&select=id,metadata&order=id.asc&limit=${BATCH_SIZE}`;
    if (args.since) q += `&created_at=gte.${enc(args.since)}`;
    if (cursor !== null) q += `&id=gt.${enc(String(cursor))}`;
    const rows = await sb.get(q);
    if (!rows || rows.length === 0) break;

    // ONE batched lookup of the self edges that already exist for this page
    // (never a query per row) so new-vs-existing counts are accurate and cheap.
    const ids = rows.map((r) => r.id);
    const existing = await sb.get(
      `thought_entities?entity_id=eq.${enc(String(selfEntityId))}`
      + `&mention_role=in.(author,participant)`
      + `&thought_id=in.(${ids.map((id) => enc(String(id))).join(",")})`
      + `&select=thought_id`,
    );
    const alreadyLinked = new Set((existing || []).map((e) => String(e.thought_id)));

    for (const row of rows) {
      totals.scanned++;
      cursor = row.id;
      const md = row.metadata || {};
      // Trust the row's own attribution (it was selected for being self/mixed);
      // prefer an explicit metadata.role, else derive it from attribution. Do NOT
      // re-classify from attributed_to — a row may carry attribution but no
      // speaker list, and re-deriving 'unknown' would wrongly skip a self row.
      const role = (md.role === "author" || md.role === "participant")
        ? md.role
        : roleFromAttribution(md.attribution);
      if (!role) {
        totals.skipped++;
        continue;
      }
      if (alreadyLinked.has(String(row.id))) {
        totals.alreadyLinked++;
        continue;
      }
      if (args.dryRun) {
        totals.linked++;
        continue;
      }
      try {
        await linkThoughtToEntity(sb, {
          thoughtId: row.id,
          entityId: selfEntityId,
          mentionRole: role,
          source: args.source,
          evidence: { backfill: true, attribution: md.attribution },
        });
        totals.linked++;
      } catch (err) {
        totals.errors++;
        console.error(`  thought ${row.id}: ${err.message}`);
      }
      if (args.limit && totals.scanned >= args.limit) break;
    }

    if (args.limit && totals.scanned >= args.limit) break;
    if (rows.length < BATCH_SIZE) break;
  }

  console.log(
    `\nDone. scanned=${totals.scanned} linked=${totals.linked} `
    + `alreadyLinked=${totals.alreadyLinked} skipped=${totals.skipped} errors=${totals.errors}`,
  );
  process.exit(totals.errors === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
