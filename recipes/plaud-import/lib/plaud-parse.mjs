/**
 * plaud-parse.mjs — readers for a local Plaud export folder.
 *
 * Plaud has no public REST API, and the several community/official export paths
 * write different shapes on disk. This module normalizes all of them into one
 * record so `import-plaud.mjs` never has to care which tool produced the files.
 *
 * Supported layouts (auto-detected, in this order):
 *
 *   A. Per-recording directory — what `export-plaud.mjs` writes:
 *        <root>/<recording_id>/meta.json
 *        <root>/<recording_id>/transcript.txt   (or .srt)
 *        <root>/<recording_id>/summary.md
 *
 *   B. Flat files grouped by basename — the unofficial `plaud files export
 *      --formats txt,json,md` layout:
 *        <root>/<id>.json  <root>/<id>.txt  <root>/<id>.md
 *
 *   C. Obsidian-plugin markdown — one .md per recording with frontmatter
 *      (`source: plaud`, `file_id: …`) and `## Summary` / `## Highlights` /
 *      `## Transcript` sections.
 *
 * Normalized record:
 *   { recording_id, title, start_at, duration_ms, summary, highlights,
 *     transcript, turns[], speakers[], source_paths{}, input_hash, layout, raw_meta }
 */

import fs from "node:fs";
import path from "node:path";
import { isoOrNull, sha256Hex } from "./common.mjs";

// ── Small utilities ──────────────────────────────────────────────────────────

function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function firstDefined(obj, keys) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return undefined;
}

const ID_KEYS = ["id", "file_id", "fileId", "recording_id", "recordingId", "_id", "uuid"];
const TITLE_KEYS = ["title", "name", "file_name", "fileName", "filename"];
const START_KEYS = [
  "start_at", "startAt", "start_time", "startTime",
  "created_at", "createdAt", "create_time", "recorded_at", "date",
];
const DURATION_KEYS = ["duration_ms", "durationMs", "duration", "length", "audio_duration"];

/** Pull an id out of an arbitrary listing entry. Returns null when absent. */
export function extractRecordingId(entry) {
  if (typeof entry === "string") return entry.trim() || null;
  const id = firstDefined(entry, ID_KEYS);
  return id === undefined ? null : String(id);
}

function normalizeDurationMs(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Heuristic: Plaud-adjacent tools report ms; anything under 10000 is almost
  // certainly seconds (a 10,000 ms recording is 10 s, a 10,000 s one is 2.8 h).
  return n < 10_000 ? Math.round(n * 1000) : Math.round(n);
}

// ── Transcript parsing ───────────────────────────────────────────────────────

const TS_SPEAKER_RE = /^\[?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\]?\s*[-–]?\s*([^:\n]{1,60}?)\s*:\s*(.*)$/;
const SPEAKER_RE = /^([^:\n]{1,60}?)\s*:\s*(.*)$/;
const TS_ONLY_RE = /^\[?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\]?\s*(.*)$/;

/**
 * Parse a plain-text transcript into speaker turns.
 * Tolerates "[00:12:40] Speaker 1: text", "00:12 Speaker 1: text",
 * "Speaker 1: text", and unlabelled prose (one turn, speaker null).
 */
export function parseTranscriptText(text) {
  const turns = [];
  if (!text) return turns;
  for (const rawLine of String(text).split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    let match = line.match(TS_SPEAKER_RE);
    if (match) {
      turns.push({ time: match[1], speaker: match[2].trim(), text: match[3].trim() });
      continue;
    }
    match = line.match(SPEAKER_RE);
    // Guard against sentences with colons ("Decision: we ship Friday") being
    // read as speaker labels: a real label is short and has no sentence-ending
    // punctuation.
    if (match && match[1].split(/\s+/).length <= 4 && !/[.!?]$/.test(match[1])) {
      turns.push({ time: null, speaker: match[1].trim(), text: match[2].trim() });
      continue;
    }
    match = line.match(TS_ONLY_RE);
    if (match && match[2]) {
      turns.push({ time: match[1], speaker: null, text: match[2].trim() });
      continue;
    }
    // Continuation of the previous turn, or unlabelled prose.
    if (turns.length > 0 && !turns[turns.length - 1].speaker) {
      turns[turns.length - 1].text += ` ${line}`;
    } else if (turns.length > 0) {
      turns[turns.length - 1].text += ` ${line}`;
    } else {
      turns.push({ time: null, speaker: null, text: line });
    }
  }
  return turns;
}

