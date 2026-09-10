#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const CAPTURE_ROOT = process.env.OB_CAPTURE_ROOT
  ? path.resolve(process.env.OB_CAPTURE_ROOT)
  : SCRIPT_DIR;

const ENV_PATH = path.join(CAPTURE_ROOT, ".env.local");
const LOG_DIR = path.join(CAPTURE_ROOT, "logs");
const LOG_PATH = path.join(LOG_DIR, "ambient-capture.log");
const STATE_DIR = path.join(CAPTURE_ROOT, "state", "sessions");
const RETRY_QUEUE_DIR = path.join(CAPTURE_ROOT, "data", "capture-retry-queue");
const RETRY_DEAD_DIR = path.join(RETRY_QUEUE_DIR, "dead");

const MIN_USER_TURNS = Number(process.env.OB_CAPTURE_MIN_USER_TURNS || 3);
// The ingest endpoint embeds the text with text-embedding-3-small (~8191 token
// limit). Long sessions exceed it and the endpoint returns HTTP 500. Cap the
// payload well under the limit (~24k chars ≈ ~6k tokens) with margin for the
// denser token ratio of code/JSON transcripts.
const MAX_INGEST_CHARS = Number(process.env.OB_CAPTURE_MAX_CHARS || 24000);
const DEFAULT_DEBOUNCE_MS = 120000;
const DEBOUNCE_MS = Number(process.env.OB_CAPTURE_DEBOUNCE_MS ?? DEFAULT_DEBOUNCE_MS);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 10000);
const HARD_TIMEOUT_MS = Number(process.env.OB_CAPTURE_HARD_TIMEOUT_MS || 25000);

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

export function parseCodexRollout(transcriptPath) {
  const raw = fs.readFileSync(transcriptPath, "utf8");
  const turns = [];
  let sessionMeta = {};

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record.type === "session_meta") {
      sessionMeta = record.payload || {};
      continue;
    }

    if (record.type !== "event_msg") continue;
    const payload = record.payload || {};

    if (payload.type === "user_message" && payload.message) {
      turns.push({
        role: "user",
        content: String(payload.message),
        timestamp: record.timestamp || "",
      });
    }

    if (payload.type === "agent_message" && payload.message) {
      turns.push({
        role: "assistant",
        phase: payload.phase || "",
        content: String(payload.message),
        timestamp: record.timestamp || "",
      });
    }
  }

  const sessionId = String(sessionMeta.session_id || sessionMeta.id || "unknown");
  const cwd = String(sessionMeta.cwd || "");
  const createdAt = String(sessionMeta.timestamp || "");
  const userTurns = turns.filter((turn) => turn.role === "user").length;

  return {
    sourceType: "codex_rollout",
    transcriptPath,
    sessionId,
    cwd,
    createdAt,
    model: sessionMeta.model || "",
    cliVersion: sessionMeta.cli_version || "",
    turns,
    userTurns,
  };
}

