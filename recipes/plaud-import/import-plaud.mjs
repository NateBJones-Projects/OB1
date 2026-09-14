#!/usr/bin/env node
/**
 * import-plaud.mjs — import a local Plaud export into Open Brain.
 *
 * Shape, per recording:
 *
 *   1 parent thought  — the Plaud AI summary (+ highlights / action items),
 *                       backdated to the recording time, type `meeting` when
 *                       two or more speakers were detected, else `journal`.
 *   N atom thoughts   — LLM-extracted standalone statements from the transcript
 *                       (decisions, commitments, facts, preferences, action
 *                       items, open questions).
 *
 * Parent and atoms are linked by `metadata.plaud.recording_id` and, on the
 * atoms, `metadata.atomization.parent_id` (the atomizer recipe's key names), so
 * the pair survives a brain that has no `thought_edges` table.
 *
 * Usage:
 *   node import-plaud.mjs ~/plaud-export --dry-run --report
 *   node import-plaud.mjs ~/plaud-export --dry-run --llm --limit 3
 *   node import-plaud.mjs ~/plaud-export --limit 10 --tier-map plaud-tier-map.csv
 *   node import-plaud.mjs ~/plaud-export --concurrency 4 --report
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  contentFingerprint,
  ensureDir,
  fetchWithTimeout,
  intFlag,
  isoOrNull,
  loadEnv,
  parseArgs,
  pool,
  scanForSecrets,
  sleep,
  wordCount,
} from "./lib/common.mjs";
import { applySpeakerMap, chunkTurns, discoverRecordings } from "./lib/plaud-parse.mjs";
import { loadTierMap, loadTriageRules, MODES, TIERS } from "./lib/triage.mjs";
import { atomizeTranscript, DEFAULT_MODELS, PROVIDERS, resolveProvider } from "./lib/providers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IMPORTER_NAME = "plaud-import";
const IMPORTER_VERSION = "0.1.0";
const SOURCE_TYPE = "plaud";
const SOURCE_LABEL = "Plaud voice recorder";

/**
 * The embedding model is NOT configurable, on purpose.
 *
 * Vectors from different embedding models are not comparable: they live in
 * different spaces, and cosine similarity between them is meaningless. Every
 * other OB1 import path writes `text-embedding-3-small` (1536 dims), and the
 * `thoughts.embedding` column is vector(1536). Importing with any other model
 * would silently poison retrieval for the whole corpus — the rows would be
 * searchable-looking but rank against nothing. If you ever change this, you
 * must re-embed every row in the brain, not just the Plaud ones.
 */
const EMBEDDING_MODEL_OPENAI = "text-embedding-3-small";
const EMBEDDING_MODEL_OPENROUTER = "openai/text-embedding-3-small";
const EMBEDDING_INPUT_CHAR_CAP = 8000; // ~8k-token input limit; same cap the Obsidian importer uses

const SYNC_LOG_NAME = "plaud-sync-log.json";
const MAX_CONCURRENCY = 4;

const HELP = `
import-plaud.mjs — import a Plaud export folder into Open Brain.

Usage:
  node import-plaud.mjs <export-folder> [options]

Selection:
  --limit <n>            Import at most N recordings (0 = all). Default: 0
  --since <YYYY-MM-DD>   Only recordings starting on/after this date.
  --until <YYYY-MM-DD>   Only recordings starting before this date.
  --reimport             Ignore the sync log and purge each recording's existing
                         rows before re-importing it.
  --reset-sync-log       Delete the sync log and start fresh (no DB changes).
  --purge <recording_id> Delete every thought for one recording, then exit.

Atomization:
  --llm [provider]       Run the LLM splitter. In --dry-run this prints atoms
                         without writing anything. Optional value sets provider.
  --no-llm               Deterministic ~500-word speaker-turn chunks, no LLM.
  --provider <name>      ${PROVIDERS.join(" | ")}
  --model <name>         Model override. Defaults per provider:
                         ${Object.entries(DEFAULT_MODELS).map(([k, v]) => `${k}=${v}`).join(", ")}
  --max-calls <n>        Hard ceiling on LLM calls. Default: 1000 (0 = no limit)

Triage:
  --rules <file>         Triage rules JSON. Default: triage-rules.json, falling
                         back to triage-rules.example.json.
  --tier-map <file.csv>  recording_id,tier,mode — overrides every rule.
  --client-mode <mode>   Mode for restricted recordings: ${MODES.join(" | ")}.
                         Default: summary (parent only, transcript never sent to an LLM).
  --default-tier <tier>  Tier for unclassified recordings. Default: personal.
                         'standard' is rejected — unclassified escalates.
  --speakers <file.json> Speaker label -> name map, keyed by recording id.

Writing:
  --dry-run              No writes. Produces triage-report.md and plaud-tier-map.csv.
  --no-embed             Insert without embeddings (no embedding API calls).
  --concurrency <n>      Recordings in flight. Clamped to ${MAX_CONCURRENCY}. Default: 1
  --store-recordings     Also store full transcripts in a plaud_recordings side
                         table (see schema-optional.sql). Default: off.
  --no-secret-scan       Disable the secret scanner (not recommended).
  --state-dir <dir>      Where the sync log and reports are written.
                         Default: the recipe folder.

Output:
  --report               Write import-report.md (or triage-report.md in dry run).
  --verbose              Per-recording progress.
  --help                 Show this help.

Environment (.env.local in the recipe folder wins over the shell):
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY     required for writes
  OPENAI_API_KEY or OPENROUTER_API_KEY        embeddings (${EMBEDDING_MODEL_OPENAI})
  OPENROUTER_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY   atomization
`;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

