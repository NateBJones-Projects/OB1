#!/usr/bin/env node
/**
 * fetch-shared.mjs — pull ONE publicly shared Plaud recording into a local
 * folder that `import-plaud.mjs` can already read.
 *
 * Where the data comes from
 * -------------------------
 * A share link (`https://web.plaud.ai/s/pub_<uuid>::<token>`) is an HTML shell
 * that iframes `/nshare/<id>`, which is a Vue app. The app is populated by one
 * unauthenticated JSON call:
 *
 *     GET https://api.plaud.ai/share/access/<share_id>
 *
 * That single response carries everything the share page renders: the
 * transcript, the AI summary note, the highlight marks, and a
 * `download_link_map` of presigned S3 URLs for every image. No credentials and
 * no cookies — the only header that matters is a browser-shaped `User-Agent`,
 * because Cloudflare 403s Node's default one. The endpoint was found by reading
 * the share page's own network activity, not from published documentation, so
 * treat it as an internal API that can change without notice (see the README's
 * "Unverified Plaud behaviour" table).
 *
 * Failure is reported IN THE BODY, not the HTTP status: a dead, private or
 * expired link still answers `200` with `{"msg":"Share not found",
 * "status":40400}`. `status === 0` is the only success signal.
 *
 * Output — the per-recording directory layout `discoverRecordings` reads:
 *
 *   <out>/<recording_id>/meta.json      title, start time, duration, speakers,
 *                                       share_url, fetched_at
 *   <out>/<recording_id>/transcript.txt "[HH:MM:SS] Speaker: line"
 *   <out>/<recording_id>/summary.md     the Plaud summary verbatim, plus a
 *                                       `## Highlights` section
 *   <out>/<recording_id>/media/…        images and the summary infographic
 *
 * Usage:
 *   node fetch-shared.mjs <share-url-or-id> --out ~/plaud-export
 *   node fetch-shared.mjs pub_xxx::yyy --out ~/plaud-export --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ensureDir,
  fetchWithTimeout,
  intFlag,
  isoOrNull,
  loadEnv,
  parseArgs,
  withBackoff,
} from "./lib/common.mjs";

const HELP = `
fetch-shared.mjs — fetch one publicly shared Plaud recording to a local folder.

Usage:
  node fetch-shared.mjs <share-url-or-id> --out <dir> [options]

Arguments:
  <share-url-or-id>    Either the full link
                       (https://web.plaud.ai/s/pub_<uuid>::<token>) or the bare
                       pub_<uuid>::<token> id.

Options:
  --out <dir>          Destination folder (required). One subfolder is created
                       inside it, named after the recording id.
  --id <name>          Override the derived recording id (the subfolder name).
  --no-media           Skip images and the summary infographic.
  --force              Overwrite an existing recording folder.
  --dry-run            Report what would be written. No network writes to disk.
  --timeout-ms <n>     Per-request timeout. Default: 45000
  --retries <n>        Retries per request, exponential backoff. Default: 3
  --verbose            Print the endpoint, sizes, and every media file.
  --help               Show this help.

Notes:
  - No credentials are needed or stored. The share endpoint is public.
  - The output folder holds personal recording content. Keep it outside any
    git repository.
  - Feed the result straight to the importer:
      node import-plaud.mjs <dir> --dry-run
`;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

// ── Share id parsing ─────────────────────────────────────────────────────────

/**
 * The share id as it appears in the URL. The `::` separates a public uuid from
 * an access token. The token is accepted but optional: the API answers for the
 * uuid alone (verified 2026-09-14), so a link truncated at the `::` still
 * works. Anything else is rejected rather than sent to the API, because the
 * API answers a garbage id with a cheerful 200.
 */
const SHARE_ID_RE = /^pub_[0-9A-Za-z-]{8,}(?:::[A-Za-z0-9_-]{8,})?$/;

const SHARE_PATH_PREFIXES = ["/s/", "/nshare/", "/share/"];