export function formatTranscript(parsed, projectName = projectNameFromCwd(parsed.cwd)) {
  const header = [
    "Codex Session Transcript",
    `Project: ${projectName || "unknown"}`,
    `Session: ${parsed.sessionId || "unknown"}`,
    `Source: codex_rollout`,
    `Date: ${parsed.createdAt || new Date().toISOString()}`,
    `Turns: ${parsed.userTurns || 0}`,
    "---",
  ].join("\n");

  let body = parsed.turns
    .filter((turn) => turn.content && turn.content.trim())
    .map((turn) => {
      const label = turn.phase && turn.role === "assistant"
        ? `${turn.role}:${turn.phase}`
        : turn.role;
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

async function main() {
  if (process.argv[2] === "--deferred") {
    await runDeferred(process.argv[3], process.argv[4]);
    return;
  }

  const input = await readStdinJson();
  if (input.hook_event_name && input.hook_event_name !== "Stop") {
    appendLog(input.session_id || "unknown", projectNameFromCwd(input.cwd), 0, `skipped:event_${input.hook_event_name}`);
    return;
  }

  const transcriptPath = resolveTranscriptPath(input);
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    appendLog(input.session_id || "unknown", projectNameFromCwd(input.cwd), 0, "skipped:no_transcript");
    return;
  }

  const parsed = parseCodexRollout(transcriptPath);
  const sessionId = input.session_id || parsed.sessionId;
  const turnId = input.turn_id || "unknown";
  const projectName = projectNameFromCwd(input.cwd || parsed.cwd);

  if (parsed.userTurns < MIN_USER_TURNS) {
    appendLog(sessionId, projectName, parsed.userTurns, "skipped:too_short");
    return;
  }

  const state = readSessionState(sessionId);
  if (state?.captured_at) {
    appendLog(sessionId, projectName, parsed.userTurns, "skipped:already_captured");
    return;
  }

  writeSessionState(sessionId, {
    session_id: sessionId,
    turn_id: turnId,
    transcript_path: transcriptPath,
    cwd: input.cwd || parsed.cwd || "",
    project_name: projectName,
    updated_at: new Date().toISOString(),
  });

  if (DEBOUNCE_MS <= 0 || process.env.OB_CAPTURE_SYNC === "1") {
    await captureIfCurrent(sessionId, turnId);
    return;
  }

  spawn(process.execPath, [SCRIPT_PATH, "--deferred", sessionId, turnId], {
    cwd: input.cwd || parsed.cwd || CAPTURE_ROOT,
    env: { ...process.env, OB_CAPTURE_ROOT: CAPTURE_ROOT },
    detached: true,
    stdio: "ignore",
  }).unref();

  appendLog(sessionId, projectName, parsed.userTurns, `scheduled:delay_${DEBOUNCE_MS}ms`);
}

async function runDeferred(sessionId, turnId) {
  if (!sessionId || !turnId) return;
  if (DEBOUNCE_MS > 0) await sleep(DEBOUNCE_MS);
  await captureIfCurrent(sessionId, turnId);
}

async function captureIfCurrent(sessionId, turnId) {
  const state = readSessionState(sessionId);
  if (!state) return;
  if (state.captured_at) {
    appendLog(sessionId, state.project_name || "unknown", 0, "skipped:already_captured");
    return;
  }
  if (state.turn_id !== turnId) {
    appendLog(sessionId, state.project_name || "unknown", 0, "skipped:superseded");
    return;
  }

  const parsed = parseCodexRollout(state.transcript_path);
  const projectName = state.project_name || projectNameFromCwd(state.cwd || parsed.cwd);

  if (parsed.userTurns < MIN_USER_TURNS) {
    appendLog(sessionId, projectName, parsed.userTurns, "skipped:too_short");
    return;
  }

  const env = loadEnv();
  const supabaseUrl = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const mcpKey = env.MCP_ACCESS_KEY || process.env.MCP_ACCESS_KEY;
  if (!supabaseUrl || !mcpKey) {
    appendLog(sessionId, projectName, parsed.userTurns, "error:missing_env");
    return;
  }

  await processRetryQueue(supabaseUrl, mcpKey);

  const payload = {
    text: formatTranscript(parsed, projectName),
    source_label: `codex:${projectName}`,
    source_type: "codex_ambient",
    auto_execute: true,
    import_key: `codex:${sessionId}`,
  };

  try {
    const result = await postIngest(supabaseUrl, mcpKey, payload);
    const thoughtId = result?.thought_id || result?.id || result?.thought?.id || "unknown";
    writeSessionState(sessionId, {
      ...state,
      captured_at: new Date().toISOString(),
      captured_turn_id: turnId,
      thought_id: thoughtId,
      user_turns: parsed.userTurns,
    });
    appendLog(sessionId, projectName, parsed.userTurns, `captured:thought_${thoughtId}`);
  } catch (error) {
    appendLog(sessionId, projectName, parsed.userTurns, `error:fetch:${messageOf(error)}`);
    saveToRetryQueue(payload, error, sessionId);
  }
}

async function postIngest(supabaseUrl, mcpKey, payload) {
  const response = await fetchWithTimeout(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/open-brain-rest/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-brain-key": mcpKey },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}:${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function processRetryQueue(supabaseUrl, mcpKey) {
  ensureDirs();
  const files = fs.readdirSync(RETRY_QUEUE_DIR).filter((file) => file.endsWith(".json")).sort().slice(0, 3);
  for (const file of files) {
    const filePath = path.join(RETRY_QUEUE_DIR, file);
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(filePath, "utf8"));
      await postIngest(supabaseUrl, mcpKey, entry.payload);
      fs.unlinkSync(filePath);
    } catch (error) {
      entry = entry || {};
      entry.attempt_count = Number(entry.attempt_count || 0) + 1;
      entry.error = messageOf(error);
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
      if (entry.attempt_count >= 5) fs.renameSync(filePath, path.join(RETRY_DEAD_DIR, file));
    }
  }
}

function saveToRetryQueue(payload, error, sessionId) {
  ensureDirs();
  const safeSid = safeName(sessionId || "unknown");
  const entry = {
    payload,
    failed_at: new Date().toISOString(),
    error: messageOf(error),
    attempt_count: 1,
  };
  fs.writeFileSync(path.join(RETRY_QUEUE_DIR, `${Date.now()}-${safeSid}.json`), JSON.stringify(entry, null, 2));
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

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const CODEX_SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");

// Resolve the rollout transcript for this Stop invocation. Codex's Stop-hook
// stdin was NOT reliably giving a usable transcript_path (observed:
// session=unknown, turns=0 while a populated rollout existed), so we resolve
// in preference order and only accept a path that parses as a real rollout:
//   1. session_id — Codex rollout filenames embed the session_id, so this is
//      the most reliable anchor and needs no file reads to match.
//   2. paths Codex passes on stdin (transcript_path, then agent_transcript_path).
//   3. newest rollout whose session_meta.cwd matches the hook's cwd.
// Falls back to the raw transcript_path so behavior never regresses.
function resolveTranscriptPath(input) {
  if (input.session_id) {
    const byId = findRolloutBySessionId(String(input.session_id));
    if (byId) return byId;
  }
  for (const key of ["transcript_path", "agent_transcript_path"]) {
    if (input[key]) {
      const candidate = path.resolve(String(input[key]));
      if (isValidRollout(candidate)) return candidate;
    }
  }
  const byCwd = newestRolloutForCwd(input.cwd);
  if (byCwd) return byCwd;
  if (input.transcript_path) return path.resolve(String(input.transcript_path));
  return "";
}

function listRolloutFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) out.push(full);
    }
  };
  walk(CODEX_SESSIONS_DIR);
  return out;
}

