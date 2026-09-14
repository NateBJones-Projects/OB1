#!/usr/bin/env node
/**
 * export-plaud.mjs — pull Plaud recordings to a local folder using the official
 * `@plaud-ai/cli`.
 *
 * Per recording it fetches three artifacts and writes one directory:
 *
 *   <out>/<recording_id>/meta.json     ← `plaud file <id>`
 *   <out>/<recording_id>/transcript.txt← `plaud transcript <id>`
 *   <out>/<recording_id>/summary.md    ← `plaud summary <id>`
 *
 * IMPORTANT — the exact stdout shape of `@plaud-ai/cli` is UNVERIFIED. It was
 * documented as "clean JSON/text to stdout" but this script was written without
 * a Plaud account to test against. Everything below therefore validates what
 * comes back and fails loudly, naming what it expected, rather than writing
 * garbage to disk that the importer would later treat as a real recording.
 * If your CLI version returns a different shape, the error message tells you
 * exactly which key was missing — open an issue or adjust LISTING_KEYS.
 *
 * Usage:
 *   node export-plaud.mjs --out ~/plaud-export --dry-run
 *   node export-plaud.mjs --out ~/plaud-export --limit 10
 *   node export-plaud.mjs --out ~/plaud-export --since 2026-01-01 --delay-ms 500
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ensureDir, intFlag, isoOrNull, parseArgs, sleep } from "./lib/common.mjs";
import { extractRecordingId } from "./lib/plaud-parse.mjs";

const HELP = `
export-plaud.mjs — export Plaud recordings to a local folder.

Usage:
  node export-plaud.mjs --out <dir> [options]

Options:
  --out <dir>          Destination folder (required).
  --limit <n>          Stop after N recordings (0 = all). Default: 0
  --since <YYYY-MM-DD> Only recordings starting on/after this date.
  --until <YYYY-MM-DD> Only recordings starting before this date.
  --delay-ms <n>       Pause between CLI calls. Default: 400
  --retries <n>        Retries per call, exponential backoff. Default: 3
  --page-size <n>      Listing page size passed to \`plaud files\`. Default: 100
  --max-pages <n>      Safety stop for the listing loop. Default: 50
  --plaud-bin <path>   Path to the plaud CLI. Default: plaud (or $PLAUD_BIN)
  --force              Re-download recordings already complete on disk.
  --dry-run            Enumerate ids only. No per-recording calls, no writes.
  --verbose            Print every CLI invocation.
  --help               Show this help.

Prerequisites:
  npm i -g @plaud-ai/cli && plaud login

Notes:
  - Resumable: a recording whose directory already has all three files is
    skipped unless --force is passed.
  - The export folder holds raw personal audio transcripts. Keep it outside any
    git repository.
`;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

// ── CLI invocation ───────────────────────────────────────────────────────────

function runPlaud(bin, args, { timeoutMs = 120_000, verbose = false } = {}) {
  if (verbose) console.log(`    $ ${bin} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    // shell:false — arguments are passed directly, so a recording id can never
    // be interpreted as shell syntax.
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      reject(new Error(`\`${bin} ${args[0]}\` timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        const notFound = new Error(
          `Could not run "${bin}". Install the official CLI with ` +
            `\`npm i -g @plaud-ai/cli\` and authenticate with \`plaud login\`, ` +
            `or pass --plaud-bin <path>.`,
        );
        notFound.noRetry = true; // retrying a missing binary just wastes time
        reject(notFound);
      } else {
        reject(new Error(`Failed to spawn "${bin}": ${err.message}`));
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0) {
        const err = new Error(
          `\`${bin} ${args.join(" ")}\` exited with code ${code}` +
            (stderr.trim() ? `: ${stderr.trim().slice(0, 300)}` : ""),
        );
        err.exitCode = code;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function runPlaudWithBackoff(bin, args, opts) {
  const retries = opts.retries ?? 3;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await runPlaud(bin, args, opts);
    } catch (err) {
      lastErr = err;
      if (err.noRetry) break;
      // Exit codes 0-4 are documented; a non-zero exit may be a rate limit,
      // which the docs do not describe. Back off on everything retryable.
      if (attempt === retries) break;
      const wait = (opts.delayMs || 400) * 2 ** (attempt + 1);
      console.warn(`    retry ${attempt + 1}/${retries} in ${wait}ms — ${err.message}`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// ── Defensive parsing of `plaud files` ───────────────────────────────────────

const LISTING_KEYS = ["files", "data", "items", "records", "results", "list", "recordings"];

/**
 * Turn the stdout of `plaud files` into an array of entries.
 * Throws a message naming what was expected when it cannot.
 */