/** Parse an .srt transcript (index / timecode / text blocks). */
export function parseSrt(text) {
  const turns = [];
  const blocks = String(text).replace(/\r/g, "").split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    let i = 0;
    if (/^\d+$/.test(lines[i])) i++;
    let time = null;
    if (i < lines.length && lines[i].includes("-->")) {
      time = lines[i].split("-->")[0].trim();
      i++;
    }
    const body = lines.slice(i).join(" ").trim();
    if (!body) continue;
    const match = body.match(SPEAKER_RE);
    if (match && match[1].split(/\s+/).length <= 4 && !/[.!?]$/.test(match[1])) {
      turns.push({ time, speaker: match[1].trim(), text: match[2].trim() });
    } else {
      turns.push({ time, speaker: null, text: body });
    }
  }
  return turns;
}

/** Turns -> a clean "Speaker: text" transcript for the LLM / chunker. */
export function turnsToText(turns) {
  return turns
    .map((t) => (t.speaker ? `${t.speaker}: ${t.text}` : t.text))
    .join("\n");
}

export function speakersFromTurns(turns) {
  const seen = [];
  for (const turn of turns) {
    if (turn.speaker && !seen.includes(turn.speaker)) seen.push(turn.speaker);
  }
  return seen;
}

// ── Markdown / frontmatter ───────────────────────────────────────────────────

/**
 * Minimal YAML-ish frontmatter reader: flat `key: value` pairs and `- item`
 * lists only. Deliberately not a YAML parser — the recipe is zero-dependency
 * and Plaud frontmatter from the known exporters is flat.
 */
