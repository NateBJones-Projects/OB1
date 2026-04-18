#!/usr/bin/env node
/**
 * Open Brain — Claude Code Session-End Capture Hook
 *
 * Reference implementation for the auto-capture-claude-code skill.
 * Fires on every Claude Code session end, reads the transcript, filters out
 * short/agent/sensitive sessions, and POSTs the formatted transcript to the
 * Open Brain REST ingest endpoint for automatic thought extraction.
 *
 * All errors are logged and swallowed — this hook must never block
 * Claude Code shutdown.
 *
 * Prerequisites:
 *   - Node.js 18+ (for native fetch)
 *   - SUPABASE_URL and MCP_ACCESS_KEY in environment or .env.local
 *   - Open Brain REST API or smart-ingest edge function deployed
 *
 * Install in .claude/settings.json:
 *   {
 *     "hooks": {
 *       "Stop": [{
 *         "matcher": "",
 *         "hooks": [{ "type": "command", "command": "node /path/to/session-end-capture.mjs" }]
 *       }]
 *     }
 *   }
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "node:url";

// ── Configuration ───────────────────────────────────────────────────────────

const HARD_TIMEOUT_MS = 25000;
const MIN_USER_TURNS = 3;
const RETRY_MAX_ATTEMPTS = 5;
const RETRY_BATCH_SIZE = 3;
// Per-request fetch timeout. Must be less than HARD_TIMEOUT_MS so an
// abandoned fetch surfaces as AbortError and gets enqueued, rather than
// the process being killed mid-flight by the hard timeout.
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 10000;

// Paths — adapt these to your project layout.
// fileURLToPath handles Windows drive letters (any case) and non-ASCII paths
// correctly. PROJECT_ROOT defaults to two levels up from the script, but can
// be overridden with OB_PROJECT_ROOT when the script lives outside a repo.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.OB_PROJECT_ROOT
  ? path.resolve(process.env.OB_PROJECT_ROOT)
  : path.resolve(SCRIPT_DIR, "../..");
const ENV_PATH = path.join(PROJECT_ROOT, ".env.local");
const LOG_DIR = path.join(PROJECT_ROOT, "logs");
const LOG_PATH = path.join(LOG_DIR, "ambient-capture.log");
const RETRY_QUEUE_DIR = path.join(PROJECT_ROOT, "data", "capture-retry-queue");
const RETRY_DEAD_DIR = path.join(RETRY_QUEUE_DIR, "dead");

// ── Hard timeout — guarantee exit ───────────────────────────────────────────

setTimeout(() => {
  appendLog("unknown", "unknown", 0, "hard_timeout_25s");
  process.exit(0);
}, HARD_TIMEOUT_MS);

// ── Env Loading ─────────────────────────────────────────────────────────────

function loadEnv(envPath) {
  try {
    const text = fs.readFileSync(envPath, "utf8");
    const vars = {};
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (match) vars[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
    return vars;
  } catch {
    return {};
  }
}

// ── Logging ─────────────────────────────────────────────────────────────────

function appendLog(sessionId, projectName, turns, disposition) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const line = `${new Date().toISOString()} session=${sessionId} project=${projectName} turns=${turns} disposition=${disposition}\n`;
    fs.appendFileSync(LOG_PATH, line);
  } catch {
    // Log failure is not fatal
  }
}

// ── Transcript parsing (simplified) ─────────────────────────────────────────

function parseTranscript(transcriptPath) {
  const raw = fs.readFileSync(transcriptPath, "utf8");
  const lines = raw.split("\n");

  let sessionId = "unknown";
  let createdAt = "";
  let gitBranch = "";
  let cwd = "";

  const turns = [];
  let currentRole = null;
  let currentContent = [];

  for (const line of lines) {
    // Parse header lines
    if (line.startsWith("Session ID: ")) { sessionId = line.slice(12).trim(); continue; }
    if (line.startsWith("Created: ")) { createdAt = line.slice(9).trim(); continue; }
    if (line.startsWith("Branch: ")) { gitBranch = line.slice(8).trim(); continue; }
    if (line.startsWith("CWD: ")) { cwd = line.slice(5).trim(); continue; }

    // Detect role markers
    const roleMatch = line.match(/^(Human|Assistant|System):\s*(.*)/);
    if (roleMatch) {
      if (currentRole && currentContent.length > 0) {
        turns.push({ role: currentRole, content: currentContent.join("\n").trim() });
      }
      currentRole = roleMatch[1].toLowerCase();
      currentContent = roleMatch[2] ? [roleMatch[2]] : [];
    } else {
      currentContent.push(line);
    }
  }

  // Flush last turn
  if (currentRole && currentContent.length > 0) {
    turns.push({ role: currentRole, content: currentContent.join("\n").trim() });
  }

  const userTurns = turns.filter(t => t.role === "human").length;

  return { sessionId, createdAt, gitBranch, cwd, turns, userTurns };
}

// Neutralize literal occurrences of the delimiter tags inside user content
// so a transcript can't break out of the wrapper and smuggle instructions
// to downstream LLM processing of the ingest payload.
function escapeThoughtContent(text) {
  return text
    .replace(/<thought_content>/gi, "<thought_content_escaped>")
    .replace(/<\/thought_content>/gi, "</thought_content_escaped>");
}

function formatTranscript(parsed, projectName) {
  const header = [
    `Claude Code Session Transcript`,
    `Project: ${projectName}`,
    `Branch: ${parsed.gitBranch || "unknown"}`,
    `Date: ${parsed.createdAt || new Date().toISOString()}`,
    `Turns: ${parsed.userTurns}`,
    "---",
  ].join("\n");

  const body = parsed.turns
    .filter(t => t.content.trim())
    .map(t => `[${t.role}]\n${escapeThoughtContent(t.content)}`)
    .join("\n\n");

  return `${header}\n\n<thought_content>\n${body}\n</thought_content>`;
}

function buildSessionSummary(parsed, projectName) {
  const topics = new Set();
  for (const t of parsed.turns) {
    if (t.role === "human") {
      // Extract potential topic keywords from user messages
      const words = t.content.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      for (const w of words.slice(0, 5)) topics.add(w);
    }
  }

  return [
    `Claude Code session on ${projectName}`,
    `(${parsed.gitBranch || "unknown branch"}, ${parsed.userTurns} turns).`,
    parsed.createdAt ? `Started: ${parsed.createdAt}.` : "",
  ].filter(Boolean).join(" ");
}

// ── Import key (idempotency) ────────────────────────────────────────────────

function buildImportKey(sessionId, formattedText) {
  const hash = crypto.createHash("sha256").update(formattedText).digest("hex").slice(0, 8);
  return `cc:${sessionId}:${hash}`;
}

// ── Fetch with timeout ──────────────────────────────────────────────────────

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// HTTP status codes worth retrying. 4xx responses (bad auth, bad payload,
// not found, etc.) are permanent client errors — retrying wastes API calls
// and can mask real problems like a revoked MCP_ACCESS_KEY.
function isRetryableStatus(status) {
  return status >= 500 || status === 429;
}

// ── Retry Queue ─────────────────────────────────────────────────────────────

function ensureRetryDirs() {
  fs.mkdirSync(RETRY_QUEUE_DIR, { recursive: true });
  fs.mkdirSync(RETRY_DEAD_DIR, { recursive: true });
}

function saveToRetryQueue(payload, error, sessionId) {
  try {
    ensureRetryDirs();
    const safeSid = (sessionId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `${Date.now()}-${safeSid}.json`;
    const entry = {
      ...payload,
      failed_at: new Date().toISOString(),
      error: String(error),
      attempt_count: 1,
    };
    fs.writeFileSync(path.join(RETRY_QUEUE_DIR, filename), JSON.stringify(entry, null, 2));
  } catch (err) {
    console.error(`[retry-queue] Failed to save: ${err.message}`);
  }
}

async function processRetryQueue(ingestUrl, mcpKey) {
  let files;
  try {
    ensureRetryDirs();
    files = fs.readdirSync(RETRY_QUEUE_DIR).filter(f => f.endsWith(".json"));
  } catch {
    return;
  }

  if (files.length === 0) return;

  files.sort();
  const batch = files.slice(0, RETRY_BATCH_SIZE);

  for (const file of batch) {
    const filePath = path.join(RETRY_QUEUE_DIR, file);
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      fs.renameSync(filePath, path.join(RETRY_DEAD_DIR, file));
      continue;
    }

    try {
      const response = await fetchWithTimeout(ingestUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-brain-key": mcpKey },
        body: JSON.stringify({
          text: entry.text,
          source_label: entry.source_label,
          source_type: entry.source_type,
          auto_execute: entry.auto_execute ?? true,
        }),
      });

      if (response.ok) {
        fs.unlinkSync(filePath);
      } else if (isRetryableStatus(response.status)) {
        throw new Error(`HTTP ${response.status}`);
      } else {
        // 4xx = permanent. Move to dead/ without burning remaining attempts.
        entry.attempt_count = (entry.attempt_count || 1) + 1;
        entry.error = `HTTP ${response.status} (permanent)`;
        fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
        fs.renameSync(filePath, path.join(RETRY_DEAD_DIR, file));
      }
    } catch (err) {
      entry.attempt_count = (entry.attempt_count || 1) + 1;
      entry.error = String(err);

      if (entry.attempt_count >= RETRY_MAX_ATTEMPTS) {
        fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
        fs.renameSync(filePath, path.join(RETRY_DEAD_DIR, file));
      } else {
        fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
      }
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Read stdin JSON from Claude Code hook
  let input;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (err) {
    appendLog("unknown", "unknown", 0, `error:stdin_parse:${err.message}`);
    process.exit(0);
  }

  const { transcript_path, session_id, cwd, reason } = input;
  const projectName = cwd ? path.basename(cwd) : "unknown";

  // 2. Skip non-terminal session ends
  if (reason === "clear" || reason === "resume") {
    appendLog(session_id || "unknown", projectName, 0, `skipped:reason_${reason}`);
    process.exit(0);
  }

  // 3. Validate transcript path
  if (!transcript_path || !fs.existsSync(transcript_path)) {
    appendLog(session_id || "unknown", projectName, 0, "skipped:no_transcript");
    process.exit(0);
  }

  // 4. Parse transcript
  let parsed;
  try {
    parsed = parseTranscript(transcript_path);
  } catch (err) {
    appendLog(session_id || "unknown", projectName, 0, `error:parse:${err.message}`);
    process.exit(0);
  }

  // 5. Skip short sessions
  if (parsed.userTurns < MIN_USER_TURNS) {
    appendLog(parsed.sessionId, projectName, parsed.userTurns, "skipped:too_short");
    process.exit(0);
  }

  // 6. Format transcript and build summary
  const formattedText = formatTranscript(parsed, projectName);
  const sessionSummary = buildSessionSummary(parsed, projectName);
  const importKey = buildImportKey(parsed.sessionId, formattedText);

  // 7. Load env and POST to ingest endpoint
  const env = loadEnv(ENV_PATH);
  const supabaseUrl = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const mcpKey = env.MCP_ACCESS_KEY || process.env.MCP_ACCESS_KEY;

  if (!supabaseUrl || !mcpKey) {
    appendLog(parsed.sessionId, projectName, parsed.userTurns, "error:missing_env");
    process.exit(0);
  }

  const ingestUrl = `${supabaseUrl}/functions/v1/open-brain-rest/ingest`;

  // 7a. Process pending retries
  await processRetryQueue(ingestUrl, mcpKey);

  // 7b. POST the current session
  const payload = {
    text: formattedText,
    source_label: `claude_code:${projectName}`,
    source_type: "claude_code_ambient",
    auto_execute: true,
  };

  try {
    const response = await fetchWithTimeout(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-brain-key": mcpKey },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const result = await response.json().catch(() => ({}));
      appendLog(parsed.sessionId, projectName, parsed.userTurns,
        `captured:job_${result?.job_id ?? "unknown"}`);
    } else if (isRetryableStatus(response.status)) {
      const body = await response.text().catch(() => "");
      appendLog(parsed.sessionId, projectName, parsed.userTurns,
        `error:http_${response.status}:${body.slice(0, 100)}`);
      saveToRetryQueue(payload, `HTTP ${response.status}`, parsed.sessionId);
    } else {
      // 4xx = permanent client error. Do not retry — log and drop.
      const body = await response.text().catch(() => "");
      appendLog(parsed.sessionId, projectName, parsed.userTurns,
        `error:http_${response.status}:permanent:${body.slice(0, 100)}`);
    }
  } catch (err) {
    const isAbort = err?.name === "AbortError";
    const disposition = isAbort
      ? `error:fetch:timeout_${FETCH_TIMEOUT_MS}ms`
      : `error:fetch:${err.message}`;
    appendLog(parsed.sessionId, projectName, parsed.userTurns, disposition);
    saveToRetryQueue(payload, isAbort ? `timeout ${FETCH_TIMEOUT_MS}ms` : err.message, parsed.sessionId);
  }

  process.exit(0);
}

main().catch((err) => {
  appendLog("unknown", "unknown", 0, `error:main:${err.message}`);
  process.exit(0);
});
