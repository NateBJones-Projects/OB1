#!/usr/bin/env node
/**
 * Open Brain — Grok SessionEnd Capture Hook
 *
 * Grok adapter for the auto-capture-claude-code skill. Reads Grok's
 * chat_history.jsonl at session end and POSTs formatted transcripts to the
 * Open Brain REST ingest endpoint.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { fileURLToPath } from "node:url";

const HARD_TIMEOUT_MS = 25000;
const MIN_USER_TURNS = 3;
// Cap the ingest payload under the embedding model's ~8191-token limit
// (text-embedding-3-small). Long sessions otherwise make /ingest return HTTP 500.
const MAX_INGEST_CHARS = Number(process.env.OB_CAPTURE_MAX_CHARS) || 24000;
const RETRY_MAX_ATTEMPTS = 5;
const RETRY_BATCH_SIZE = 3;
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 10000;

const GROK_HOME = process.env.GROK_HOME || path.join(os.homedir(), ".grok");
const LOG_DIR = path.join(GROK_HOME, "logs");
const LOG_PATH = path.join(LOG_DIR, "ambient-capture-grok.log");
const RETRY_QUEUE_DIR = path.join(GROK_HOME, "data", "capture-retry-queue");
const RETRY_DEAD_DIR = path.join(RETRY_QUEUE_DIR, "dead");

setTimeout(() => {
  appendLog("unknown", "unknown", 0, "hard_timeout_25s");
  process.exit(0);
}, HARD_TIMEOUT_MS);

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

function appendLog(sessionId, projectName, turns, disposition) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const line = `${new Date().toISOString()} session=${sessionId} project=${projectName} turns=${turns} disposition=${disposition}\n`;
    fs.appendFileSync(LOG_PATH, line);
  } catch {
    // non-fatal
  }
}

function encodeCwd(cwd) {
  return encodeURIComponent(cwd);
}

function findChatHistoryPath(sessionId, cwd) {
  if (!sessionId) return null;

  const candidates = [];
  if (cwd) {
    candidates.push(
      path.join(GROK_HOME, "sessions", encodeCwd(cwd), sessionId, "chat_history.jsonl")
    );
  }

  const sessionsRoot = path.join(GROK_HOME, "sessions");
  try {
    for (const group of fs.readdirSync(sessionsRoot)) {
      const candidate = path.join(sessionsRoot, group, sessionId, "chat_history.jsonl");
      candidates.push(candidate);
    }
  } catch {
    // ignore
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function extractGrokUserText(msg) {
  const parts = Array.isArray(msg.content) ? msg.content : [];
  const text = parts
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();

  if (!text) return null;

  const queryMatch = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  if (queryMatch) return queryMatch[1].trim() || null;

  if (text.includes("<user_info>") || text.includes("<git_status>")) return null;
  if (text.startsWith("<system-reminder>")) return null;

  return text;
}

function parseGrokChatHistory(chatHistoryPath, sessionId) {
  const raw = fs.readFileSync(chatHistoryPath, "utf8");
  const turns = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    if (msg.type === "user") {
      const text = extractGrokUserText(msg);
      if (text) turns.push({ role: "human", content: text });
    } else if (msg.type === "assistant") {
      const content = typeof msg.content === "string" ? msg.content.trim() : "";
      if (content) turns.push({ role: "assistant", content });
    }
  }

  const userTurns = turns.filter((t) => t.role === "human").length;
  return { sessionId: sessionId || "unknown", turns, userTurns };
}

function escapeThoughtContent(text) {
  return text
    .replace(/<thought_content>/gi, "<thought_content_escaped>")
    .replace(/<\/thought_content>/gi, "</thought_content_escaped>");
}

function formatTranscript(parsed, projectName) {
  const header = [
    "Grok Session Transcript",
    `Project: ${projectName}`,
    `Date: ${new Date().toISOString()}`,
    `Turns: ${parsed.userTurns}`,
    "---",
  ].join("\n");

  let body = parsed.turns
    .map((t) => `[${t.role}]\n${escapeThoughtContent(t.content)}`)
    .join("\n\n");

  // Keep the payload under the embedding token limit: preserve the start and
  // end of the session, drop the middle.
  body = truncateMiddle(body, MAX_INGEST_CHARS - header.length - 40);

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

function buildImportKey(sessionId, formattedText) {
  const hash = crypto.createHash("sha256").update(formattedText).digest("hex").slice(0, 8);
  return `grok:${sessionId}:${hash}`;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isRetryableStatus(status) {
  return status >= 500 || status === 429;
}

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
    files = fs.readdirSync(RETRY_QUEUE_DIR).filter((f) => f.endsWith(".json"));
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
          ...(entry.import_key ? { import_key: entry.import_key } : {}),
        }),
      });

      if (response.ok) {
        fs.unlinkSync(filePath);
      } else if (isRetryableStatus(response.status)) {
        throw new Error(`HTTP ${response.status}`);
      } else {
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

function resolveEnv(cwd) {
  const envPaths = [
    path.join(GROK_HOME, ".env.local"),
    cwd ? path.join(cwd, ".env.local") : null,
  ].filter(Boolean);

  let merged = {};
  for (const envPath of envPaths) {
    merged = { ...merged, ...loadEnv(envPath) };
  }

  return {
    supabaseUrl: merged.SUPABASE_URL || process.env.SUPABASE_URL,
    mcpKey: merged.MCP_ACCESS_KEY || process.env.MCP_ACCESS_KEY,
  };
}

async function main() {
  let input;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (err) {
    appendLog("unknown", "unknown", 0, `error:stdin_parse:${err.message}`);
    process.exit(0);
  }

  const sessionId =
    input.sessionId || input.session_id || process.env.GROK_SESSION_ID || "unknown";
  const cwd =
    input.cwd || input.workspaceRoot || process.env.GROK_WORKSPACE_ROOT || process.env.CLAUDE_PROJECT_DIR || "";
  const reason = input.reason || input.sessionEndReason || "";
  const projectName = cwd ? path.basename(cwd) : "unknown";

  if (reason === "clear" || reason === "resume") {
    appendLog(sessionId, projectName, 0, `skipped:reason_${reason}`);
    process.exit(0);
  }

  const chatHistoryPath = findChatHistoryPath(sessionId, cwd);
  if (!chatHistoryPath) {
    appendLog(sessionId, projectName, 0, "skipped:no_chat_history");
    process.exit(0);
  }

  let parsed;
  try {
    parsed = parseGrokChatHistory(chatHistoryPath, sessionId);
  } catch (err) {
    appendLog(sessionId, projectName, 0, `error:parse:${err.message}`);
    process.exit(0);
  }

  if (parsed.userTurns < MIN_USER_TURNS) {
    appendLog(parsed.sessionId, projectName, parsed.userTurns, "skipped:too_short");
    process.exit(0);
  }

  const formattedText = formatTranscript(parsed, projectName);
  const importKey = buildImportKey(parsed.sessionId, formattedText);

  const { supabaseUrl, mcpKey } = resolveEnv(cwd);
  if (!supabaseUrl || !mcpKey) {
    appendLog(parsed.sessionId, projectName, parsed.userTurns, "error:missing_env");
    process.exit(0);
  }

  const ingestUrl = `${supabaseUrl}/functions/v1/open-brain-rest/ingest`;
  await processRetryQueue(ingestUrl, mcpKey);

  const payload = {
    text: formattedText,
    source_label: `grok:${projectName}`,
    source_type: "grok_ambient",
    auto_execute: true,
    import_key: importKey,
  };

  try {
    const response = await fetchWithTimeout(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-brain-key": mcpKey },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const result = await response.json().catch(() => ({}));
      appendLog(
        parsed.sessionId,
        projectName,
        parsed.userTurns,
        `captured:job_${result?.job_id ?? "unknown"}`
      );
    } else if (isRetryableStatus(response.status)) {
      const body = await response.text().catch(() => "");
      appendLog(
        parsed.sessionId,
        projectName,
        parsed.userTurns,
        `error:http_${response.status}:${body.slice(0, 100)}`
      );
      saveToRetryQueue(payload, `HTTP ${response.status}`, parsed.sessionId);
    } else {
      const body = await response.text().catch(() => "");
      appendLog(
        parsed.sessionId,
        projectName,
        parsed.userTurns,
        `error:http_${response.status}:permanent:${body.slice(0, 100)}`
      );
    }
  } catch (err) {
    const isAbort = err?.name === "AbortError";
    const disposition = isAbort
      ? `error:fetch:timeout_${FETCH_TIMEOUT_MS}ms`
      : `error:fetch:${err.message}`;
    appendLog(parsed.sessionId, projectName, parsed.userTurns, disposition);
    saveToRetryQueue(
      payload,
      isAbort ? `timeout ${FETCH_TIMEOUT_MS}ms` : err.message,
      parsed.sessionId
    );
  }

  process.exit(0);
}

main().catch((err) => {
  appendLog("unknown", "unknown", 0, `error:main:${err.message}`);
  process.exit(0);
});