export function parseFrontmatter(text) {
  const out = { data: {}, body: String(text || "") };
  const match = out.body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return out;
  out.body = out.body.slice(match[0].length);
  let listKey = null;
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && listKey) {
      out.data[listKey].push(listItem[1].trim().replace(/^['"]|['"]$/g, ""));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();
    if (value === "") {
      listKey = key;
      out.data[key] = [];
    } else {
      listKey = null;
      out.data[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }
  return out;
}

/**
 * Split markdown on `#`/`##`/`###` boundaries.
 * Keys are lowercased for lookup; `heading` keeps the author's original casing
 * so a rebuilt document does not come back shouting in lowercase.
 *
 * @returns {Record<string,{heading:string, body:string}>}
 */
export function splitSections(markdown) {
  const order = [];
  const buffers = new Map();
  let key = "_preamble";
  buffers.set(key, { heading: "", lines: [] });
  order.push(key);
  for (const line of String(markdown || "").split("\n")) {
    const heading = line.match(/^#{1,3}\s+(.*)$/);
    if (heading) {
      const title = heading[1].trim();
      key = title.toLowerCase();
      if (!buffers.has(key)) {
        buffers.set(key, { heading: title, lines: [] });
        order.push(key);
      }
      continue;
    }
    buffers.get(key).lines.push(line);
  }
  const out = {};
  for (const k of order) {
    const { heading, lines } = buffers.get(k);
    out[k] = { heading, body: lines.join("\n").trim() };
  }
  return out;
}

/** Body text of the first section matching any of `names` (case-insensitive). */
export function sectionBody(sections, ...names) {
  for (const name of names) {
    const hit = sections[String(name).toLowerCase()];
    if (hit && hit.body) return hit.body;
  }
  return "";
}

// ── Record builders ──────────────────────────────────────────────────────────

function buildRecord({
  recordingId, meta, transcriptRaw, transcriptExt, summary, highlights, sourcePaths, layout,
}) {
  let turns = [];
  if (transcriptRaw) {
    turns = transcriptExt === ".srt" ? parseSrt(transcriptRaw) : parseTranscriptText(transcriptRaw);
  }
  const transcript = turnsToText(turns);
  const title = String(firstDefined(meta, TITLE_KEYS) || recordingId).replace(/\.(txt|md|json|srt)$/i, "");

  return {
    recording_id: String(recordingId),
    title,
    start_at: isoOrNull(firstDefined(meta, START_KEYS)),
    duration_ms: normalizeDurationMs(firstDefined(meta, DURATION_KEYS)),
    summary: (summary || "").trim(),
    highlights: (highlights || "").trim(),
    transcript,
    turns,
    speakers: speakersFromTurns(turns),
    source_paths: sourcePaths,
    // input_hash covers the raw upstream artifacts, so an unchanged export is
    // skippable even when the LLM output would differ.
    input_hash: `sha256:${sha256Hex(`${transcriptRaw || ""} ${summary || ""}`)}`,
    layout,
    raw_meta: meta && typeof meta === "object" ? meta : {},
  };
}

function readJsonIfExists(file) {
  const raw = readIfExists(file);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path.basename(file)} is not valid JSON: ${err.message}`);
  }
}

/**
 * Unofficial-CLI JSON: `{ file: {...}, recording: { trans_result: [...] } }`
 * (shape verified against danielgwilson/plaud `docs/CONTRACT_V1.md`).
 */
function turnsFromUnofficialJson(json) {
  const results =
    json?.recording?.trans_result ||
    json?.trans_result ||
    json?.transcript?.trans_result ||
    null;
  if (!Array.isArray(results)) return null;
  return results
    .map((r) => ({
      time: r.start_time !== undefined ? String(r.start_time) : null,
      speaker: r.speaker !== undefined && r.speaker !== null ? String(r.speaker) : null,
      text: String(r.content ?? r.text ?? "").trim(),
    }))
    .filter((t) => t.text);
}

// ── Discovery ────────────────────────────────────────────────────────────────

// Files the exporter, importer and reports leave in the export folder. They are
// not recordings, and treating them as one would create junk thoughts.
const EXCLUDED_BASENAMES = new Set([
  "export-manifest",
  "plaud-sync-log",
  "plaud-tier-map",
  "triage-report",
  "import-report",
  "atomization-errors",
  "readme",
  "index",
  "speakers",
  "tiers",
]);

const TRANSCRIPT_NAMES = ["transcript.txt", "transcript.srt", "transcript.md"];
const SUMMARY_NAMES = ["summary.md", "summary.txt", "note.md"];
const META_NAMES = ["meta.json", "file.json", "metadata.json"];

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function loadDirectoryRecording(root, dir) {
  const metaFile = META_NAMES.map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
  const transcriptFile = TRANSCRIPT_NAMES.map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
  const summaryFile = SUMMARY_NAMES.map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
  if (!metaFile && !transcriptFile && !summaryFile) return null;

  const meta = metaFile ? readJsonIfExists(metaFile) : {};
  const recordingId = extractRecordingId(meta) || path.basename(dir);
  const summaryRaw = summaryFile ? readIfExists(summaryFile) : "";
  const { summary, highlights } = splitSummaryDoc(summaryRaw);

  return buildRecord({
    recordingId,
    meta: meta || {},
    transcriptRaw: transcriptFile ? readIfExists(transcriptFile) : "",
    transcriptExt: transcriptFile ? path.extname(transcriptFile) : "",
    summary,
    highlights,
    sourcePaths: {
      meta: metaFile ? relative(root, metaFile) : null,
      transcript: transcriptFile ? relative(root, transcriptFile) : null,
      summary: summaryFile ? relative(root, summaryFile) : null,
    },
    layout: "directory",
  });
}

/** A Plaud summary doc often carries a highlights / action-items section. */
export function splitSummaryDoc(markdown) {
  if (!markdown) return { summary: "", highlights: "" };
  const sections = splitSections(markdown);
  const highlightKeys = Object.keys(sections).filter((k) =>
    /highlight|action item|key point|takeaway|todo/i.test(k),
  );
  if (highlightKeys.length === 0) return { summary: markdown.trim(), highlights: "" };
  const highlights = highlightKeys
    .map((k) => `${sections[k].heading}:\n${sections[k].body}`)
    .join("\n\n")
    .trim();
  const summary = Object.entries(sections)
    .filter(([k, v]) => !highlightKeys.includes(k) && v.body)
    .map(([k, v]) => (k === "_preamble" ? v.body : `${v.heading}\n${v.body}`))
    .join("\n\n")
    .trim();
  return { summary, highlights };
}

function loadFlatRecording(root, id, files) {
  const meta = files.json ? readJsonIfExists(files.json) : {};
  const unofficialTurns = meta ? turnsFromUnofficialJson(meta) : null;
  const metaObject = meta?.file && typeof meta.file === "object" ? { ...meta.file, ...meta } : meta || {};

  let transcriptRaw = files.txt ? readIfExists(files.txt) : "";
  let transcriptExt = files.txt ? path.extname(files.txt) : "";
  if (!transcriptRaw && files.srt) {
    transcriptRaw = readIfExists(files.srt);
    transcriptExt = ".srt";
  }

  const summaryRaw = files.md ? readIfExists(files.md) : "";
  const { summary, highlights } = splitSummaryDoc(summaryRaw);

  const record = buildRecord({
    recordingId: extractRecordingId(metaObject) || id,
    meta: metaObject,
    transcriptRaw,
    transcriptExt,
    summary,
    highlights,
    sourcePaths: {
      meta: files.json ? relative(root, files.json) : null,
      transcript: files.txt ? relative(root, files.txt) : files.srt ? relative(root, files.srt) : null,
      summary: files.md ? relative(root, files.md) : null,
    },
    layout: "flat",
  });

  // Structured turns from the unofficial CLI's JSON beat the rendered text file:
  // `trans_result[].speaker` is a real speaker label, not a guess from a colon.
  if (unofficialTurns && unofficialTurns.length > 0) {
    record.turns = unofficialTurns;
    record.transcript = turnsToText(unofficialTurns);
    record.speakers = speakersFromTurns(unofficialTurns);
  }
  return record;
}

function loadObsidianMarkdown(root, file) {
  const raw = readIfExists(file);
  if (!raw) return null;
  const { data, body } = parseFrontmatter(raw);
  const isPlaud =
    String(data.source || "").toLowerCase() === "plaud" ||
    data.file_id !== undefined ||
    data.plaud_id !== undefined;
  if (!isPlaud) return null;

  const sections = splitSections(body);
  const transcriptRaw = sectionBody(sections, "transcript", "full transcript", "transcription");
  const summary = sectionBody(sections, "summary", "_preamble");
  const highlights = sectionBody(sections, "highlights", "action items", "key points");

  const recordingId =
    extractRecordingId(data) || path.basename(file, path.extname(file));

  return buildRecord({
    recordingId,
    meta: data,
    transcriptRaw,
    transcriptExt: ".txt",
    summary,
    highlights,
    sourcePaths: { meta: null, transcript: relative(root, file), summary: relative(root, file) },
    layout: "obsidian-md",
  });
}

/**
 * Walk an export folder and return normalized records, sorted by start_at.
 *
 * @param {string} root export folder
 * @returns {{records: object[], warnings: string[]}}
 */
export function discoverRecordings(root) {
  const records = [];
  const warnings = [];
  const seen = new Set();

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Export folder not found or not a directory: ${root}`);
  }

  const accept = (record, label) => {
    if (!record) return;
    if (!record.transcript.trim() && !record.summary.trim()) {
      warnings.push(`${label}: no transcript or summary content — skipped`);
      return;
    }
    if (seen.has(record.recording_id)) return;
    seen.add(record.recording_id);
    records.push(record);
  };

  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const flat = new Map(); // basename -> {json,txt,md,srt}

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        let record = null;
        try {
          record = loadDirectoryRecording(root, full);
        } catch (err) {
          warnings.push(`${relative(root, full)}: ${err.message}`);
        }
        if (record) {
          accept(record, relative(root, full));
        } else {
          walk(full);
        }
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (![".json", ".txt", ".md", ".srt"].includes(ext)) continue;
      const base = entry.name.slice(0, -ext.length).replace(/\.(summary|transcript)$/i, "");
      if (EXCLUDED_BASENAMES.has(base.toLowerCase())) continue;
      const bucket = flat.get(base) || {};
      bucket[ext.slice(1)] = full;
      flat.set(base, bucket);
    }

    for (const [base, files] of flat) {
      // Obsidian-plugin markdown: a lone .md with plaud frontmatter.
      if (files.md && !files.txt && !files.json && !files.srt) {
        let record = null;
        try {
          record = loadObsidianMarkdown(root, files.md);
        } catch (err) {
          warnings.push(`${relative(root, files.md)}: ${err.message}`);
        }
        accept(record, relative(root, files.md));
        continue;
      }
      if (!files.txt && !files.srt && !files.json && !files.md) continue;
      let record = null;
      try {
        record = loadFlatRecording(root, base, files);
      } catch (err) {
        warnings.push(`${base}: ${err.message}`);
        continue;
      }
      accept(record, base);
    }
  };

  walk(root);

  records.sort((a, b) => String(a.start_at || "").localeCompare(String(b.start_at || "")));
  return { records, warnings };
}