/**
 * Normalize a share URL or bare id into its parts.
 *
 * Accepts:
 *   https://web.plaud.ai/s/pub_<uuid>::<token>      (the link Plaud hands out)
 *   https://web.plaud.ai/nshare/pub_<uuid>::<token> (the inner iframe)
 *   pub_<uuid>::<token>                             (bare id)
 *
 * @param {string} input
 * @returns {{shareId: string, uuid: string, token: string|null}}
 * @throws {Error} with an actionable message when the input is not a share id
 */
export function parseShareId(input) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("No share link given. Pass the URL or the pub_…::… id.");

  let candidate = raw;
  if (/^https?:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`Not a valid URL: "${raw}"`);
    }
    const pathname = url.pathname;
    const prefix = SHARE_PATH_PREFIXES.find((p) => pathname.startsWith(p));
    if (!prefix) {
      throw new Error(
        `"${pathname}" is not a Plaud share path. Expected /s/<id> or /nshare/<id>, ` +
          `e.g. https://web.plaud.ai/s/pub_<uuid>::<token>.`,
      );
    }
    // The id is one path segment; browsers percent-encode the "::".
    candidate = decodeURIComponent(pathname.slice(prefix.length).replace(/\/+$/, ""));
  }

  if (!SHARE_ID_RE.test(candidate)) {
    throw new Error(
      `"${candidate}" is not a Plaud share id. Expected pub_<uuid>::<token>, ` +
        `for example pub_00000000-0000-0000-0000-000000000000::AbCdEf1234. ` +
        `Copy the link straight from Plaud's Share dialog.`,
    );
  }

  const [uuid, token = null] = candidate.split("::");
  return { shareId: candidate, uuid, token };
}

// ── API ──────────────────────────────────────────────────────────────────────

export const DEFAULT_API_BASE = "https://api.plaud.ai";

/**
 * api.plaud.ai sits behind Cloudflare, which answers Node's default
 * `User-Agent: node` with a 403 HTML challenge page. A browser-shaped UA is
 * enough to pass (verified 2026-09-14) — no cookies, no tokens, no JS
 * challenge. This is a bot rule, not authentication: Plaud can tighten it at
 * any time, and if they do, this script fails with the message below rather
 * than silently writing a challenge page to disk. Override with
 * `PLAUD_SHARE_USER_AGENT` in `.env.local`.
 */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** Body-level status codes seen from the share endpoint, mapped to advice. */
const STATUS_ADVICE = {
  40400:
    "Plaud says the share does not exist. The link was revoked, expired, or was " +
    "never public — re-share the recording in Plaud and use the new link.",
  40401: "Plaud refused the share (unauthorized). It is probably no longer public.",
  40403: "Plaud refused the share (forbidden). It is probably no longer public.",
};

export function shareEndpoint(apiBase, shareId) {
  // The id contains "::", which is legal in a path segment; do not encode it,
  // the API matches on the literal value.
  return `${String(apiBase).replace(/\/+$/, "")}/share/access/${shareId}`;
}

/**
 * Fetch and validate the share payload.
 *
 * @returns {Promise<object>} the parsed body, guaranteed `status === 0` and
 *   carrying a `data_file` object.
 */