// ── Embeddings ───────────────────────────────────────────────────────────────

function resolveEmbedding(env) {
  // EMBEDDING_BASE_URL exists for local proxies and for this recipe's mock-server
  // tests. The MODEL is still fixed — see the comment on EMBEDDING_MODEL_OPENAI.
  if (env.EMBEDDING_BASE_URL) {
    return {
      url: `${String(env.EMBEDDING_BASE_URL).replace(/\/$/, "")}/embeddings`,
      key: env.OPENAI_API_KEY || env.OPENROUTER_API_KEY || "",
      model: EMBEDDING_MODEL_OPENAI,
      label: `custom base url (${env.EMBEDDING_BASE_URL})`,
    };
  }
  if (env.OPENAI_API_KEY) {
    return {
      url: "https://api.openai.com/v1/embeddings",
      key: env.OPENAI_API_KEY,
      model: EMBEDDING_MODEL_OPENAI,
      label: "OpenAI",
    };
  }
  if (env.OPENROUTER_API_KEY) {
    return {
      url: "https://openrouter.ai/api/v1/embeddings",
      key: env.OPENROUTER_API_KEY,
      model: EMBEDDING_MODEL_OPENROUTER,
      label: "OpenRouter",
    };
  }
  return null;
}

async function embed(text, config, { retries = 3 } = {}) {
  const body = { model: config.model, input: String(text).slice(0, EMBEDDING_INPUT_CHAR_CAP) };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(
        config.url,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        60_000,
      );
      if (!res.ok) {
        const status = res.status;
        const detail = (await res.text()).slice(0, 200);
        if (attempt < retries && (status === 429 || status >= 500)) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new Error(`embedding API ${status}: ${detail}`);
      }
      const data = await res.json();
      const vector = data?.data?.[0]?.embedding;
      if (!Array.isArray(vector) || vector.length === 0) {
        throw new Error("embedding API returned no vector (expected data[0].embedding)");
      }
      return vector;
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw new Error("embedding failed");
}

// ── Supabase REST ────────────────────────────────────────────────────────────

function supabaseHeaders(key, prefer) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

/**
 * Insert one thought.
 * @returns {Promise<{status:"inserted"|"duplicate", id:string|null}>}
 */
async function insertThought(payload, db, { retries = 3 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetchWithTimeout(
      `${db.url}/rest/v1/thoughts`,
      {
        method: "POST",
        headers: supabaseHeaders(db.key, "return=representation"),
        body: JSON.stringify(payload),
      },
      30_000,
    );
    if (res.ok) {
      const rows = await res.json().catch(() => []);
      return { status: "inserted", id: Array.isArray(rows) ? rows[0]?.id ?? null : rows?.id ?? null };
    }
    if (res.status === 409) {
      await res.text().catch(() => "");
      const existing = await findByFingerprint(payload.content_fingerprint, db);
      return { status: "duplicate", id: existing };
    }
    const detail = (await res.text()).slice(0, 300);
    if (attempt < retries && (res.status === 429 || res.status >= 500)) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw new Error(`insert failed ${res.status}: ${detail}`);
  }
  throw new Error("insert failed");
}

async function findByFingerprint(fingerprint, db) {
  if (!fingerprint) return null;
  const res = await fetchWithTimeout(
    `${db.url}/rest/v1/thoughts?select=id&content_fingerprint=eq.${encodeURIComponent(fingerprint)}&limit=1`,
    { headers: supabaseHeaders(db.key, "return=representation") },
    30_000,
  );
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0].id : null;
}

