#!/usr/bin/env node
/**
 * Open Brain — Hermes Agent session-end capture hook
 *
 * Hermes adapter for the auto-capture skill. Hermes keeps every session
 * transcript in SQLite (`$HERMES_HOME/state.db`, tables `sessions` and
 * `messages`) rather than in flat files, so this script reads the rows for one
 * session, formats the user/assistant turns, caps the payload under the
 * embedding limit, and POSTs it to the Open Brain REST `/ingest` endpoint.
 *
 * Wiring (see README.md): a Hermes *shell hook* in `config.yaml` under
 * `hooks.on_session_finalize` (fires once at session teardown) and, optionally,
 * `hooks.on_session_end` (fires after every turn; handled with a debounce so a
 * long-lived gateway chat that never finalizes is still captured when idle).
 *
 * Modes:
 *   stdin JSON (hook payload)      normal hook operation
 *   --session <id|prefix>          capture one session by id
 *   --latest                       capture the newest non-subagent session
 *   --dry-run                      print the payload instead of sending it
 *   --deferred <sid> <token>       internal: detached deferred capture
 *
 * Node 18+ with no dependencies. Uses `node:sqlite` when available (Node 22.5+)
 * and falls back to the `sqlite3` CLI otherwise. All errors are logged and
 * swallowed — this hook must never block Hermes shutdown.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);

// Hermes sets HERMES_HOME for the hook subprocess to the profile that fired it,
// so multi-profile installs read the right state.db automatically.
const HERMES_HOME = process.env.HERMES_HOME
  ? path.resolve(process.env.HERMES_HOME)
  : path.join(os.homedir(), ".hermes");
const STATE_DB_PATH = process.env.OB_HERMES_STATE_DB
  ? path.resolve(process.env.OB_HERMES_STATE_DB)
  : path.join(HERMES_HOME, "state.db");

// Where credentials, logs, per-session state, and the retry queue live.
// Defaults to the script's own directory so one install serves every profile.
const CAPTURE_ROOT = process.env.OB_CAPTURE_ROOT
  ? path.resolve(process.env.OB_CAPTURE_ROOT)
  : SCRIPT_DIR;
const ENV_PATH = path.join(CAPTURE_ROOT, ".env.local");
const LOG_DIR = path.join(CAPTURE_ROOT, "logs");
const LOG_PATH = path.join(LOG_DIR, "ambient-capture-hermes.log");
const STATE_DIR = path.join(CAPTURE_ROOT, "state", "sessions");
const RETRY_QUEUE_DIR = path.join(CAPTURE_ROOT, "data", "capture-retry-queue");
const RETRY_DEAD_DIR = path.join(RETRY_QUEUE_DIR, "dead");

const MIN_USER_TURNS = Number(process.env.OB_CAPTURE_MIN_USER_TURNS || 3);
// The ingest endpoint embeds the text with text-embedding-3-small (~8191 token
// limit). Long sessions exceed it and the endpoint returns HTTP 500 (while still
// writing an embedding-less row). Cap the payload well under the limit.
const MAX_INGEST_CHARS = Number(process.env.OB_CAPTURE_MAX_CHARS || 24000);
// on_session_end fires per turn: wait this long after the last turn before
// capturing, so a session is captured once, when it goes idle.
const DEBOUNCE_MS = Number(process.env.OB_CAPTURE_DEBOUNCE_MS ?? 120000);
// on_session_finalize fires once at teardown, but the final turn may still be
// flushing to state.db. Wait briefly before reading.
const FINALIZE_DELAY_MS = Number(process.env.OB_CAPTURE_FINALIZE_DELAY_MS ?? 5000);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 10000);
const HARD_TIMEOUT_MS = Number(process.env.OB_CAPTURE_HARD_TIMEOUT_MS || 25000);
const RETRY_MAX_ATTEMPTS = 5;
const RETRY_BATCH_SIZE = 3;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run") || process.env.OB_CAPTURE_DRY_RUN === "1";

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (argv[0] === "--deferred") {
    await runDeferred(argv[1], argv[2], Number(argv[3] || 0));
    return;
  }

  const sessionFlag = flagValue("--session");
  if (sessionFlag || argv.includes("--latest")) {
    const session = sessionFlag ? findSession(sessionFlag) : findLatestSession();
    if (!session) {
      appendLog(sessionFlag || "latest", "unknown", 0, "skipped:no_session");
      console.error(`No Hermes session found in ${STATE_DB_PATH}`);
      return;
    }
    await captureSession(session, { sync: true });
    return;
  }

  // Hook mode: Hermes pipes a JSON payload on stdin.
  const input = await readStdinJson();
  const event = input.hook_event_name || "";
  const sessionId = String(input.session_id || "");
  const extra = input.extra || {};
  const platform = extra.platform || "";

  if (!sessionId) {
    appendLog("unknown", projectNameFromCwd(input.cwd), 0, `skipped:no_session_id:${event}`);
    emitHookNoop();
    return;
  }

  if (event !== "on_session_end" && event !== "on_session_finalize") {
    appendLog(sessionId, projectNameFromCwd(input.cwd), 0, `skipped:event_${event || "unknown"}`);
    emitHookNoop();
    return;
  }

  const state = readSessionState(sessionId);
  if (state?.captured_at) {
    appendLog(sessionId, state.project_name || "unknown", 0, "skipped:already_captured");
    emitHookNoop();
    return;
  }

  // Each hook fire supersedes the previous schedule; the newest token wins.
  const token = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  writeSessionState(sessionId, {
    ...(state || {}),
    session_id: sessionId,
    token,
    last_event: event,
    platform,
    cwd: input.cwd || "",
    profile: input.profile || "",
    hermes_home: HERMES_HOME,
    updated_at: new Date().toISOString(),
  });

  const delay = event === "on_session_finalize" ? FINALIZE_DELAY_MS : DEBOUNCE_MS;

  if (DRY_RUN) {
    // Dry runs write no state, so capture directly instead of via the state file.
    const session = findSession(sessionId);
    if (!session) appendLog(sessionId, projectNameFromCwd(input.cwd), 0, "skipped:no_session");
    else await captureSession(session, { sync: true });
    return;
  }

  if (delay <= 0 || process.env.OB_CAPTURE_SYNC === "1") {
    await captureIfCurrent(sessionId, token);
    emitHookNoop();
    return;
  }

  spawn(process.execPath, [SCRIPT_PATH, "--deferred", sessionId, token, String(delay)], {
    cwd: CAPTURE_ROOT,
    env: { ...process.env, OB_CAPTURE_ROOT: CAPTURE_ROOT, HERMES_HOME },
    detached: true,
    stdio: "ignore",
  }).unref();

  appendLog(sessionId, projectNameFromCwd(input.cwd), 0, `scheduled:${event}:delay_${delay}ms`);
  emitHookNoop();
}

async function runDeferred(sessionId, token, delayMs) {
  if (!sessionId || !token) return;
  if (delayMs > 0) await sleep(delayMs);
  await captureIfCurrent(sessionId, token);
}

async function captureIfCurrent(sessionId, token) {
  const state = readSessionState(sessionId);
  if (!state) return;
  if (state.captured_at) {
    appendLog(sessionId, state.project_name || "unknown", 0, "skipped:already_captured");
    return;
  }
  if (state.token !== token) {
    appendLog(sessionId, state.project_name || "unknown", 0, "skipped:superseded");
    return;
  }

  const session = findSession(sessionId);
  if (!session) {
    appendLog(sessionId, state.project_name || "unknown", 0, "skipped:no_session");
    return;
  }
  await captureSession(session, { sync: false, state, token });
}

async function captureSession(session, { sync, state = null, token = null }) {
  const sessionId = session.id;
  const projectName = projectNameFromCwd(session.cwd);

  if (isSubagentSession(session)) {
    appendLog(sessionId, projectName, 0, "skipped:subagent");
    return;
  }

  let parsed;
  try {
    parsed = parseHermesSession(session);
  } catch (error) {
    appendLog(sessionId, projectName, 0, `error:parse:${messageOf(error)}`);
    return;
  }

  if (parsed.userTurns < MIN_USER_TURNS) {
    appendLog(sessionId, projectName, parsed.userTurns, "skipped:too_short");
    if (DRY_RUN) console.error(`Session ${sessionId} has ${parsed.userTurns} user turns (< ${MIN_USER_TURNS}); nothing to capture.`);
    return;
  }

  const formattedText = formatTranscript(parsed, projectName);
  const payload = {
    text: formattedText,
    source_label: `hermes:${projectName}`,
    source_type: "hermes_ambient",
    auto_execute: true,
    // import_key lets the ingest endpoint de-dupe a retry that races with a
    // belated success from the original POST.
    import_key: buildImportKey(sessionId, formattedText),
  };

  if (DRY_RUN) {
    appendLog(sessionId, projectName, parsed.userTurns, `dry_run:chars_${formattedText.length}`);
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }

  const env = loadEnv();
  const supabaseUrl = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const mcpKey = env.MCP_ACCESS_KEY || process.env.MCP_ACCESS_KEY;
  if (!supabaseUrl || !mcpKey) {
    appendLog(sessionId, projectName, parsed.userTurns, "error:missing_env");
    return;
  }

  const ingestUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/open-brain-rest/ingest`;
  await processRetryQueue(ingestUrl, mcpKey);

  try {
    const result = await postIngest(ingestUrl, mcpKey, payload);
    const ref = result?.job_id || result?.thought_id || result?.id || "unknown";
    if (!sync || state) {
      writeSessionState(sessionId, {
        ...(state || readSessionState(sessionId) || { session_id: sessionId }),
        project_name: projectName,
        captured_at: new Date().toISOString(),
        captured_token: token,
        ingest_ref: ref,
        user_turns: parsed.userTurns,
      });
    }
    appendLog(sessionId, projectName, parsed.userTurns, `captured:${ref}`);
  } catch (error) {
    const isAbort = error?.name === "AbortError";
    const permanent = error?.permanent === true;
    appendLog(sessionId, projectName, parsed.userTurns,
      isAbort ? `error:fetch:timeout_${FETCH_TIMEOUT_MS}ms`
        : permanent ? `error:${messageOf(error)}:permanent`
          : `error:fetch:${messageOf(error)}`);
    // 4xx responses are permanent client errors (bad key, bad payload); do not retry.
    if (!permanent) saveToRetryQueue(payload, isAbort ? `timeout ${FETCH_TIMEOUT_MS}ms` : messageOf(error), sessionId);
  }
}

// ── Reading Hermes state.db ─────────────────────────────────────────────────

const SESSION_COLUMNS = [
  "id", "source", "created_source", "profile_name", "parent_session_id", "title",
  "model", "cwd", "git_branch", "started_at", "ended_at", "end_reason",
  "message_count", "last_activity_at",
].join(", ");

export function findSession(idOrPrefix) {
  const rows = query(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ? OR id LIKE ? || '%'
     ORDER BY (id = ?) DESC, COALESCE(last_activity_at, started_at) DESC LIMIT 1`,
    [idOrPrefix, idOrPrefix, idOrPrefix],
  );
  return rows[0] || null;
}

export function findLatestSession() {
  const rows = query(
    `SELECT ${SESSION_COLUMNS} FROM sessions
     WHERE parent_session_id IS NULL AND COALESCE(title, '') NOT LIKE 'Subagent:%'
       AND (SELECT COUNT(*) FROM messages m WHERE m.session_id = sessions.id AND m.role = 'user') > 0
     ORDER BY COALESCE(last_activity_at, started_at) DESC LIMIT 1`,
    [],
  );
  return rows[0] || null;
}

export function isSubagentSession(session) {
  return Boolean(session.parent_session_id) || /^Subagent:/.test(String(session.title || ""));
}

/**
 * Pull the conversation for one session out of state.db.
 *
 * Hermes rows: role in {user, assistant, tool, session_meta}. Assistant rows
 * whose `content` is empty are tool-call-only steps (the calls live in
 * `tool_calls`), so they carry no prose and are dropped. Rows flagged
 * `_compressed_summary = 1` are context-compaction summaries that duplicate
 * earlier turns, so they are excluded. Compacted originals keep their content
 * (`compacted = 1, active = 0`) and are kept so the full session survives.
 */
