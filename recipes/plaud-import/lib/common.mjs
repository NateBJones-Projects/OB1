/**
 * common.mjs — shared helpers for the plaud-import recipe.
 *
 * Zero dependencies: Node 18+ built-ins only (fetch, node:crypto, node:fs).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ── Env loading ──────────────────────────────────────────────────────────────

/**
 * Load `.env.local` from `dir` and layer it OVER process.env.
 *
 * The file wins on purpose: these scripts are run by hand against one brain at
 * a time, and a stale exported shell variable silently writing into the wrong
 * Supabase project is the failure mode we care about most.
 *
 * @param {string} dir directory holding `.env.local`
 * @returns {Record<string,string>} merged environment (not written to process.env)
 */
export function loadEnv(dir) {
  const merged = { ...process.env };
  const envPath = path.join(dir, ".env.local");
  if (!fs.existsSync(envPath)) return merged;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    merged[key] = value; // file wins over process.env
  }
  return merged;
}

// ── Arg parsing ──────────────────────────────────────────────────────────────

/**
 * Minimal argv parser.
 *
 * @param {string[]} argv raw args (already sliced past node + script)
 * @param {{booleans?: string[], values?: string[], optionalValues?: string[]}} spec
 * @returns {{flags: Record<string, string|boolean>, positional: string[], unknown: string[]}}
 */
export function parseArgs(argv, spec = {}) {
  const booleans = new Set(spec.booleans || []);
  const values = new Set(spec.values || []);
  const optionalValues = new Set(spec.optionalValues || []);
  const flags = {};
  const positional = [];
  const unknown = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    let name = arg.slice(2);
    let inlineValue = null;
    const eq = name.indexOf("=");
    if (eq >= 0) {
      inlineValue = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (booleans.has(name)) {
      flags[name] = inlineValue === null ? true : inlineValue !== "false";
    } else if (values.has(name)) {
      if (inlineValue !== null) flags[name] = inlineValue;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[name] = argv[++i];
      else throw new Error(`--${name} requires a value`);
    } else if (optionalValues.has(name)) {
      if (inlineValue !== null) flags[name] = inlineValue;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[name] = argv[++i];
      else flags[name] = true;
    } else {
      unknown.push(arg);
    }
  }
  return { flags, positional, unknown };
}

export function intFlag(flags, name, fallback) {
  if (flags[name] === undefined) return fallback;
  const n = Number.parseInt(String(flags[name]), 10);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be an integer, got "${flags[name]}"`);
  return n;
}

// ── Hashing ──────────────────────────────────────────────────────────────────

export function sha256Hex(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

/**
 * content_fingerprint, computed client-side.
 *
 * Normalization: lowercase -> collapse all whitespace runs to one space -> trim
 * -> sha256 hex. This is byte-identical to OB1's `set_content_fingerprint()`
 * trigger (`lower(trim(regexp_replace(content,'\s+',' ','g')))`), so a brain
 * that has the trigger and a brain that does not end up with the same value.
 *
 * We always send it: not every Open Brain has the trigger installed, and a NULL
 * fingerprint slips past the UNIQUE partial index silently — dedup would appear
 * to work while inserting duplicates forever.
 */
export function contentFingerprint(text) {
  const normalized = String(text).toLowerCase().replace(/\s+/g, " ").trim();
  return sha256Hex(normalized);
}

// ── Timing ───────────────────────────────────────────────────────────────────

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry helper with exponential backoff. `shouldRetry(err|res)` decides.
 */
export async function withBackoff(fn, { retries = 3, baseMs = 1000, onRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (err && err.noRetry) throw err;
      if (attempt === retries) break;
      const wait = baseMs * 2 ** attempt;
      if (onRetry) onRetry(err, attempt + 1, wait);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// ── Secret scanning (ported from recipes/obsidian-vault-import) ──────────────

export const SECRET_PATTERNS = [
  ["OpenAI/OpenRouter API key", /sk-(?:or-v1-|proj-|live-)?[a-zA-Z0-9]{20,}/],
  ["JWT token", /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/],
  ["GitHub token", /gh[ps]_[a-zA-Z0-9]{36,}/],
  ["GitHub OAuth token", /gho_[a-zA-Z0-9]{36,}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["Supabase key", /sbp_[a-zA-Z0-9]{20,}/],
  ["Private key block", /-----BEGIN [A-Z ]+ PRIVATE KEY-----/],
  [
    "Generic secret assignment",
    /(?:password|secret|token|api_key|apikey|api_secret|access_token|auth_token)\s*[=:]\s*["']?[a-zA-Z0-9_\-/.]{16,}/i,
  ],
  ["Connection string with credentials", /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@/i],
];

/** @returns {string|null} label of the first secret pattern found */
export function scanForSecrets(text) {
  for (const [label, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

export function isoOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  // epoch millis (number or numeric string)
  if (typeof value === "number" || /^\d{10,16}$/.test(String(value))) {
    let n = Number(value);
    if (n < 1e12) n *= 1000; // seconds -> millis
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Run `tasks` with at most `limit` in flight. Preserves input order in results. */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