export function parseListing(stdout) {
  const text = String(stdout || "").trim();
  if (!text) {
    throw new Error(
      "`plaud files` printed nothing on stdout. Expected a JSON array of recordings, " +
        "or a JSON object with one of these array keys: " + LISTING_KEYS.join(", "),
    );
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Fall back to NDJSON (one JSON object per line).
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const objects = [];
    for (const line of lines) {
      try {
        objects.push(JSON.parse(line));
      } catch {
        // not NDJSON either
      }
    }
    if (objects.length > 0) return objects;
    throw new Error(
      "`plaud files` output is neither JSON nor NDJSON. Expected a JSON array of " +
        "recordings, or one JSON object per line. First 200 chars: " +
        JSON.stringify(text.slice(0, 200)),
    );
  }

  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    for (const key of LISTING_KEYS) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }
    // One level deeper: { data: { files: [...] } }
    for (const value of Object.values(parsed)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const key of LISTING_KEYS) {
          if (Array.isArray(value[key])) return value[key];
        }
      }
    }
    throw new Error(
      "`plaud files` returned a JSON object with no recognizable list of recordings. " +
        `Expected one of the array keys [${LISTING_KEYS.join(", ")}]; got keys ` +
        `[${Object.keys(parsed).join(", ")}]. Adjust LISTING_KEYS in export-plaud.mjs ` +
        "if your CLI version uses a different key.",
    );
  }
  throw new Error(`\`plaud files\` returned ${typeof parsed}; expected an array or object.`);
}

/** Extract {id, start_at} pairs, failing loudly when no ids can be found. */
export function entriesToRecords(entries) {
  const records = [];
  const sampleKeys = new Set();
  for (const entry of entries) {
    const id = extractRecordingId(entry);
    if (!id) {
      if (entry && typeof entry === "object") Object.keys(entry).forEach((k) => sampleKeys.add(k));
      continue;
    }
    const start =
      isoOrNull(entry?.start_at ?? entry?.start_time ?? entry?.startAt ?? entry?.created_at ?? entry?.createdAt) ||
      null;
    records.push({ id, start_at: start, title: entry?.name || entry?.title || null });
  }
  if (records.length === 0 && entries.length > 0) {
    throw new Error(
      `\`plaud files\` returned ${entries.length} entries but none carried a recording id. ` +
        "Expected each entry to have one of: id, file_id, fileId, recording_id, _id, uuid. " +
        `Observed keys: [${[...sampleKeys].join(", ") || "none (entries were not objects)"}].`,
    );
  }
  return records;
}

function validateMetaJson(stdout, id) {
  const text = String(stdout || "").trim();
  if (!text) throw new Error(`\`plaud file ${id}\` printed nothing; expected a JSON object of metadata.`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `\`plaud file ${id}\` did not return JSON (${err.message}). Expected an object with at ` +
        "least an id and a name/title.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`\`plaud file ${id}\` returned ${Array.isArray(parsed) ? "an array" : typeof parsed}; expected an object.`);
  }
  // Unwrap a { data: {...} } envelope if present.
  const meta = parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data : parsed;
  if (!extractRecordingId(meta)) {
    throw new Error(
      `\`plaud file ${id}\` returned an object with no id field. Expected one of: ` +
        `id, file_id, fileId, recording_id, _id, uuid. Got keys [${Object.keys(meta).join(", ")}].`,
    );
  }
  return meta;
}