async function patchThought(id, patch, db) {
  const res = await fetchWithTimeout(
    `${db.url}/rest/v1/thoughts?id=eq.${encodeURIComponent(id)}`,
    { method: "PATCH", headers: supabaseHeaders(db.key, "return=minimal"), body: JSON.stringify(patch) },
    30_000,
  );
  if (!res.ok) throw new Error(`patch failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function purgeRecording(recordingId, db) {
  const filter = encodeURIComponent(JSON.stringify({ plaud: { recording_id: recordingId } }));
  const res = await fetchWithTimeout(
    `${db.url}/rest/v1/thoughts?metadata=cs.${filter}`,
    { method: "DELETE", headers: supabaseHeaders(db.key, "return=representation") },
    30_000,
  );
  if (!res.ok) throw new Error(`purge failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

async function storeRecording(record, triage, db) {
  const res = await fetchWithTimeout(
    `${db.url}/rest/v1/plaud_recordings`,
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(db.key, "return=minimal,resolution=merge-duplicates"),
      },
      body: JSON.stringify({
        id: record.recording_id,
        title: record.title,
        start_at: record.start_at,
        duration_ms: record.duration_ms,
        participants: record.speakers,
        transcript: record.transcript,
        summary: record.summary,
        sensitivity_tier: triage.tier,
        imported_at: new Date().toISOString(),
      }),
    },
    30_000,
  );
  if (!res.ok) throw new Error(`plaud_recordings insert failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ── Sync log ─────────────────────────────────────────────────────────────────

function loadSyncLog(stateDir) {
  const file = path.join(stateDir, SYNC_LOG_NAME);
  if (!fs.existsSync(file)) return { export_path: "", last_run: "", recordings: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    parsed.recordings = parsed.recordings || {};
    return parsed;
  } catch {
    return { export_path: "", last_run: "", recordings: {} };
  }
}

function saveSyncLog(stateDir, log) {
  ensureDir(stateDir);
  fs.writeFileSync(path.join(stateDir, SYNC_LOG_NAME), `${JSON.stringify(log, null, 2)}\n`);
}

// ── Thought construction ─────────────────────────────────────────────────────

function dateLabel(iso) {
  return iso ? iso.slice(0, 10) : "undated";
}

function durationLabel(ms) {
  if (!ms) return null;
  const minutes = Math.round(ms / 60000);
  return minutes > 0 ? `${minutes} min` : "<1 min";
}

function parentContent(record) {
  const bits = [
    `Plaud recording: ${record.title}`,
    dateLabel(record.start_at),
    durationLabel(record.duration_ms),
    record.speakers.length > 0 ? record.speakers.join(", ") : null,
  ].filter(Boolean);
  const body = [record.summary, record.highlights].filter(Boolean).join("\n\n");
  return `[${bits.join(" | ")}]\n\n${body}`.trim();
}

function atomContent(record, atom) {
  return `[Plaud: ${record.title} | ${dateLabel(record.start_at)}] ${atom}`.trim();
}

function baseMetadata(record, triage, extra) {
  const importedAt = new Date().toISOString();
  return {
    source: SOURCE_TYPE,
    source_type: SOURCE_TYPE,
    source_label: SOURCE_LABEL,
    source_id: record.recording_id,
    source_path: record.source_paths.transcript || record.source_paths.summary || null,
    event_at: record.start_at,
    original_created_at: record.start_at,
    imported_at: importedAt,
    importer_name: IMPORTER_NAME,
    importer_version: IMPORTER_VERSION,
    input_hash: record.input_hash,
    sensitivity_tier: triage.tier,
    people: record.speakers,
    topics: [],
    plaud: {
      recording_id: record.recording_id,
      title: record.title,
      start_at: record.start_at,
      duration_ms: record.duration_ms,
      speaker_count: record.speakers.length,
      participants: record.speakers,
      layout: record.layout,
      ...extra.plaud,
    },
    triage: {
      rule: triage.rule,
      tier_source: triage.tier_source,
      label: triage.label,
      mode: triage.mode,
    },
    ...extra.rest,
  };
}

function thoughtType(record) {
  return record.speakers.length >= 2 ? "meeting" : "journal";
}

// ── Reports ──────────────────────────────────────────────────────────────────

function writeTriageReport(stateDir, rows, context) {
  const byTier = {};
  const byRule = {};
  for (const row of rows) {
    byTier[row.triage.tier] = (byTier[row.triage.tier] || 0) + 1;
    byRule[row.triage.rule] = (byRule[row.triage.rule] || 0) + 1;
  }
  const lines = [
    "# Plaud Triage Report",
    "",
    `- **Export**: \`${context.exportDir}\``,
    `- **Generated**: ${new Date().toISOString()}`,
    `- **Rules file**: \`${context.rulesPath}\``,
    `- **Recordings**: ${rows.length}`,
    "",
    "## Tiers",
    "",
    "| Tier | Recordings |",
    "| ---- | ---------- |",
    ...TIERS.map((t) => `| ${t} | ${byTier[t] || 0} |`),
    "",
    "## Rules that fired",
    "",
    "| Rule | Recordings |",
    "| ---- | ---------- |",
    ...Object.entries(byRule)
      .sort((a, b) => b[1] - a[1])
      .map(([rule, count]) => `| \`${rule}\` | ${count} |`),
    "",
    "## Per recording",
    "",
    "| Recording | Date | Tier | Mode | Rule | Match | Words | Est. atoms |",
    "| --------- | ---- | ---- | ---- | ---- | ----- | ----- | ---------- |",
    ...rows.map(
      (r) =>
        `| ${r.record.recording_id} — ${r.record.title.replace(/\|/g, "/")} | ${dateLabel(r.record.start_at)} | ` +
        `${r.triage.tier} | ${r.triage.mode} | \`${r.triage.rule}\` | ${r.triage.label || "—"} | ` +
        `${r.words} | ${r.estimatedAtoms} |`,
    ),
    "",
    "Edit `plaud-tier-map.csv` and pass it back with `--tier-map` to override any row.",
    "",
  ];
  fs.writeFileSync(path.join(stateDir, "triage-report.md"), lines.join("\n"));
}