export function parseHermesSession(session) {
  const rows = query(
    `SELECT role, content, timestamp FROM messages
     WHERE session_id = ? AND role IN ('user', 'assistant') AND _compressed_summary = 0
     ORDER BY id ASC`,
    [session.id],
  );

  const turns = [];
  for (const row of rows) {
    const content = extractText(row.content);
    if (!content) continue;
    if (row.role === "user") {
      // Scheduled cron output is injected as a user message but is not the
      // user speaking. Keep it for context, but do not count it as a user turn.
      const isCron = /^\[Cronjob\b/.test(content);
      turns.push({ role: "user", phase: isCron ? "cron" : "", content, timestamp: row.timestamp, countsAsUser: !isCron });
    } else {
      turns.push({ role: "assistant", phase: "", content, timestamp: row.timestamp, countsAsUser: false });
    }
  }

  return {
    sourceType: "hermes_state_db",
    sessionId: session.id,
    source: session.source || "",
    platform: session.created_source || session.source || "",
    profile: session.profile_name || "",
    title: session.title || "",
    model: session.model || "",
    cwd: session.cwd || "",
    gitBranch: session.git_branch || "",
    startedAt: toIso(session.started_at),
    endedAt: toIso(session.ended_at),
    endReason: session.end_reason || "",
    turns,
    userTurns: turns.filter((turn) => turn.countsAsUser).length,
  };
}

// Content is normally plain text. Tolerate a JSON array of typed parts
// (multimodal messages) by concatenating its text parts.
function extractText(content) {
  if (content == null) return "";
  const text = String(content).trim();
  if (!text) return "";
  if (text.startsWith("[{") || text.startsWith("{\"")) {
    try {
      const parsed = JSON.parse(text);
      const parts = Array.isArray(parsed) ? parsed : [parsed];
      const joined = parts
        .filter((part) => part && typeof part === "object" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (joined) return joined;
    } catch {
      // not JSON — fall through and use it verbatim
    }
  }
  return text;
}

function query(sql, params) {
  try {
    return queryWithNodeSqlite(sql, params);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" || error?.code === "ERR_UNKNOWN_BUILTIN_MODULE" || /node:sqlite/.test(messageOf(error))) {
      return queryWithSqliteCli(sql, params);
    }
    // node:sqlite exists but could not read the DB (lock, WAL permission):
    // give the CLI one chance before failing.
    try {
      return queryWithSqliteCli(sql, params);
    } catch {
      throw error;
    }
  }
}

let sqliteModule;
function queryWithNodeSqlite(sql, params) {
  if (!sqliteModule) {
    // Synchronous require of a builtin from ESM; throws ERR_UNKNOWN_BUILTIN_MODULE on Node < 22.5.
    const { createRequire } = requireModule();
    sqliteModule = createRequire(import.meta.url)("node:sqlite");
  }
  if (!fs.existsSync(STATE_DB_PATH)) throw new Error(`state.db not found at ${STATE_DB_PATH}`);
  const db = new sqliteModule.DatabaseSync(STATE_DB_PATH, { readOnly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

let nodeModuleCache;
function requireModule() {
  if (!nodeModuleCache) {
    // `module` is always available; we only need createRequire from it.
    nodeModuleCache = process.getBuiltinModule
      ? process.getBuiltinModule("node:module")
      : null;
    if (!nodeModuleCache) throw Object.assign(new Error("node:sqlite unavailable"), { code: "ERR_UNKNOWN_BUILTIN_MODULE" });
  }
  return nodeModuleCache;
}

function queryWithSqliteCli(sql, params) {
  if (!fs.existsSync(STATE_DB_PATH)) throw new Error(`state.db not found at ${STATE_DB_PATH}`);
  // The sqlite3 CLI has no bind parameters; inline them as SQL string literals.
  let i = 0;
  const inlined = sql.replace(/\?/g, () => `'${String(params[i++] ?? "").replace(/'/g, "''")}'`);
  const out = execFileSync("sqlite3", ["-readonly", "-json", STATE_DB_PATH, inlined], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.trim() ? JSON.parse(out) : [];
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function formatTranscript(parsed, projectName = projectNameFromCwd(parsed.cwd)) {
  const header = [
    "Hermes Agent Session Transcript",
    `Project: ${projectName || "unknown"}`,
    `Session: ${parsed.sessionId || "unknown"}`,
    `Source: hermes:${parsed.source || "unknown"}`,
    parsed.profile && parsed.profile !== "default" ? `Profile: ${parsed.profile}` : null,
    parsed.title ? `Title: ${escapeThoughtContent(parsed.title)}` : null,
    parsed.gitBranch ? `Branch: ${parsed.gitBranch}` : null,
    `Date: ${parsed.startedAt || new Date().toISOString()}`,
    parsed.endedAt ? `Ended: ${parsed.endedAt}${parsed.endReason ? ` (${parsed.endReason})` : ""}` : null,
    `Turns: ${parsed.userTurns || 0}`,
    "---",
  ].filter(Boolean).join("\n");

  let body = parsed.turns
    .filter((turn) => turn.content && turn.content.trim())
    .map((turn) => {
      const label = turn.phase ? `${turn.role}:${turn.phase}` : turn.role;
      return `[${label}]\n${escapeThoughtContent(turn.content)}`;
    })
    .join("\n\n");

  // Keep the whole payload under the embedding token limit. Preserve the start
  // and end of the session (how it opened and concluded) and drop the middle.
  const budget = MAX_INGEST_CHARS - header.length - 40; // 40 ≈ wrapper tags/newlines
  body = truncateMiddle(body, budget);

  return `${header}\n\n<thought_content>\n${body}\n</thought_content>`;
}

function truncateMiddle(text, budget) {
  if (!Number.isFinite(budget) || budget <= 0 || text.length <= budget) return text;
  const marker = "\n\n[... transcript truncated to fit capture size limit ...]\n\n";
  const keep = budget - marker.length;
  if (keep <= 0) return text.slice(0, budget);
  const headLen = Math.floor(keep * 0.6);
  const tailLen = keep - headLen;
  return text.slice(0, headLen) + marker + text.slice(text.length - tailLen);
}

// Neutralize literal delimiter tags inside transcript content so a transcript
// cannot break out of the wrapper and smuggle instructions downstream.
function escapeThoughtContent(text) {
  return String(text)
    .replace(/<thought_content>/gi, "<thought_content_escaped>")
    .replace(/<\/thought_content>/gi, "</thought_content_escaped>");
}

function buildImportKey(sessionId, formattedText) {
  const hash = crypto.createHash("sha256").update(formattedText).digest("hex").slice(0, 8);
  return `hermes:${sessionId}:${hash}`;
}

// ── Ingest + retry queue ────────────────────────────────────────────────────

async function postIngest(ingestUrl, mcpKey, payload) {
  const response = await fetchWithTimeout(ingestUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-brain-key": mcpKey },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}:${JSON.stringify(data).slice(0, 200)}`);
    error.permanent = !isRetryableStatus(response.status);
    throw error;
  }
  return data;
}

function isRetryableStatus(status) {
  return status >= 500 || status === 429;
}

async function processRetryQueue(ingestUrl, mcpKey) {
  ensureDirs();
  let files;
  try {
    files = fs.readdirSync(RETRY_QUEUE_DIR).filter((file) => file.endsWith(".json")).sort().slice(0, RETRY_BATCH_SIZE);
  } catch {
    return;
  }
  for (const file of files) {
    const filePath = path.join(RETRY_QUEUE_DIR, file);
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      fs.renameSync(filePath, path.join(RETRY_DEAD_DIR, file));
      continue;
    }
    try {
      await postIngest(ingestUrl, mcpKey, entry.payload);
      fs.unlinkSync(filePath);
    } catch (error) {
      entry.attempt_count = Number(entry.attempt_count || 0) + 1;
      entry.error = messageOf(error);
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
      if (error?.permanent || entry.attempt_count >= RETRY_MAX_ATTEMPTS) {
        fs.renameSync(filePath, path.join(RETRY_DEAD_DIR, file));
      }
    }
  }
}

function saveToRetryQueue(payload, error, sessionId) {
  try {
    ensureDirs();
    const entry = {
      payload,
      failed_at: new Date().toISOString(),
      error: messageOf(error),
      attempt_count: 1,
    };
    fs.writeFileSync(path.join(RETRY_QUEUE_DIR, `${Date.now()}-${safeName(sessionId || "unknown")}.json`), JSON.stringify(entry, null, 2));
  } catch (err) {
    console.error(`[retry-queue] Failed to save: ${messageOf(err)}`);
  }
}

async function fetchWithTimeout(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Local state, env, logging ───────────────────────────────────────────────

async function readStdinJson() {
  if (process.stdin.isTTY) {
    console.error("Usage: capture-hermes-session.mjs [--dry-run] (--latest | --session <id>)  — or pipe a Hermes hook payload on stdin");
    return {};
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    appendLog("unknown", "unknown", 0, `error:stdin_parse:${messageOf(error)}`);
    return {};
  }
}

// Hermes reads stdout as an optional JSON directive; `{}` is the documented no-op.
function emitHookNoop() {
  if (!DRY_RUN && !process.stdin.isTTY) process.stdout.write("{}\n");
}

function loadEnv() {
  try {
    const vars = {};
    for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (match) vars[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
    return vars;
  } catch {
    return {};
  }
}

function appendLog(sessionId, projectName, turns, disposition) {
  try {
    ensureDirs();
    const line = `${new Date().toISOString()} session=${sessionId || "unknown"} project=${projectName || "unknown"} turns=${turns || 0} disposition=${disposition}\n`;
    fs.appendFileSync(LOG_PATH, line);
  } catch {
    // log failure is not fatal
  }
}

function readSessionState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(statePath(sessionId), "utf8"));
  } catch {
    return null;
  }
}

function writeSessionState(sessionId, state) {
  if (DRY_RUN) return;
  ensureDirs();
  fs.writeFileSync(statePath(sessionId), JSON.stringify(state, null, 2));
}

function statePath(sessionId) {
  return path.join(STATE_DIR, `${safeName(sessionId)}.json`);
}

function ensureDirs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(RETRY_QUEUE_DIR, { recursive: true });
  fs.mkdirSync(RETRY_DEAD_DIR, { recursive: true });
}

// ── Small helpers ───────────────────────────────────────────────────────────

function flagValue(name) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : "";
}

function toIso(epochSeconds) {
  const n = Number(epochSeconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : "";
}

function projectNameFromCwd(cwd) {
  return cwd ? path.basename(cwd) : "unknown";
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Entry point (last, so every module-level const above is initialized) ────

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  setTimeout(() => {
    appendLog("unknown", "unknown", 0, "hard_timeout");
    process.exit(0);
  }, HARD_TIMEOUT_MS).unref();

  main().catch((error) => {
    appendLog("unknown", "unknown", 0, `error:main:${messageOf(error)}`);
    process.exit(0);
  });
}