function validateText(stdout, id, what, minChars) {
  const text = String(stdout || "").trim();
  if (text.length < minChars) {
    throw new Error(
      `\`plaud ${what} ${id}\` returned ${text.length} characters; expected at least ${minChars}. ` +
        "Refusing to write an empty artifact — check the recording has a " +
        `${what} in the Plaud app.`,
    );
  }
  if (/^\s*\{/.test(text) && what === "transcript") {
    // Some builds may emit JSON; keep it, the importer's parser handles the
    // unofficial-CLI JSON shape too — but say so rather than pretending it is text.
    console.warn(`    note: transcript for ${id} looks like JSON, saving as-is`);
  }
  return text;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { flags, unknown } = parseArgs(process.argv.slice(2), {
    booleans: ["dry-run", "verbose", "force", "help"],
    values: ["out", "limit", "since", "until", "delay-ms", "retries", "page-size", "max-pages", "plaud-bin"],
  });

  if (flags.help || process.argv.length === 2) {
    console.log(HELP.trim());
    return;
  }
  if (unknown.length > 0) fail(`unknown flag(s): ${unknown.join(", ")}. Run --help.`);
  if (!flags.out) fail("--out <dir> is required. Run --help.");

  const outDir = path.resolve(String(flags.out).replace(/^~(?=$|\/)/, process.env.HOME || "~"));
  const bin = String(flags["plaud-bin"] || process.env.PLAUD_BIN || "plaud");
  const limit = intFlag(flags, "limit", 0);
  const delayMs = intFlag(flags, "delay-ms", 400);
  const retries = intFlag(flags, "retries", 3);
  const pageSize = intFlag(flags, "page-size", 100);
  const maxPages = intFlag(flags, "max-pages", 50);
  const dryRun = !!flags["dry-run"];
  const verbose = !!flags.verbose;
  const since = flags.since ? isoOrNull(flags.since) : null;
  const until = flags.until ? isoOrNull(flags.until) : null;
  if (flags.since && !since) fail(`--since "${flags.since}" is not a date. Use YYYY-MM-DD.`);
  if (flags.until && !until) fail(`--until "${flags.until}" is not a date. Use YYYY-MM-DD.`);

  console.log(`Plaud export`);
  console.log(`  CLI:      ${bin}`);
  console.log(`  Out:      ${outDir}`);
  console.log(`  Mode:     ${dryRun ? "DRY RUN (enumerate only, no writes)" : "LIVE"}`);
  console.log(`  Pacing:   ${delayMs}ms between calls, ${retries} retries with backoff`);
  console.log();

  // ── Enumerate ──────────────────────────────────────────────────────────────
  console.log("Enumerating recordings...");
  const all = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const { stdout } = await runPlaudWithBackoff(
      bin,
      ["files", "--page", String(page), "--page-size", String(pageSize)],
      { retries, delayMs, verbose },
    );
    let entries;
    try {
      entries = parseListing(stdout);
    } catch (err) {
      fail(err.message);
      return;
    }
    if (entries.length === 0) break;
    let records;
    try {
      records = entriesToRecords(entries);
    } catch (err) {
      fail(err.message);
      return;
    }
    let added = 0;
    for (const record of records) {
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      all.push(record);
      added++;
    }
    console.log(`  page ${page}: ${records.length} entries (${added} new)`);
    if (added === 0 || entries.length < pageSize) break;
    await sleep(delayMs);
  }
  console.log(`  Total: ${all.length} recordings`);

  const undated = all.filter((r) => !r.start_at).length;
  let selected = all;
  if (since || until) {
    selected = all.filter((r) => {
      if (!r.start_at) return true; // cannot filter what has no date — keep it
      if (since && r.start_at < since) return false;
      if (until && r.start_at >= until) return false;
      return true;
    });
    console.log(`  After date filter: ${selected.length}`);
    if (undated > 0) {
      console.warn(
        `  Warning: ${undated} listing entries had no start date and were kept regardless of --since/--until.`,
      );
    }
  }
  if (limit > 0) selected = selected.slice(0, limit);

  // ── Resume check ───────────────────────────────────────────────────────────
  const isComplete = (id) =>
    ["meta.json", "transcript.txt", "summary.md"].every((f) => fs.existsSync(path.join(outDir, id, f)));

  const todo = flags.force ? selected : selected.filter((r) => !isComplete(r.id));
  const skipped = selected.length - todo.length;
  if (skipped > 0) console.log(`  Already on disk: ${skipped} (use --force to re-download)`);

  if (dryRun) {
    console.log();
    console.log("=== DRY RUN COMPLETE ===");
    console.log(`Would fetch ${todo.length} recordings (${todo.length * 3} CLI calls) into ${outDir}`);
    for (const record of todo.slice(0, 10)) {
      console.log(`  ${record.id}  ${record.start_at || "(no date)"}  ${record.title || ""}`);
    }
    if (todo.length > 10) console.log(`  ... and ${todo.length - 10} more`);
    return;
  }

  ensureDir(outDir);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  console.log();
  console.log(`Fetching ${todo.length} recordings...`);
  let done = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  const failures = [];

  for (const record of todo) {
    const dir = path.join(outDir, record.id);
    try {
      // Fetch everything first; only then create the directory and write. A
      // half-written recording directory would look complete to the resume
      // check and to the importer.
      const metaOut = await runPlaudWithBackoff(bin, ["file", record.id], { retries, delayMs, verbose });
      const meta = validateMetaJson(metaOut.stdout, record.id);
      await sleep(delayMs);

      const transcriptOut = await runPlaudWithBackoff(bin, ["transcript", record.id], { retries, delayMs, verbose });
      const transcript = validateText(transcriptOut.stdout, record.id, "transcript", 20);
      await sleep(delayMs);

      const summaryOut = await runPlaudWithBackoff(bin, ["summary", record.id], { retries, delayMs, verbose });
      const summary = validateText(summaryOut.stdout, record.id, "summary", 10);

      ensureDir(dir);
      fs.writeFileSync(path.join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
      fs.writeFileSync(path.join(dir, "transcript.txt"), `${transcript}\n`);
      fs.writeFileSync(path.join(dir, "summary.md"), `${summary}\n`);

      done++;
      consecutiveFailures = 0;
    } catch (err) {
      failed++;
      consecutiveFailures++;
      failures.push({ recording_id: record.id, error: err.message });
      console.error(`  FAILED ${record.id}: ${err.message}`);
      if (consecutiveFailures >= 5) {
        console.error("\nAborting: 5 consecutive failures. Check `plaud login` and try again.");
        break;
      }
    }
    if ((done + failed) % 10 === 0) {
      console.log(`  Progress: ${done + failed}/${todo.length} (ok ${done}, failed ${failed})`);
    }
    await sleep(delayMs);
  }

  const manifestPath = path.join(outDir, "export-manifest.json");
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        exporter: "export-plaud.mjs",
        cli: bin,
        total_listed: all.length,
        fetched: done,
        failed,
        failures,
      },
      null,
      2,
    )}\n`,
  );

  console.log();
  console.log("=== EXPORT COMPLETE ===");
  console.log(`  Recordings written: ${done}`);
  if (failed) console.log(`  Failures:           ${failed} (see export-manifest.json)`);
  console.log(`  Folder:             ${outDir}`);
  console.log();
  console.log("GATE before importing: open 2-3 transcript.txt files and confirm speaker labels");
  console.log("are present. If they are not, see README 'Unverified Plaud behaviour'.");
}

// Only run when executed directly — the test suite imports this file for its
// exported parsers and must not trigger a run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