function writeTierMapCsv(stateDir, rows) {
  const lines = [
    "# Edit the tier / mode columns and pass this file back with --tier-map.",
    "# tier: standard | personal | restricted    mode: full | summary | skip",
    "recording_id,tier,mode,title,date",
    ...rows.map(
      (r) =>
        `${r.record.recording_id},${r.triage.tier},${r.triage.mode},` +
        `"${r.record.title.replace(/"/g, "'")}",${dateLabel(r.record.start_at)}`,
    ),
  ];
  fs.writeFileSync(path.join(stateDir, "plaud-tier-map.csv"), `${lines.join("\n")}\n`);
}

function writeImportReport(stateDir, stats, context) {
  const lines = [
    "# Plaud Import Report",
    "",
    `- **Export**: \`${context.exportDir}\``,
    `- **Run**: ${new Date().toISOString()}`,
    `- **Mode**: ${context.dryRun ? "Dry run" : "Live import"}`,
    `- **Atomization**: ${context.atomizationLabel}`,
    `- **Embeddings**: ${context.embeddingLabel}`,
    "",
    "## Totals",
    "",
    "| Metric | Count |",
    "| ------ | ----- |",
    `| Recordings processed | ${stats.processed} |`,
    `| Recordings skipped (sync log) | ${stats.skippedSyncLog} |`,
    `| Recordings skipped (mode=skip) | ${stats.skippedMode} |`,
    `| Parent thoughts inserted | ${stats.parentsInserted} |`,
    `| Parent duplicates | ${stats.parentDuplicates} |`,
    `| Atom thoughts inserted | ${stats.atomsInserted} |`,
    `| Atom duplicates | ${stats.atomDuplicates} |`,
    `| Secrets skipped | ${stats.secretsSkipped} |`,
    `| LLM calls | ${stats.llmCalls} |`,
    `| LLM failures | ${stats.llmFailures} |`,
    `| Embedding failures | ${stats.embedFailures} |`,
    `| Insert failures | ${stats.insertFailures} |`,
    "",
    "## By tier",
    "",
    "| Tier | Parents | Atoms |",
    "| ---- | ------- | ----- |",
    ...TIERS.map((t) => `| ${t} | ${stats.byTier[t]?.parents || 0} | ${stats.byTier[t]?.atoms || 0} |`),
    "",
    "## Token usage (atomization)",
    "",
    `- Input tokens: ${stats.usage.input_tokens ?? "n/a"}`,
    `- Output tokens: ${stats.usage.output_tokens ?? "n/a"}`,
    "",
  ];
  if (stats.failures.length > 0) {
    lines.push("## Failures", "");
    for (const f of stats.failures.slice(0, 50)) {
      lines.push(`- \`${f.recording_id}\`: ${f.error}`);
    }
    lines.push("");
  }
  fs.writeFileSync(path.join(stateDir, "import-report.md"), lines.join("\n"));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { flags, positional, unknown } = parseArgs(process.argv.slice(2), {
    booleans: [
      "dry-run", "no-llm", "no-embed", "no-secret-scan", "report", "verbose",
      "help", "reimport", "reset-sync-log", "store-recordings",
    ],
    values: [
      "limit", "since", "until", "provider", "model", "max-calls", "concurrency",
      "rules", "tier-map", "client-mode", "default-tier", "speakers", "purge", "state-dir",
    ],
    optionalValues: ["llm"],
  });

  if (flags.help || process.argv.length === 2) {
    console.log(HELP.trim());
    return;
  }
  if (unknown.length > 0) fail(`unknown flag(s): ${unknown.join(", ")}. Run --help.`);

  const env = loadEnv(__dirname);
  const stateDir = flags["state-dir"] ? path.resolve(String(flags["state-dir"])) : __dirname;
  const dryRun = !!flags["dry-run"];
  const verbose = !!flags.verbose;
  const db = { url: (env.SUPABASE_URL || "").replace(/\/$/, ""), key: env.SUPABASE_SERVICE_ROLE_KEY || "" };

  // ── --purge: one recording, then exit ──────────────────────────────────────
  if (flags.purge) {
    if (!db.url || !db.key) fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --purge.");
    const deleted = await purgeRecording(String(flags.purge), db);
    console.log(`Purged ${deleted} thought(s) for recording ${flags.purge}.`);
    const log = loadSyncLog(stateDir);
    delete log.recordings[String(flags.purge)];
    saveSyncLog(stateDir, log);
    return;
  }

  if (flags["reset-sync-log"]) {
    const file = path.join(stateDir, SYNC_LOG_NAME);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    console.log(`Removed ${file}. (No database rows were touched.)`);
    if (positional.length === 0) return;
  }

  if (positional.length === 0) fail("an export folder is required. Run --help.");
  const exportDir = path.resolve(String(positional[0]).replace(/^~(?=$|\/)/, env.HOME || "~"));

  // ── Options ────────────────────────────────────────────────────────────────
  const limit = intFlag(flags, "limit", 0);
  const maxCalls = intFlag(flags, "max-calls", 1000);
  const requestedConcurrency = intFlag(flags, "concurrency", 1);
  const concurrency = Math.max(1, Math.min(requestedConcurrency, MAX_CONCURRENCY));
  if (requestedConcurrency > MAX_CONCURRENCY) {
    console.warn(`Note: --concurrency clamped from ${requestedConcurrency} to ${MAX_CONCURRENCY}.`);
  }
  const since = flags.since ? isoOrNull(flags.since) : null;
  const until = flags.until ? isoOrNull(flags.until) : null;
  if (flags.since && !since) fail(`--since "${flags.since}" is not a date. Use YYYY-MM-DD.`);
  if (flags.until && !until) fail(`--until "${flags.until}" is not a date. Use YYYY-MM-DD.`);

  const clientMode = String(flags["client-mode"] || "summary");
  if (!MODES.includes(clientMode)) fail(`--client-mode must be one of ${MODES.join(", ")}.`);

  // LLM on/off. --no-llm wins over --llm; in a live run the LLM is on by default.
  const llmFlag = flags.llm;
  const noLlm = !!flags["no-llm"];
  const llmRequested = llmFlag !== undefined;
  const useLlm = noLlm ? false : dryRun ? llmRequested : true;
  const explicitProvider =
    (typeof llmFlag === "string" ? llmFlag : null) || (flags.provider ? String(flags.provider) : null);

  // ── Triage rules ───────────────────────────────────────────────────────────
  const rulesPath = flags.rules
    ? path.resolve(String(flags.rules))
    : fs.existsSync(path.join(__dirname, "triage-rules.json"))
      ? path.join(__dirname, "triage-rules.json")
      : path.join(__dirname, "triage-rules.example.json");
  let rules;
  try {
    rules = loadTriageRules(rulesPath);
  } catch (err) {
    fail(err.message);
    return;
  }
  if (flags["default-tier"]) {
    const tier = String(flags["default-tier"]);
    if (!TIERS.includes(tier)) fail(`--default-tier must be one of ${TIERS.join(", ")}.`);
    if (tier === "standard") {
      fail('--default-tier standard is refused: unclassified recordings must escalate, not downgrade.');
    }
    rules.defaultTier = tier;
  }

  let tierMap = null;
  if (flags["tier-map"]) {
    try {
      tierMap = loadTierMap(path.resolve(String(flags["tier-map"])));
    } catch (err) {
      fail(err.message);
      return;
    }
  }

  let speakerMap = null;
  if (flags.speakers) {
    try {
      speakerMap = JSON.parse(fs.readFileSync(path.resolve(String(flags.speakers)), "utf8"));
    } catch (err) {
      fail(`could not read --speakers file: ${err.message}`);
      return;
    }
  }

  // ── Providers ──────────────────────────────────────────────────────────────
  let llm = null;
  if (useLlm) {
    try {
      llm = resolveProvider(env, explicitProvider, flags.model ? String(flags.model) : null);
    } catch (err) {
      fail(`${err.message}`);
      return;
    }
  }
  const embedding = flags["no-embed"] ? null : resolveEmbedding(env);
  if (!dryRun && !flags["no-embed"] && !embedding) {
    fail(
      "No embedding key found. Set OPENAI_API_KEY or OPENROUTER_API_KEY in .env.local, " +
        "or pass --no-embed to insert without vectors.",
    );
  }

  const atomizationLabel = useLlm
    ? `${llm.provider} / ${llm.model}`
    : noLlm
      ? "deterministic ~500-word speaker-turn chunks (--no-llm)"
      : "not run (dry run without --llm)";
  const embeddingLabel = embedding
    ? `${EMBEDDING_MODEL_OPENAI} via ${embedding.label}`
    : flags["no-embed"]
      ? "disabled (--no-embed)"
      : "not configured (dry run only)";

  // ── Discover ───────────────────────────────────────────────────────────────
  console.log("Plaud import");
  console.log(`  Export:       ${exportDir}`);
  console.log(`  Mode:         ${dryRun ? "DRY RUN — no writes" : "LIVE IMPORT"}`);
  console.log(`  Rules:        ${path.relative(process.cwd(), rulesPath)}`);
  console.log(`  Atomization:  ${atomizationLabel}`);
  console.log(`  Embeddings:   ${embeddingLabel}`);
  if (tierMap) console.log(`  Tier map:     ${flags["tier-map"]} (${tierMap.size} rows)`);
  console.log();

  let discovered;
  try {
    discovered = discoverRecordings(exportDir);
  } catch (err) {
    fail(err.message);
    return;
  }
  for (const warning of discovered.warnings) console.warn(`  Warning: ${warning}`);
  let records = discovered.records.map((r) => applySpeakerMap(r, speakerMap));
  console.log(`Found ${records.length} recordings.`);

  // ── Filter ─────────────────────────────────────────────────────────────────
  const syncLog = loadSyncLog(stateDir);
  let skippedSyncLog = 0;
  let skippedDate = 0;
  records = records.filter((r) => {
    if (since && r.start_at && r.start_at < since) { skippedDate++; return false; }
    if (until && r.start_at && r.start_at >= until) { skippedDate++; return false; }
    if (!flags.reimport) {
      const previous = syncLog.recordings[r.recording_id];
      if (previous && previous.input_hash === r.input_hash) { skippedSyncLog++; return false; }
    }
    return true;
  });
  if (skippedDate) console.log(`  Skipped by date filter: ${skippedDate}`);
  if (skippedSyncLog) console.log(`  Skipped (already imported, unchanged): ${skippedSyncLog}`);
  if (limit > 0) records = records.slice(0, limit);
  console.log(`  To process: ${records.length}`);
  console.log();

  if (records.length === 0) {
    console.log("Nothing to import.");
    return;
  }

  // ── Triage ─────────────────────────────────────────────────────────────────
  const { triageRecording } = await import("./lib/triage.mjs");
  const rows = records.map((record) => {
    const triage = triageRecording(record, { rules, tierMap, restrictedMode: clientMode });
    const words = wordCount(record.transcript);
    return {
      record,
      triage,
      words,
      // ~12 atoms per 45-minute meeting in practice; scale by length, floor 1.
      estimatedAtoms: triage.mode === "full" ? Math.max(1, Math.round(words / 550)) : 0,
    };
  });

  ensureDir(stateDir);
  writeTierMapCsv(stateDir, rows);
  if (dryRun || flags.report) writeTriageReport(stateDir, rows, { exportDir, rulesPath });

  const tierCounts = {};
  for (const row of rows) tierCounts[row.triage.tier] = (tierCounts[row.triage.tier] || 0) + 1;
  console.log("Triage:");
  for (const tier of TIERS) console.log(`  ${tier.padEnd(11)} ${tierCounts[tier] || 0}`);
  console.log(`  modes: ${rows.filter((r) => r.triage.mode === "summary").length} summary-only, ` +
    `${rows.filter((r) => r.triage.mode === "skip").length} skipped`);
  console.log();

  const stats = {
    processed: 0,
    skippedSyncLog,
    skippedMode: 0,
    parentsInserted: 0,
    parentDuplicates: 0,
    atomsInserted: 0,
    atomDuplicates: 0,
    secretsSkipped: 0,
    llmCalls: 0,
    llmFailures: 0,
    embedFailures: 0,
    insertFailures: 0,
    byTier: {},
    usage: { input_tokens: 0, output_tokens: 0 },
    failures: [],
  };
  const atomErrors = [];

  const bumpTier = (tier, key, n = 1) => {
    stats.byTier[tier] = stats.byTier[tier] || { parents: 0, atoms: 0 };
    stats.byTier[tier][key] += n;
  };

  // ── Dry run ────────────────────────────────────────────────────────────────
  if (dryRun) {
    let llmCalls = 0;
    for (const row of rows) {
      if (!useLlm) break;
      if (row.triage.mode !== "full" || !row.record.transcript) continue;
      if (maxCalls > 0 && llmCalls >= maxCalls) break;
      llmCalls++;
      try {
        const result = await atomizeTranscript(row.record.transcript, llm);
        stats.usage.input_tokens += result.usage.input_tokens || 0;
        stats.usage.output_tokens += result.usage.output_tokens || 0;
        console.log(`\n${row.record.title} (${row.record.recording_id}) → ${result.atoms.length} atoms`);
        for (const [i, atom] of result.atoms.entries()) {
          console.log(`  ${String(i + 1).padStart(2)}. ${atom.slice(0, 160)}${atom.length > 160 ? "…" : ""}`);
        }
      } catch (err) {
        stats.llmFailures++;
        console.error(`  Atomization failed for ${row.record.recording_id}: ${err.message}`);
      }
    }
    stats.llmCalls = llmCalls;
    stats.processed = rows.length;

    console.log();
    console.log("=== DRY RUN COMPLETE — no writes ===");
    console.log(`  Recordings:        ${rows.length}`);
    console.log(`  Parent thoughts:   ${rows.filter((r) => r.triage.mode !== "skip").length}`);
    console.log(`  Atoms (estimated): ${rows.reduce((n, r) => n + r.estimatedAtoms, 0)}`);
    if (!useLlm) console.log("  (pass --llm to run the splitter on real transcripts without writing)");
    console.log(`  Reports:           ${path.join(stateDir, "triage-report.md")}`);
    console.log(`                     ${path.join(stateDir, "plaud-tier-map.csv")}`);
    if (flags.report) {
      writeImportReport(stateDir, stats, { exportDir, dryRun, atomizationLabel, embeddingLabel });
    }
    return;
  }

  // ── Preflight ──────────────────────────────────────────────────────────────
  if (!db.url || !db.key) {
    fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for a live import (set them in .env.local).");
  }
  console.log("Preflight...");
  const probe = await fetchWithTimeout(
    `${db.url}/rest/v1/thoughts?select=id&limit=1`,
    { headers: supabaseHeaders(db.key, "return=representation") },
    20_000,
  ).catch((err) => {
    fail(`could not reach Supabase at ${db.url}: ${err.message}`);
  });
  if (probe.status === 404) fail(`'thoughts' table not found at ${db.url}/rest/v1/thoughts.`);
  if (!probe.ok) fail(`Supabase preflight failed ${probe.status}: ${(await probe.text()).slice(0, 200)}`);
  if (embedding) {
    try {
      await embed("preflight check", embedding, { retries: 1 });
    } catch (err) {
      fail(`embedding preflight failed: ${err.message}`);
    }
  }
  console.log("  Supabase reachable; embeddings OK.");
  console.log();

  // ── Import ─────────────────────────────────────────────────────────────────
  let llmCallsUsed = 0;
  let consecutiveInsertFailures = 0;
  let aborted = false;

  const processRecording = async (row) => {
    if (aborted) return;
    const { record, triage } = row;

    if (triage.mode === "skip") {
      stats.skippedMode++;
      if (verbose) console.log(`  SKIP  ${record.recording_id} (${triage.rule})`);
      return;
    }

    try {
      if (flags.reimport) await purgeRecording(record.recording_id, db);

      // ── Parent ──────────────────────────────────────────────────────────
      const content = parentContent(record);
      if (!flags["no-secret-scan"]) {
        const secret = scanForSecrets(content);
        if (secret) {
          stats.secretsSkipped++;
          console.warn(`  SECRET in summary of ${record.recording_id} (${secret}) — recording skipped`);
          return;
        }
      }
      const fingerprint = contentFingerprint(content);
      const metadata = baseMetadata(record, triage, {
        plaud: { role: "parent", atom_count: 0 },
        rest: {
          type: thoughtType(record),
          content_fingerprint: fingerprint,
          provenance: {
            method: "direct_record",
            source_record: `plaud recording ${record.recording_id}`,
            artifact: record.source_paths.summary || record.source_paths.transcript,
            extractor_model: null,
            review_status: "unreviewed",
          },
        },
      });

      // Cheap fingerprint pre-check before spending an embedding call. Without
      // it, a re-run after a deleted sync log pays for embeddings on every row
      // only to hit a 409 on insert.
      const parentExisting = await findByFingerprint(fingerprint, db);
      if (parentExisting) {
        stats.parentDuplicates++;
      }

      let parentEmbedding = null;
      if (embedding && !parentExisting) {
        try {
          parentEmbedding = await embed(content, embedding);
        } catch (err) {
          stats.embedFailures++;
          if (verbose) console.warn(`  embed failed (parent ${record.recording_id}): ${err.message}`);
        }
      }

      const parentPayload = {
        content,
        metadata,
        content_fingerprint: fingerprint,
        created_at: record.start_at || undefined,
        source_type: SOURCE_TYPE,
        type: thoughtType(record),
        sensitivity_tier: triage.tier,
        importance: 3,
        // summary-only rows are marked enriched so a downstream enrichment pass
        // does not send this material to another LLM.
        enriched: triage.mode === "summary",
      };
      if (parentEmbedding) parentPayload.embedding = parentEmbedding;

      let parentId = parentExisting;
      if (!parentExisting) {
        const parentResult = await insertThought(parentPayload, db);
        if (parentResult.status === "inserted") {
          stats.parentsInserted++;
          bumpTier(triage.tier, "parents");
        } else {
          stats.parentDuplicates++;
        }
        parentId = parentResult.id;
      }
      consecutiveInsertFailures = 0;

      // ── Atoms ───────────────────────────────────────────────────────────
      let atoms = [];
      let extractorModel = null;
      let method = "chunked_record";
      if (triage.mode === "full" && record.transcript.trim()) {
        if (useLlm) {
          if (maxCalls > 0 && llmCallsUsed >= maxCalls) {
            throw new Error(`--max-calls ${maxCalls} reached; stopping before atomizing this recording`);
          }
          llmCallsUsed++;
          stats.llmCalls++;
          try {
            const result = await atomizeTranscript(record.transcript, llm);
            atoms = result.atoms;
            extractorModel = llm.model;
            method = "llm_extraction";
            stats.usage.input_tokens += result.usage.input_tokens || 0;
            stats.usage.output_tokens += result.usage.output_tokens || 0;
          } catch (err) {
            stats.llmFailures++;
            atomErrors.push({
              recording_id: record.recording_id,
              fingerprint,
              preview: record.title.slice(0, 60),
              error: err.message,
            });
            console.warn(`  atomization failed for ${record.recording_id}: ${err.message} — falling back to chunks`);
            atoms = chunkTurns(record.turns);
          }
        } else {
          atoms = chunkTurns(record.turns);
        }
      }

      let atomsInserted = 0;
      for (const [index, atom] of atoms.entries()) {
        const atomText = atomContent(record, atom);
        if (!flags["no-secret-scan"]) {
          const secret = scanForSecrets(atomText);
          if (secret) {
            stats.secretsSkipped++;
            console.warn(`  SECRET in atom ${index + 1} of ${record.recording_id} (${secret}) — atom skipped`);
            continue;
          }
        }
        const atomFingerprint = contentFingerprint(atomText);
        if (await findByFingerprint(atomFingerprint, db)) {
          stats.atomDuplicates++;
          continue;
        }
        const atomMetadata = baseMetadata(record, triage, {
          plaud: { role: "atom" },
          rest: {
            type: thoughtType(record),
            content_fingerprint: atomFingerprint,
            atomization: {
              parent_id: parentId,
              split_index: index,
              split_total: atoms.length,
              provider: useLlm ? llm.provider : "deterministic",
              model: extractorModel,
            },
            provenance: {
              method,
              source_record: `plaud recording ${record.recording_id}`,
              source_locator: `transcript atom ${index + 1}/${atoms.length}`,
              artifact: record.source_paths.transcript,
              extractor_model: extractorModel,
              review_status: "unreviewed",
            },
          },
        });

        let atomEmbedding = null;
        if (embedding) {
          try {
            atomEmbedding = await embed(atomText, embedding);
          } catch (err) {
            stats.embedFailures++;
            if (verbose) console.warn(`  embed failed (atom ${index + 1}): ${err.message}`);
          }
        }

        const atomPayload = {
          content: atomText,
          metadata: atomMetadata,
          content_fingerprint: atomFingerprint,
          created_at: record.start_at || undefined,
          source_type: SOURCE_TYPE,
          type: thoughtType(record),
          sensitivity_tier: triage.tier,
          importance: 3,
          enriched: false,
        };
        if (atomEmbedding) atomPayload.embedding = atomEmbedding;

        const atomResult = await insertThought(atomPayload, db);
        if (atomResult.status === "inserted") {
          stats.atomsInserted++;
          atomsInserted++;
          bumpTier(triage.tier, "atoms");
        } else {
          stats.atomDuplicates++;
        }
        consecutiveInsertFailures = 0;
      }

      // Record the real atom count on the parent.
      if (parentId && atomsInserted > 0) {
        metadata.plaud.atom_count = atomsInserted;
        try {
          await patchThought(parentId, { metadata }, db);
        } catch (err) {
          if (verbose) console.warn(`  could not update atom_count on ${parentId}: ${err.message}`);
        }
      }

      if (flags["store-recordings"]) {
        try {
          await storeRecording(record, triage, db);
        } catch (err) {
          console.warn(`  --store-recordings failed for ${record.recording_id}: ${err.message}`);
        }
      }

      syncLog.recordings[record.recording_id] = {
        input_hash: record.input_hash,
        parent_id: parentId,
        atom_count: atomsInserted,
        tier: triage.tier,
        mode: triage.mode,
        rule: triage.rule,
        imported_at: new Date().toISOString(),
      };
      stats.processed++;
      if (verbose) {
        console.log(
          `  OK    ${record.recording_id} — ${triage.tier}/${triage.mode}, ${atomsInserted} atoms (${triage.rule})`,
        );
      } else if (stats.processed % 5 === 0) {
        console.log(`  Progress: ${stats.processed}/${rows.length} recordings, ${stats.atomsInserted} atoms`);
      }
    } catch (err) {
      stats.insertFailures++;
      consecutiveInsertFailures++;
      stats.failures.push({ recording_id: record.recording_id, error: err.message });
      console.error(`  FAILED ${record.recording_id}: ${err.message}`);
      if (consecutiveInsertFailures >= 10) {
        aborted = true;
        console.error("\nAborting: 10 consecutive failures. Check Supabase connectivity and credentials.");
      }
    } finally {
      // Checkpoint after every recording so an interrupted run resumes cleanly.
      saveSyncLog(stateDir, { ...syncLog, export_path: exportDir, last_run: new Date().toISOString() });
    }
  };

  await pool(rows, concurrency, processRecording);

  saveSyncLog(stateDir, { ...syncLog, export_path: exportDir, last_run: new Date().toISOString() });
  if (atomErrors.length > 0) {
    fs.writeFileSync(path.join(stateDir, "atomization-errors.json"), `${JSON.stringify(atomErrors, null, 2)}\n`);
  }

  console.log();
  console.log("=== IMPORT COMPLETE ===");
  console.log(`  Recordings processed: ${stats.processed}`);
  console.log(`  Parents inserted:     ${stats.parentsInserted} (${stats.parentDuplicates} duplicates)`);
  console.log(`  Atoms inserted:       ${stats.atomsInserted} (${stats.atomDuplicates} duplicates)`);
  if (stats.skippedMode) console.log(`  Skipped (mode=skip):  ${stats.skippedMode}`);
  if (stats.secretsSkipped) console.log(`  Secrets skipped:      ${stats.secretsSkipped}`);
  if (stats.llmFailures) console.log(`  LLM failures:         ${stats.llmFailures}`);
  if (stats.embedFailures) console.log(`  Embed failures:       ${stats.embedFailures}`);
  if (stats.insertFailures) console.log(`  Failed recordings:    ${stats.insertFailures}`);
  console.log(`  Sync log:             ${path.join(stateDir, SYNC_LOG_NAME)}`);

  if (flags.report) {
    writeImportReport(stateDir, stats, { exportDir, dryRun, atomizationLabel, embeddingLabel });
    console.log(`  Report:               ${path.join(stateDir, "import-report.md")}`);
  }
}

// Only run when executed directly — the test suite imports this file for its
// exported parsers and must not trigger a run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