export async function fetchSharePayload(
  shareId,
  { apiBase, timeoutMs, retries, verbose, userAgent } = {},
) {
  const url = shareEndpoint(apiBase || DEFAULT_API_BASE, shareId);
  if (verbose) console.log(`    GET ${url}`);

  const body = await withBackoff(
    async () => {
      const res = await fetchWithTimeout(
        url,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": userAgent || DEFAULT_USER_AGENT,
          },
        },
        timeoutMs || 45_000,
      );
      if (!res.ok) {
        const err = new Error(
          res.status === 403
            ? `${url} returned HTTP 403. This is Cloudflare's bot rule, not a bad share ` +
              `link — the endpoint rejects unrecognised User-Agents. Set ` +
              `PLAUD_SHARE_USER_AGENT in .env.local to a current browser UA string.`
            : `${url} returned HTTP ${res.status} ${res.statusText}`,
        );
        // 4xx other than 429 will not fix itself.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) err.noRetry = true;
        throw err;
      }
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        const err = new Error(
          `${url} did not return JSON. Got ${text.length} bytes starting ` +
            `"${text.slice(0, 80).replace(/\s+/g, " ")}". The share API may have moved.`,
        );
        err.noRetry = true;
        throw err;
      }
    },
    {
      retries: retries ?? 3,
      baseMs: 1000,
      onRetry: (err, attempt, wait) =>
        console.warn(`    retry ${attempt} in ${wait}ms — ${err.message}`),
    },
  );

  // The endpoint reports failure in the body with HTTP 200. Checking res.ok is
  // not enough; `status` is the real signal.
  if (!body || typeof body !== "object") {
    throw new Error(`${url} returned ${typeof body}, expected a JSON object.`);
  }
  if (body.status !== 0) {
    const advice = STATUS_ADVICE[body.status] || "The share link did not resolve.";
    throw new Error(
      `Plaud rejected this share link (status ${body.status}` +
        `${body.msg ? `, "${body.msg}"` : ""}). ${advice}`,
    );
  }
  if (!body.data_file || typeof body.data_file !== "object") {
    throw new Error(
      `${url} answered status 0 but with no "data_file" object ` +
        `(top-level keys: ${Object.keys(body).join(", ") || "none"}). ` +
        `The share payload shape has changed — see fetch-shared.mjs's header comment.`,
    );
  }
  return body;
}

// ── Payload -> files ─────────────────────────────────────────────────────────

