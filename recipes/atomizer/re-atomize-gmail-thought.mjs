#!/usr/bin/env node
/**
 * re-atomize-gmail-thought.mjs
 *
 * Heals Gmail-sourced thoughts (`source_type = 'gmail_export'`) that were
 * stored as single whole-body rows but should have been split into multiple
 * atoms. For each target:
 *
 *   1. Parse out the `[Email from X | ...]` prefix + body.
 *   2. Atomize the body via the detected LLM provider.
 *   3. If the atomizer returns ≥ 2 atoms, insert each as its own thought via
 *      the `upsert_thought` RPC, tagged with `atom_index` / `atom_count`.
 *   4. Re-point any `replies_to` edges from the old thought id to `atom_0`.
 *   5. Delete the old whole-body thought. `thought_entities` edges to the
 *      old thought cascade away; new edges are re-created by the
 *      correspondents resolver.
 *
 * Prerequisites:
 *   - Open Brain base setup
 *   - Enhanced-Thoughts-style schema (see README) — `thoughts.source_type`,
 *     `thoughts.metadata` jsonb, `entities`, `thought_entities`,
 *     `thought_edges`.
 *   - `upsert_thought(p_content, p_payload)` Postgres function (see README).
 *   - Thoughts previously imported with
 *     `recipes/email-history-import/pull-gmail.ts` using the
 *     `[Email from X to Y | Subject: ... | date]` content prefix.
 *
 * Usage:
 *   # Show what would happen without writing:
 *   node re-atomize-gmail-thought.mjs --id=<thought_id> --dry-run
 *   # Actually do it:
 *   node re-atomize-gmail-thought.mjs --id=<thought_id>
 *   # Bulk mode (all whole-body gmail_export rows >=150 words):
 *   node re-atomize-gmail-thought.mjs --all
 *   node re-atomize-gmail-thought.mjs --all --limit=5
 *   # Override body length cut-off:
 *   node re-atomize-gmail-thought.mjs --all --min-words=300
 *
 * Env (loaded from .env.local or process.env):
 *   SUPABASE_URL or SUPABASE_PROJECT_REF   required — one of the two
 *   SUPABASE_SERVICE_ROLE_KEY              required
 *   OPENROUTER_API_KEY                     required when --provider openrouter
 *   ANTHROPIC_API_KEY                      required when --provider anthropic
 *   SELF_EMAILS                            optional — comma list of your own
 *                                          addresses to skip on the edge pass
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomizeText } from "./lib/atomize-text.mjs";
import {
  loadEnv,
  makeSbClient,
  resolveCorrespondents,
} from "./lib/entity-resolver.mjs";

// ── env ──────────────────────────────────────────────────────────────────────
// Resolve .env.local relative to this script so running the file from any cwd
// still picks up credentials. Without this, `node recipes/atomizer/re-atomize-...`
// from repo root silently reads only process.env.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = loadEnv(path.join(__dirname, ".env.local"));
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("missing env var SUPABASE_SERVICE_ROLE_KEY");
}
if (!env.SUPABASE_URL && !env.SUPABASE_PROJECT_REF) {
  throw new Error("missing env var SUPABASE_URL or SUPABASE_PROJECT_REF");
}

// ── args ─────────────────────────────────────────────────────────────────────
const args = {
  id: null,
  all: false,
  dryRun: false,
  limit: 0,
  minWords: 150,
  provider: null,
};
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--id=")) args.id = parseInt(a.slice("--id=".length), 10);
  else if (a === "--all") args.all = true;
  else if (a === "--dry-run") args.dryRun = true;
  else if (a.startsWith("--limit=")) args.limit = parseInt(a.slice("--limit=".length), 10) || 0;
  else if (a.startsWith("--min-words=")) args.minWords = parseInt(a.slice("--min-words=".length), 10) || 150;
  else if (a.startsWith("--provider=")) args.provider = a.slice("--provider=".length);
}
if (!args.id && !args.all) {
  console.error("must pass --id=<n> or --all");
  process.exit(1);
}

// ── PostgREST client ─────────────────────────────────────────────────────────
const sb = makeSbClient({
  projectRef: env.SUPABASE_PROJECT_REF,
  supabaseUrl: env.SUPABASE_URL,
  serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
});
const BASE = env.SUPABASE_URL
  ? `${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1`
  : `https://${env.SUPABASE_PROJECT_REF}.supabase.co/rest/v1`;
const H = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function callRpc(fn, body) {
  const res = await fetch(`${BASE}/rpc/${fn}`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`rpc ${fn}: ${res.status} ${t.slice(0, 300)}`);
  }
  return res.json();
}

// ── content parsing ──────────────────────────────────────────────────────────
// Content format written by recipes/email-history-import/pull-gmail.ts:
//   [Email from <FROM> to <TO> | Subject: <SUBJ> | <ISO_DATE>] <body>
// For atomized rows the prefix also includes " | atom N of M" before the ].
function parsePrefixAndBody(content) {
  const m = /^(\[Email[^\]]*\])\s*([\s\S]*)$/.exec(content);
  if (!m) return { prefix: "", body: content };
  return { prefix: m[1], body: m[2] };
}

function prefixWithAtomTag(prefix, atomIndex, atomCount) {
  const atomTag = ` | atom ${atomIndex + 1} of ${atomCount}`;
  return prefix.replace(/\]$/, `${atomTag}]`);
}

function wordCount(s) {
  return (s || "").split(/\s+/).filter(Boolean).length;
}

// ── atomize opts ─────────────────────────────────────────────────────────────
function buildAtomizeOpts() {
  const opts = { timeoutMs: 180_000, minAtoms: 1 };
  if (args.provider) opts.provider = args.provider;
  // Pre-load the HTTP provider's API key. atomize-text.mjs defaults to
  // 'openrouter' when the caller doesn't set provider, so we need to load
  // OPENROUTER_API_KEY for both --provider=openrouter AND the default path
  // (otherwise `node re-atomize-gmail-thought.mjs --id=123` with no provider
  // flag fails inside atomize-text.mjs with "requires opts.openrouterApiKey").
  const effective = args.provider || "openrouter";
  if (effective === "anthropic") {
    opts.anthropicApiKey = env.ANTHROPIC_API_KEY;
    if (!opts.anthropicApiKey) throw new Error("--provider anthropic requires ANTHROPIC_API_KEY in .env.local or process env");
  } else if (effective === "openrouter") {
    opts.openrouterApiKey = env.OPENROUTER_API_KEY;
    if (!opts.openrouterApiKey) throw new Error("--provider openrouter (default) requires OPENROUTER_API_KEY in .env.local or process env");
  }
  return opts;
}
const atomizeOpts = buildAtomizeOpts();

// ── target loading ───────────────────────────────────────────────────────────
const DEFAULT_CAP = 1000;
async function loadTargets() {
  if (args.id) {
    return await sb.get(`thoughts?id=eq.${args.id}&select=*`);
  }
  // --all: whole-body gmail thoughts where word_count >= minWords
  const effectiveCap = args.limit > 0 ? args.limit : DEFAULT_CAP;
  const rows = await sb.get(
    `thoughts?source_type=eq.gmail_export`
    + `&metadata->gmail->>atom_count=is.null`
    + `&select=*`
    + `&order=id.asc`
    + `&limit=${effectiveCap}`,
  );
  const filtered = rows.filter((r) => {
    const wc = r.metadata?.gmail?.word_count || wordCount(r.content);
    return wc >= args.minWords;
  });
  if (!args.limit && rows.length >= DEFAULT_CAP) {
    console.warn(
      `[re-atomize] WARNING: hit default ${DEFAULT_CAP}-row cap. ` +
      `More whole-body gmail thoughts likely exist. ` +
      `Re-run after this batch completes, or pass --limit=N for a larger page.`,
    );
  }
  return filtered;
}

// ── per-target re-atomize ────────────────────────────────────────────────────
async function processOne(old) {
  const log = (msg) => console.log(`  [#${old.id}] ${msg}`);

  const { prefix, body } = parsePrefixAndBody(old.content);
  if (!prefix) {
    log("no [Email ...] prefix detected — skipping (can't safely split)");
    return { status: "skip_no_prefix" };
  }
  const bodyWc = wordCount(body);
  if (bodyWc < args.minWords) {
    log(`body only ${bodyWc} words — skipping (< ${args.minWords})`);
    return { status: "skip_short" };
  }

  log(`atomizing ${bodyWc}-word body...`);
  let atoms;
  try {
    atoms = await atomizeText(body, atomizeOpts);
  } catch (err) {
    log(`atomize failed: ${err.message.slice(0, 200)}`);
    return { status: "skip_atomize_failed", error: err.message };
  }
  if (atoms.length < 2) {
    log(`atomize returned only 1 atom — skipping (content is already atomic)`);
    return { status: "skip_single_atom" };
  }
  log(`→ ${atoms.length} atoms`);

  if (args.dryRun) {
    for (let i = 0; i < Math.min(atoms.length, 4); i++) {
      log(`    DRY atom ${i + 1}/${atoms.length}: ${atoms[i].slice(0, 140)}${atoms[i].length > 140 ? "..." : ""}`);
    }
    if (atoms.length > 4) log(`    ...+${atoms.length - 4} more`);
    return { status: "dry_ok", atomCount: atoms.length };
  }

  // Create atoms via upsert_thought RPC
  const oldGmail = old.metadata?.gmail || {};
  const newIds = [];
  for (let i = 0; i < atoms.length; i++) {
    const atomText = atoms[i];
    const newContent = `${prefixWithAtomTag(prefix, i, atoms.length)} ${atomText}`;
    const newMeta = {
      ...(old.metadata || {}),
      gmail: {
        ...oldGmail,
        atom_index: i,
        atom_count: atoms.length,
        atom_word_count: wordCount(atomText),
      },
      run_id: `re-atomize-${new Date().toISOString().slice(0, 10)}`,
      re_atomized_from: old.id,
      re_atomized_at: new Date().toISOString(),
    };
    const resp = await callRpc("upsert_thought", {
      p_content: newContent,
      p_payload: {
        type: old.type,
        sensitivity_tier: old.sensitivity_tier,
        importance: old.importance,
        quality_score: old.quality_score,
        source_type: old.source_type,
        metadata: newMeta,
        created_at: old.created_at,
      },
    });
    const newId = resp?.thought_id || (Array.isArray(resp) ? resp[0]?.thought_id : null);
    if (!newId) throw new Error(`upsert_thought returned no id: ${JSON.stringify(resp).slice(0, 200)}`);
    newIds.push(newId);
  }
  log(`  created atoms ${newIds.join(",")}`);

  // Resolve correspondents for each new atom
  const corrs = oldGmail.correspondents;
  if (corrs) {
    const joinBack = (arr) =>
      (arr || [])
        .map((c) => (c?.email ? (c.name ? `"${c.name}" <${c.email}>` : c.email) : ""))
        .filter(Boolean)
        .join(", ");
    const selfEmails = new Set(
      (env.SELF_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    );
    for (const newId of newIds) {
      try {
        await resolveCorrespondents(sb, {
          thoughtId: newId,
          from: joinBack(corrs.author),
          to: joinBack(corrs.recipients),
          cc: joinBack(corrs.cc),
          selfEmails,
        });
      } catch (err) {
        log(`  resolver failed for #${newId}: ${err.message.slice(0, 200)}`);
      }
    }
  }

  // Redirect replies_to edges (old → atom_0)
  const atom0 = newIds[0];
  try {
    await sb.patch(`thought_edges?relation=eq.replies_to&from_thought_id=eq.${old.id}`, { from_thought_id: atom0 });
    await sb.patch(`thought_edges?relation=eq.replies_to&to_thought_id=eq.${old.id}`, { to_thought_id: atom0 });
  } catch (err) {
    log(`  edge redirect error (likely no edges to redirect): ${err.message.slice(0, 160)}`);
  }

  // Delete old thought
  try {
    await sb.delete(`thoughts?id=eq.${old.id}`);
    log(`  deleted old whole-body #${old.id}`);
  } catch (err) {
    log(`  DELETE failed: ${err.message}`);
    return { status: "partial_delete_failed", atomCount: atoms.length, newIds };
  }
  return { status: "ok", atomCount: atoms.length, newIds };
}

// ── main ─────────────────────────────────────────────────────────────────────
// NOTE on partial failures: this script performs multi-step work per thought
// (insert N atoms → link correspondents → redirect replies_to edges → delete
// original). Those steps are NOT wrapped in a Postgres transaction — a crash
// mid-run can leave half-migrated state. Recovery:
//   - New atoms carry `metadata.re_atomized_from = <old_id>`. Query those to
//     find half-migrated sources.
//   - If atoms exist but the original was not deleted, pass --id=<old_id>
//     again; idempotent upserts skip duplicate atoms, and the final delete
//     runs cleanly.
//   - If atoms exist and edges weren't redirected, either re-run --id=<old_id>
//     or hand-fix with a SQL patch pointing replies_to edges to atom_0.
async function main() {
  const targets = await loadTargets();
  console.log(`[re-atomize] ${args.dryRun ? "DRY-RUN " : ""}targets: ${targets.length}`);
  const stats = { ok: 0, dry_ok: 0, skipped: 0, failed: 0 };
  for (const t of targets) {
    try {
      const r = await processOne(t);
      if (r.status === "ok") stats.ok++;
      else if (r.status === "dry_ok") stats.dry_ok++;
      else if (r.status.startsWith("skip")) stats.skipped++;
      else stats.failed++;
    } catch (err) {
      console.log(`  [#${t.id}] FATAL: ${err.message}`);
      stats.failed++;
    }
  }
  console.log(`\n[re-atomize] done. ok=${stats.ok} dry=${stats.dry_ok} skipped=${stats.skipped} failed=${stats.failed}`);
}

main().catch((err) => {
  console.error(`[re-atomize] FATAL: ${err.message}`);
  process.exit(1);
});