/**
 * Apply a speaker-name override map.
 * File shape: { "<recording_id>": { "Speaker 1": "Alex" }, "_default": {...} }
 */
export function applySpeakerMap(record, speakerMap) {
  if (!speakerMap) return record;
  const map = { ...(speakerMap._default || {}), ...(speakerMap[record.recording_id] || {}) };
  if (Object.keys(map).length === 0) return record;
  record.turns = record.turns.map((t) => (t.speaker && map[t.speaker] ? { ...t, speaker: map[t.speaker] } : t));
  record.transcript = turnsToText(record.turns);
  record.speakers = speakersFromTurns(record.turns);
  return record;
}

/**
 * Deterministic transcript chunking used by `--no-llm`.
 * Splits on speaker-turn boundaries into ~targetWords-word chunks so a chunk
 * never cuts a sentence in half.
 */
export function chunkTurns(turns, targetWords = 500) {
  const chunks = [];
  let current = [];
  let words = 0;
  for (const turn of turns) {
    const line = turn.speaker ? `${turn.speaker}: ${turn.text}` : turn.text;
    const n = line.trim().split(/\s+/).filter(Boolean).length;
    if (words > 0 && words + n > targetWords) {
      chunks.push(current.join("\n"));
      current = [];
      words = 0;
    }
    current.push(line);
    words += n;
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks.filter((c) => c.trim().length > 0);
}