function msToClock(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * `trans_result[]` -> "[HH:MM:SS] Speaker: line".
 *
 * `transaction_polish[]` is a parallel, lightly cleaned-up array (it differed
 * on 273 of 348 segments in the recording this was built against). We take the
 * raw `trans_result` so the transcript matches what the share page labels as
 * the transcript, and fall back to the polished one only if it is absent.
 */
export function renderTranscript(dataFile) {
  const segments =
    (Array.isArray(dataFile.trans_result) && dataFile.trans_result.length
      ? dataFile.trans_result
      : Array.isArray(dataFile.transaction_polish)
        ? dataFile.transaction_polish
        : []) || [];

  const lines = [];
  for (const seg of segments) {
    const text = String(seg?.content ?? "").trim();
    if (!text) continue;
    const speaker = String(seg?.speaker ?? seg?.original_speaker ?? "").trim();
    const clock = msToClock(seg?.start_time);
    lines.push(speaker ? `[${clock}] ${speaker}: ${text}` : `[${clock}] ${text}`);
  }
  return lines.join("\n");
}

export function speakersOf(dataFile) {
  const seen = [];
  for (const seg of Array.isArray(dataFile.trans_result) ? dataFile.trans_result : []) {
    const speaker = String(seg?.speaker ?? "").trim();
    if (speaker && !seen.includes(speaker)) seen.push(speaker);
  }
  return seen;
}

/** The AI summary note, if the share carries one. */
export function findSummaryNote(dataFile) {
  const notes = Array.isArray(dataFile.notes_list) ? dataFile.notes_list : [];
  const note =
    notes.find((n) => n?.data_type === "auto_sum_note") ||
    notes.find((n) => String(n?.data_tab_name).toLowerCase() === "summary");
  const content = String(note?.data_content ?? "").trim();
  return content || "";
}

/**
 * The highlight marks. Plaud stores them as a JSON *string* in the
 * `high_light` note's `data_content`, not as structured JSON — so a parse
 * failure here is expected to be survivable, not fatal.
 */
export function findHighlightMarks(dataFile, warnings = []) {
  const notes = Array.isArray(dataFile.notes_list) ? dataFile.notes_list : [];
  const note =
    notes.find((n) => n?.data_type === "high_light") ||
    notes.find((n) => String(n?.data_tab_name).toLowerCase() === "highlights");
  if (!note || !note.data_content) return [];
  let parsed;
  try {
    parsed = JSON.parse(note.data_content);
  } catch (err) {
    warnings.push(`highlights note was not parseable JSON (${err.message}) — skipped`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    warnings.push(`highlights note was ${typeof parsed}, expected an array — skipped`);
    return [];
  }
  return parsed.filter((m) => m && !m.is_user_deleted);
}

/** Safe local filename for an S3 object key, keeping the original basename. */
export function mediaFilename(objectKey, taken = new Set()) {
  const base = decodeURIComponent(String(objectKey).split("/").pop() || "image");
  let name = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+/, "").slice(0, 120);
  if (!name || name === "." || name === "..") name = "image";
  if (!path.extname(name)) name += ".bin";
  let candidate = name;
  let n = 2;
  while (taken.has(candidate)) {
    const ext = path.extname(name);
    candidate = `${name.slice(0, name.length - ext.length)}-${n}${ext}`;
    n++;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * Plan the media files. `download_link_map` maps an S3 object key to a
 * presigned URL; the same key appears inside the summary markdown as an image
 * target and on image highlight marks as `picture_link`.
 */
export function planMedia(dataFile) {
  const map = dataFile.download_link_map;
  if (!map || typeof map !== "object") return [];
  const taken = new Set();
  return Object.entries(map)
    .filter(([key, url]) => key && typeof url === "string" && /^https?:\/\//i.test(url))
    .map(([key, url]) => ({ key, url, filename: mediaFilename(key, taken) }));
}

/** Rewrite S3 object keys in markdown to the local `media/…` path. */
export function rewriteMediaRefs(markdown, media) {
  let out = String(markdown || "");
  for (const item of media) {
    // Keys are long unique paths; a literal split/join is safer than a regex
    // built from untrusted text.
    out = out.split(item.key).join(`media/${item.filename}`);
  }
  return out;
}

/**
 * Build summary.md.
 *
 * The heading names matter: `splitSummaryDoc()` in lib/plaud-parse.mjs pulls
 * any section matching /highlight|action item|key point|takeaway|todo/i into
 * the record's `highlights` field. So the marks go under `## Highlights`, and
 * Plaud's own `## Action Items` section (when present) is left exactly where
 * it is and gets picked up for free. Marks are rendered as a flat bullet list
 * — a `###` sub-heading per mark would open a new section and leak the marks
 * back into `summary`.
 */
export function buildSummaryDoc(summaryMarkdown, marks, media) {
  const parts = [];
  const body = rewriteMediaRefs(summaryMarkdown, media).trim();
  if (body) parts.push(body);

  const rendered = marks
    .map((mark) => {
      const title = String(mark?.title ?? "").trim();
      const content = String(mark?.content ?? mark?.expanded_content ?? "").trim();
      if (!title && !content) return "";
      const clock = msToClock(mark?.timestamp);
      const kind = String(mark?.mark_type_string ?? "").trim();
      const head = `- **[${clock}]${kind ? ` (${kind})` : ""}** ${title || content.split("\n")[0]}`;
      const lines = [head];
      if (title && content) {
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (trimmed) lines.push(`  ${trimmed}`);
        }
      }
      const picture = String(mark?.picture_link ?? "").trim();
      const hit = picture && media.find((m) => m.key === picture);
      if (hit) lines.push(`  ![${title || "highlight image"}](media/${hit.filename})`);
      return lines.join("\n");
    })
    .filter(Boolean);

  if (rendered.length > 0) parts.push(`## Highlights\n\n${rendered.join("\n\n")}`);
  return parts.length > 0 ? `${parts.join("\n\n")}\n` : "";
}

/** meta.json, using the key names lib/plaud-parse.mjs already looks for. */
export function buildMeta(payload, { shareId, shareUrl, recordingId, fetchedAt }) {
  const f = payload.data_file;
  return {
    // Read by plaud-parse: id / title / start_time / duration.
    id: recordingId,
    title: String(f.filename ?? recordingId),
    start_time: f.start_time ?? null,
    duration: f.duration ?? null,
    // Informational.
    start_at: isoOrNull(f.start_time),
    speakers: speakersOf(f),
    file_language: f.file_language ?? null,
    plaud_file_id: f.id ?? null,
    owner_name: payload.owner_name || null,
    object_type: payload.object_type ?? null,
    share_id: shareId,
    share_url: shareUrl,
    fetched_at: fetchedAt,
    source: "plaud-share",
    segment_count: Array.isArray(f.trans_result) ? f.trans_result.length : 0,
  };
}

/**
 * Turn a validated payload into the list of files to write.
 * Pure: no disk, no network — which is what makes --dry-run honest.
 */
export function planRecording(payload, { shareId, shareUrl, idOverride, includeMedia = true }) {
  const warnings = [];
  const f = payload.data_file;
  const recordingId = String(
    idOverride || f.id || shareId.split("::")[0] || "plaud-share",
  ).replace(/[^A-Za-z0-9._-]+/g, "_");

  const media = includeMedia ? planMedia(f) : [];
  const transcript = renderTranscript(f);
  const summary = buildSummaryDoc(findSummaryNote(f), findHighlightMarks(f, warnings), media);

  if (!transcript) {
    warnings.push(
      "the share carries no transcript segments " +
        `(is_trans=${payload.is_trans}) — the importer will have only the summary`,
    );
  }
  if (!summary) {
    warnings.push(
      "the share carries no summary or highlights " +
        `(is_ai_content=${payload.is_ai_content}) — the importer will synthesize one`,
    );
  }
  if (!transcript && !summary) {
    throw new Error(
      "This share has neither a transcript nor a summary, so there is nothing to " +
        "import. Check the recording has finished transcribing in Plaud.",
    );
  }

  return {
    recordingId,
    media,
    warnings,
    files: [
      {
        name: "meta.json",
        text: `${JSON.stringify(
          buildMeta(payload, {
            shareId,
            shareUrl,
            recordingId,
            fetchedAt: new Date().toISOString(),
          }),
          null,
          2,
        )}\n`,
      },
      ...(transcript ? [{ name: "transcript.txt", text: `${transcript}\n` }] : []),
      ...(summary ? [{ name: "summary.md", text: summary }] : []),
    ],
  };
}

// ── Media download ───────────────────────────────────────────────────────────

async function downloadMedia(item, destDir, { timeoutMs, retries, verbose, userAgent }) {
  const res = await withBackoff(
    async () => {
      const r = await fetchWithTimeout(
        item.url,
        { headers: { "User-Agent": userAgent || DEFAULT_USER_AGENT } },
        timeoutMs || 45_000,
      );
      if (!r.ok) {
        const err = new Error(`HTTP ${r.status} ${r.statusText}`);
        // Presigned S3 URLs expire; a 403 will not recover on retry.
        if (r.status === 403 || r.status === 404) err.noRetry = true;
        throw err;
      }
      return r;
    },
    { retries: retries ?? 3, baseMs: 800 },
  );
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(destDir, item.filename), buffer);
  if (verbose) console.log(`    media/${item.filename} (${buffer.length} bytes)`);
  return buffer.length;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv, {
      booleans: ["no-media", "force", "dry-run", "verbose", "help"],
      values: ["out", "id", "timeout-ms", "retries"],
    });
  } catch (err) {
    fail(err.message);
  }
  const { flags, positional, unknown } = parsed;

  if (flags.help || (positional.length === 0 && argv.length === 0)) {
    console.log(HELP.trim());
    return;
  }
  if (unknown.length > 0) fail(`Unknown option(s): ${unknown.join(", ")}. Try --help.`);

  const env = loadEnv(path.dirname(new URL(import.meta.url).pathname));
  const apiBase = env.PLAUD_SHARE_API_BASE || DEFAULT_API_BASE;
  const userAgent = env.PLAUD_SHARE_USER_AGENT || DEFAULT_USER_AGENT;
  const verbose = Boolean(flags.verbose);
  const dryRun = Boolean(flags["dry-run"]);
  const timeoutMs = intFlag(flags, "timeout-ms", 45_000);
  const retries = intFlag(flags, "retries", 3);

  if (positional.length === 0) fail("Pass the share link or id. Try --help.");
  if (positional.length > 1) {
    fail(`Expected one share link, got ${positional.length}: ${positional.join(", ")}`);
  }
  if (!flags.out) fail("--out <dir> is required. Try --help.");

  let share;
  try {
    share = parseShareId(positional[0]);
  } catch (err) {
    fail(err.message);
  }

  const outRoot = path.resolve(String(flags.out));
  const shareUrl = `https://web.plaud.ai/s/${share.shareId}`;

  console.log(`Fetching share ${share.uuid}${share.token ? "::…" : ""}`);
  let payload;
  try {
    payload = await fetchSharePayload(share.shareId, {
      apiBase,
      timeoutMs,
      retries,
      verbose,
      userAgent,
    });
  } catch (err) {
    fail(err.message);
  }

  let plan;
  try {
    plan = planRecording(payload, {
      shareId: share.shareId,
      shareUrl,
      idOverride: flags.id ? String(flags.id) : null,
      includeMedia: !flags["no-media"],
    });
  } catch (err) {
    fail(err.message);
  }

  for (const warning of plan.warnings) console.warn(`  warning: ${warning}`);

  const destDir = path.join(outRoot, plan.recordingId);
  const exists = fs.existsSync(destDir) && fs.readdirSync(destDir).length > 0;
  if (exists && !flags.force && !dryRun) {
    fail(
      `${destDir} already exists and is not empty. Pass --force to overwrite, ` +
        `or --id <name> to write under a different folder name.`,
    );
  }

  const title = String(payload.data_file.filename ?? plan.recordingId);
  console.log(`  title:      ${title}`);
  console.log(`  recording:  ${plan.recordingId}`);
  console.log(`  start:      ${isoOrNull(payload.data_file.start_time) || "unknown"}`);

  if (dryRun) {
    console.log(`\nDry run — would write to ${destDir}:`);
    for (const file of plan.files) {
      console.log(`  ${file.name.padEnd(16)} ${Buffer.byteLength(file.text)} bytes`);
    }
    for (const item of plan.media) console.log(`  media/${item.filename}`);
    if (plan.media.length === 0) console.log("  (no media)");
    if (exists) console.log(`\nNote: ${destDir} already exists; --force would be required.`);
    return;
  }

  ensureDir(destDir);
  for (const file of plan.files) {
    fs.writeFileSync(path.join(destDir, file.name), file.text, "utf8");
    if (verbose) console.log(`    ${file.name} (${Buffer.byteLength(file.text)} bytes)`);
  }

  let mediaOk = 0;
  if (plan.media.length > 0) {
    const mediaDir = path.join(destDir, "media");
    ensureDir(mediaDir);
    for (const item of plan.media) {
      try {
        await downloadMedia(item, mediaDir, { timeoutMs, retries, verbose, userAgent });
        mediaOk++;
      } catch (err) {
        // A dead presigned URL must not lose the transcript we already wrote.
        console.warn(`  warning: media/${item.filename} failed — ${err.message}`);
      }
    }
  }

  console.log(
    `\nWrote ${destDir} (${plan.files.map((f) => f.name).join(", ")}` +
      `${plan.media.length ? `, ${mediaOk}/${plan.media.length} media` : ""}).`,
  );
  console.log(`Next: node import-plaud.mjs ${outRoot} --dry-run`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2)).catch((err) => fail(err.stack || err.message));
}
