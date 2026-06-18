#!/usr/bin/env node
/**
 * backfill-gmail-correspondents.mjs
 *
 * Walk existing Gmail-sourced thoughts and ensure every From / To / Cc
 * correspondent has an `entities` row + `thought_entities` edge. Idempotent.
 * Useful to close graph gaps after an older import run, or to link in
 * previously unseen addresses after a contact database change.
 *
 * The script pre-filters on **author-edge presence specifically** — a
 * thought with only recipient/cc edges is still re-processed, because a
 * prior resolver retry-storm could have dropped the author link without
 * dropping the recipient links.
 *
 * Prerequisites:
 *   - Open Brain base setup
 *   - Enhanced-Thoughts-style schema (see README) — `thoughts.source_type`,
 *     `thoughts.metadata` jsonb, `entities`, `thought_entities`.
 *   - Thoughts previously imported with `source_type = 'gmail_export'`
 *     via `recipes/email-history-import/pull-gmail.ts`
 *
 * Usage:
 *   node backfill-gmail-correspondents.mjs              # live run
 *   node backfill-gmail-correspondents.mjs --dry-run    # report only
 *   node backfill-gmail-correspondents.mjs --since=2026-04-20
 *   node backfill-gmail-correspondents.mjs --limit=500  # smoke batch
 *
 * Env (from .env.local or process.env):
 *   SUPABASE_URL or SUPABASE_PROJECT_REF   required
 *   SUPABASE_SERVICE_ROLE_KEY              required
 *   SELF_EMAILS                            optional comma list of your own
 *                                          addresses
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadEnv,
  makeSbClient,
  resolveCorrespondents,
  parseRfc2822Address,
} from "./lib/entity-resolver.mjs";

const BATCH_SIZE = 500;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { dryRun: false, since: null, limit: 0, sleepMs: 0 };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--since=")) args.since = a.slice("--since=".length);
    else if (a.startsWith("--limit=")) args.limit = parseInt(a.slice("--limit=".length), 10) || 0;
    else if (a.startsWith("--sleep-ms=")) args.sleepMs = parseInt(a.slice("--sleep-ms=".length), 10) || 0;
  }
  return args;
}

async function main() {
  // Resolve .env.local relative to this script so the user can run from any cwd.
  const env = loadEnv(path.join(__dirname, ".env.local"));
  const args = parseArgs(process.argv);

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("missing env var SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!env.SUPABASE_URL && !env.SUPABASE_PROJECT_REF) {
    throw new Error("missing env var SUPABASE_URL or SUPABASE_PROJECT_REF");
  }

  const sb = makeSbClient({
    projectRef: env.SUPABASE_PROJECT_REF,
    supabaseUrl: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const selfEmails = new Set(
    (env.SELF_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  console.log(
    `[backfill-correspondents] start${args.dryRun ? " (DRY-RUN)" : ""}`
    + (args.since ? ` since=${args.since}` : "")
    + (args.limit ? ` limit=${args.limit}` : "")
    + ` self_emails=${selfEmails.size}`,
  );

  // Cursor-based pagination over thoughts.id.
  let cursor = 0;
  let totalSeen = 0;
  let totalLinked = 0;
  const agg = { authors: 0, recipients: 0, ccs: 0, skippedSelf: 0, newEntities: 0, errors: 0 };

  while (true) {
    let query = `thoughts?source_type=eq.gmail_export`
      + `&select=id,metadata`
      + `&id=gt.${cursor}`
      + `&order=id.asc`
      + `&limit=${BATCH_SIZE}`;
    if (args.since) query += `&created_at=gte.${encodeURIComponent(args.since)}`;

    const batch = await sb.get(query);
    if (!batch || batch.length === 0) break;

    // Pre-filter: skip thoughts that already have an *author* edge. Recipient
    // or cc edges alone aren't sufficient — if a prior run hit the resolver
    // retry-storm bug, the thought may have recipient edges but no author.
    // Author-specifically is the minimum we expect every gmail thought to have.
    const ids = batch.map((t) => t.id);
    const existing = await sb.get(
      `thought_entities?thought_id=in.(${ids.join(",")})`
      + `&source=eq.gmail_header`
      + `&mention_role=eq.author`
      + `&select=thought_id&limit=${ids.length * 4}`,
    );
    const alreadyLinked = new Set((existing || []).map((e) => e.thought_id));

    for (const t of batch) {
      cursor = t.id;
      totalSeen++;
      if (args.limit && totalSeen > args.limit) break;
      if (alreadyLinked.has(t.id)) continue;

      // Prefer the structured correspondents field (new packs); fall back to
      // raw From/To/Cc strings (older Gmail ingests without the structured field).
      const gm = t.metadata?.gmail;
      if (!gm) continue;

      let from, to, cc;
      if (gm.correspondents) {
        const joinBack = (arr) =>
          (arr || [])
            .map((c) => (c && c.email ? (c.name ? `"${c.name}" <${c.email}>` : c.email) : ""))
            .filter(Boolean)
            .join(", ");
        from = joinBack(gm.correspondents.author);
        to = joinBack(gm.correspondents.recipients);
        cc = joinBack(gm.correspondents.cc);
      } else {
        from = gm.from || "";
        to = gm.to || "";
        cc = gm.cc || "";
      }

      if (!from && !to && !cc) continue;

      if (args.dryRun) {
        const preview = parseRfc2822Address(from)
          .concat(parseRfc2822Address(to))
          .concat(parseRfc2822Address(cc))
          .length;
        if (preview > 0) {
          totalLinked++;
          if (totalLinked <= 5) {
            console.log(`  [DRY] #${t.id} -> ${preview} correspondents`);
          }
        }
        continue;
      }

      try {
        const stats = await resolveCorrespondents(sb, {
          thoughtId: t.id,
          from,
          to,
          cc,
          selfEmails,
        });
        totalLinked++;
        for (const k of Object.keys(agg)) agg[k] += stats[k] || 0;
      } catch (err) {
        agg.errors++;
        console.warn(`  [err] #${t.id}: ${err.message}`);
      }

      // Progress log lives inside the per-thought loop so it actually fires
      // every 2000 thoughts; previously it was outside, so at batch_size=500
      // it only fired once every 4 batches by coincidence.
      if (totalSeen % 2000 === 0) {
        console.log(
          `  progress: seen=${totalSeen} linked=${totalLinked} newEntities=${agg.newEntities} errors=${agg.errors}`,
        );
      }

      if (args.sleepMs) await new Promise((r) => setTimeout(r, args.sleepMs));
    }

    if (args.limit && totalSeen >= args.limit) break;
    if (batch.length < BATCH_SIZE) break; // drained
  }

  console.log(`\n[backfill-correspondents] done${args.dryRun ? " (DRY-RUN)" : ""}`);
  console.log(`  thoughts seen:   ${totalSeen}`);
  console.log(`  thoughts linked: ${totalLinked}`);
  if (!args.dryRun) {
    console.log(`  authors:         ${agg.authors}`);
    console.log(`  recipients:      ${agg.recipients}`);
    console.log(`  ccs:             ${agg.ccs}`);
    console.log(`  skipped (self):  ${agg.skippedSelf}`);
    console.log(`  new entities:    ${agg.newEntities}`);
    console.log(`  errors:          ${agg.errors}`);
  }
}

main().catch((err) => {
  console.error("[backfill-correspondents] FAILED:", err.message);
  console.error(err.stack);
  process.exit(1);
});