function findRolloutBySessionId(sessionId) {
  const matches = listRolloutFiles().filter((file) => file.includes(sessionId));
  if (!matches.length) return "";
  return matches.sort((a, b) => statMtime(b) - statMtime(a))[0];
}

function newestRolloutForCwd(cwd) {
  const withMeta = listRolloutFiles()
    .map((file) => ({ file, meta: rolloutSessionMeta(file) }))
    .filter((entry) => entry.meta);
  const matching = cwd ? withMeta.filter((entry) => entry.meta.cwd === cwd) : withMeta;
  const pool = matching.length ? matching : withMeta;
  if (!pool.length) return "";
  return pool.sort((a, b) => statMtime(b.file) - statMtime(a.file))[0].file;
}

function isValidRollout(candidate) {
  try {
    if (!fs.existsSync(candidate)) return false;
    const parsed = parseCodexRollout(candidate);
    return parsed.turns.length > 0 || parsed.sessionId !== "unknown";
  } catch {
    return false;
  }
}

// Read only the leading session_meta record without parsing the whole file.
function rolloutSessionMeta(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record.type === "session_meta") return record.payload || {};
      return null; // session_meta is always first; bail once we pass it
    }
  } catch {
    // unreadable file — ignore
  }
  return null;
}

function statMtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
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
  ensureDirs();
  const line = `${new Date().toISOString()} session=${sessionId || "unknown"} project=${projectName || "unknown"} turns=${turns || 0} disposition=${disposition}\n`;
  fs.appendFileSync(LOG_PATH, line);
}

function readSessionState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(statePath(sessionId), "utf8"));
  } catch {
    return null;
  }
}

function writeSessionState(sessionId, state) {
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

function escapeThoughtContent(text) {
  return String(text)
    .replace(/<thought_content>/gi, "<thought_content_escaped>")
    .replace(/<\/thought_content>/gi, "</thought_content_escaped>");
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
