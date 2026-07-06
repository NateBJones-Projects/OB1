#!/usr/bin/env node
// Gmail smart pull — sensitivity routing + relationship tier + contact entities.
//
// Fetches emails from Gmail, cleans them, groups into threads, and emits a pack
// file that a downstream importer can ingest through Open Brain's canonical
// pipeline (fingerprint dedup → sensitivity gate → enrichment → upsert).
//
// What makes this "smart":
//   - Local sensitivity detection routes content to the right tier before
//     anything leaves the machine (see detectSensitivity below).
//   - Engagement filter: only ingest threads where the user has replied at
//     least once. Override labels (STARRED, IMPORTANT) bypass the filter.
//   - Relationship tier: tag each atom with contact / known / unknown as
//     metadata (does not gate routing, per design).
//   - Atomization: long messages (>= --atomize-min-words) get split by the
//     LLM into multiple atomic thoughts. Short messages stay whole.
//   - RFC 2822 headers captured so replies_to edges can be built offline.
//   - Structured correspondents (From/To/Cc → { name, email }) parsed once at
//     pull time, so downstream entity resolution never re-splits headers.
//
// Output shape:
//   - One atomic thought per email message (or N atoms for atomized messages)
//   - No wiki synthesis in this script — run that separately after atoms land
//
// Usage:
//   node pull-gmail.mjs --list-labels
//   node pull-gmail.mjs --labels=STARRED --window=7d --limit=5 --dry-run
//   node pull-gmail.mjs --labels=STARRED --window=7d --limit=5
//
// Environment variables (see README):
//   GMAIL_OAUTH_CLIENT_ID        Google OAuth 2.0 Desktop-app client id
//   GMAIL_OAUTH_CLIENT_SECRET    Google OAuth 2.0 client secret
//   GMAIL_LOGIN_HINT             (optional) email to prefill on consent screen
//   GMAIL_TOKEN_PATH             (optional) path to token cache (default: ./pull-gmail/token.json)
//   GMAIL_CALLBACK_PORT          (optional) OAuth callback port (default: 3847)
//   OPENROUTER_API_KEY           (optional) for --atomize-provider=openrouter
//   ANTHROPIC_API_KEY            (optional) for --atomize-provider=anthropic
//   CONTACTS_CACHE_PATH          (optional) JSON file mapping emails → contact names
//   ENGAGED_THREADS_PATH         (optional) JSON cache of engaged thread IDs
//
// No real email addresses, OAuth IDs, or service-account keys are embedded.
// Everything is injected through env vars or CLI flags.

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, chmodSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

import { atomizeText, DEFAULT_ATOMIZE_PROMPT } from "./lib/atomize-text.mjs";
import { parseRfc2822Address, normalizeEmail } from "./lib/entity-resolver.mjs";
import { detectSensitivity } from "./lib/sensitivity.mjs";

// ─── Paths (all local to this recipe folder unless overridden) ──────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPT_DIR = join(__dirname, "pull-gmail");
const DEFAULT_TOKEN_PATH = join(SCRIPT_DIR, "token.json");
const STATE_DIR = process.env.GMAIL_STATE_DIR
  ? resolve(process.env.GMAIL_STATE_DIR)
  : join(__dirname, "..", "data", "gmail-state");
const FETCHED_LOG_PATH = join(STATE_DIR, "fetched.jsonl");
const EXTRACTED_LOG_PATH = join(STATE_DIR, "extracted.jsonl");
const ERRORS_LOG_PATH = join(STATE_DIR, "errors.jsonl");
const DEFAULT_ENGAGED_THREADS_PATH = join(STATE_DIR, "engaged-threads.json");
const DEFAULT_CONTACTS_CACHE_PATH = join(__dirname, "..", "data", "contacts", "contacts.json");
const OUTPUT_DIR = process.env.GMAIL_OUTPUT_DIR
  ? resolve(process.env.GMAIL_OUTPUT_DIR)
  : join(__dirname, "..", "data", "local-export", "gmail", "runs");

const ENGAGEMENT_CACHE_TTL_DAYS = 7;
const CONTACTS_CACHE_TTL_DAYS = 7;

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
// Read-only scope is all this recipe needs. Do not widen it.
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const CALLBACK_PORT = parseInt(process.env.GMAIL_CALLBACK_PORT || "3847", 10);
const CALLBACK_URI = `http://localhost:${CALLBACK_PORT}/callback`;

const ENGAGED_THREADS_PATH = process.env.ENGAGED_THREADS_PATH
  ? resolve(process.env.ENGAGED_THREADS_PATH)
  : DEFAULT_ENGAGED_THREADS_PATH;
const CONTACTS_CACHE_PATH = process.env.CONTACTS_CACHE_PATH
  ? resolve(process.env.CONTACTS_CACHE_PATH)
  : DEFAULT_CONTACTS_CACHE_PATH;
const TOKEN_PATH = process.env.GMAIL_TOKEN_PATH
  ? resolve(process.env.GMAIL_TOKEN_PATH)
  : DEFAULT_TOKEN_PATH;

// ─── State registries (append-only JSONL) ───────────────────────────────────

function loadFetchedIds() {
  if (!existsSync(FETCHED_LOG_PATH)) return new Set();
  const ids = new Set();
  const text = readFileSync(FETCHED_LOG_PATH, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.gmail_id) ids.add(row.gmail_id);
    } catch {
      // Tolerate malformed rows.
    }
  }
  return ids;
}

function appendJsonl(path, record) {
  mkdirSync(STATE_DIR, { recursive: true });
  appendFileSync(path, JSON.stringify(record) + "\n");
}

function logFetched(record) { appendJsonl(FETCHED_LOG_PATH, record); }
function logExtracted(record) { appendJsonl(EXTRACTED_LOG_PATH, record); }
function logError(record) { appendJsonl(ERRORS_LOG_PATH, record); }

// ─── Engagement cache ───────────────────────────────────────────────────────
//
// Tracks thread IDs where the user has sent at least one message. Used as the
// first filter — unengaged threads are almost always noise (marketing, auto-
// notifications, one-way senders). Matches industry practice: mailbox
// providers use replies as the #1 engagement signal.
//
// Cache is rebuilt via one Gmail search `from:me` query (paginated via
// users.threads.list). Full-history sweep runs on first use or on
// --refresh-engagement; incremental refresh via `from:me newer_than:Nd`
// when cache is stale (>ENGAGEMENT_CACHE_TTL_DAYS old).

function loadEngagedThreadsCache() {
  if (!existsSync(ENGAGED_THREADS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(ENGAGED_THREADS_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveEngagedThreadsCache(cache) {
  mkdirSync(dirname(ENGAGED_THREADS_PATH), { recursive: true });
  writeFileSync(ENGAGED_THREADS_PATH, JSON.stringify(cache, null, 2));
}

async function sweepEngagedThreads(accessToken, extraQuery = "") {
  const q = `from:me${extraQuery ? " " + extraQuery : ""}`;
  const threadIds = new Set();
  let pageToken;
  let pages = 0;
  while (true) {
    let path = `/threads?q=${encodeURIComponent(q)}&maxResults=500`;
    if (pageToken) path += `&pageToken=${encodeURIComponent(pageToken)}`;
    const data = await gmailFetch(accessToken, path);
    pages += 1;
    if (!data.threads) break;
    for (const t of data.threads) threadIds.add(t.id);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
    if (pages % 10 === 0) {
      console.log(`   [engagement] sweep page ${pages}, ${threadIds.size} threads so far...`);
    }
  }
  return threadIds;
}

async function loadOrRefreshEngagedThreads(accessToken, args) {
  const cache = loadEngagedThreadsCache();
  const now = new Date();
  const lastFull = cache?.full_sweep_at ? new Date(cache.full_sweep_at) : null;
  const lastUpdated = cache?.last_updated ? new Date(cache.last_updated) : null;
  const staleDays = lastUpdated ? (now - lastUpdated) / 86_400_000 : Infinity;

  let engaged = new Set(cache?.thread_ids || []);
  const needsFull = !cache || args.refreshEngagement;
  const needsIncremental = !needsFull && staleDays > ENGAGEMENT_CACHE_TTL_DAYS;

  if (needsFull) {
    console.log(`[engagement] Full-history sweep from:me (first run or --refresh-engagement)...`);
    engaged = await sweepEngagedThreads(accessToken, "");
    console.log(`[engagement] Full sweep: ${engaged.size} engaged threads`);
    saveEngagedThreadsCache({
      thread_ids: [...engaged],
      last_updated: now.toISOString(),
      full_sweep_at: now.toISOString(),
      size: engaged.size,
    });
  } else if (needsIncremental) {
    const windowDays = Math.max(1, Math.ceil(staleDays) + 1);
    console.log(`[engagement] Incremental refresh: from:me newer_than:${windowDays}d (cache ${staleDays.toFixed(1)}d old)...`);
    const fresh = await sweepEngagedThreads(accessToken, `newer_than:${windowDays}d`);
    const before = engaged.size;
    for (const id of fresh) engaged.add(id);
    console.log(`[engagement] Incremental: +${engaged.size - before} new threads (total ${engaged.size})`);
    saveEngagedThreadsCache({
      thread_ids: [...engaged],
      last_updated: now.toISOString(),
      full_sweep_at: lastFull?.toISOString() || now.toISOString(),
      size: engaged.size,
    });
  } else {
    console.log(`[engagement] Cache hit: ${engaged.size} engaged threads (${staleDays.toFixed(1)}d old)`);
  }

  return engaged;
}

// ─── Contact cache + relationship tier ──────────────────────────────────────
//
// Tags each atom with relationship_tier as metadata — does NOT drive routing.
// Tiers:
//   - contact:  any party (from/to/cc) matches an email in the contacts cache
//   - known:    thread is engaged but no contact match
//   - unknown:  neither engaged nor a contact
//
// Contacts cache file format (JSON):
//   {
//     "generated_at": "2026-04-21T...Z",
//     "unique_email_addresses": 342,
//     "contacts": {
//       "alice@example.com": { "name": "Alice Smith" },
//       "bob@example.com":   { "name": "Bob Jones" }
//     }
//   }
//
// How you produce this file is out of scope for this recipe. The companion
// `schemas/crm-person-tiers` recipe (if installed) can generate it from the
// CRM person_tiers table. Otherwise you can build one by hand or with any
// contacts source — Google Contacts API, an exported vCard, etc.

function loadContactsCache() {
  if (!existsSync(CONTACTS_CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONTACTS_CACHE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function isContactsCacheStale(cache) {
  if (!cache?.generated_at) return true;
  const age = (Date.now() - new Date(cache.generated_at).getTime()) / 86_400_000;
  return age > CONTACTS_CACHE_TTL_DAYS;
}

function ensureContactsCache(args) {
  const cache = loadContactsCache();
  if (!cache) {
    if (!args.skipContactsRefresh) {
      console.warn(`[contacts] No cache at ${CONTACTS_CACHE_PATH} — relationship_tier will all be 'unknown' or 'known'. See README for how to build one.`);
    }
    return null;
  }
  if (isContactsCacheStale(cache) && !args.skipContactsRefresh) {
    console.warn(`[contacts] Cache at ${CONTACTS_CACHE_PATH} is older than ${CONTACTS_CACHE_TTL_DAYS}d. Regenerate it for fresh tiers.`);
  }
  return cache;
}

// Parse email addresses from a Gmail header value like:
//   "Alice Example <alice@example.com>"
//   "alice@example.com, Bob <bob@example.com>, charlie@example.com"
function extractAddressesFromHeader(headerValue) {
  if (!headerValue) return [];
  const out = [];
  const bracketed = [...headerValue.matchAll(/<([^>]+)>/g)].map((m) => m[1]);
  if (bracketed.length) out.push(...bracketed);
  const bare = [...headerValue.matchAll(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g)].map((m) => m[0]);
  for (const b of bare) if (!out.includes(b)) out.push(b);
  return out.map((e) => e.toLowerCase().trim());
}

function classifyRelationshipTier({ from, to, cc, threadId, contactsCache, engagedThreads }) {
  const parties = new Set();
  for (const h of [from, to, cc]) {
    for (const addr of extractAddressesFromHeader(h)) parties.add(addr);
  }
  const lookup = contactsCache?.contacts || {};
  for (const addr of parties) {
    if (lookup[addr]) return { tier: "contact", matchedEmail: addr, contactName: lookup[addr].name || null };
  }
  if (engagedThreads && engagedThreads.has(threadId)) return { tier: "known", matchedEmail: null, contactName: null };
  return { tier: "unknown", matchedEmail: null, contactName: null };
}

// ─── Hashing ────────────────────────────────────────────────────────────────

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ─── CLI argument parsing ───────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    window: "24h",
    after: "",
    before: "",
    labels: ["SENT"],
    dryRun: false,
    limit: 50,
    listLabels: false,
    atomize: true,
    atomizeMinWords: 150,
    atomizeProvider: process.env.GMAIL_ATOMIZE_PROVIDER || "anthropic",
    loginHint: process.env.GMAIL_LOGIN_HINT || "",
    includeUnengaged: false,
    refreshEngagement: false,
    overrideLabels: ["STARRED", "IMPORTANT"],
    skipContactsRefresh: false,
  };
  args.engagedOnly = !args.includeUnengaged;

  for (const a of argv.slice(2)) {
    if (a.startsWith("--window=")) args.window = a.slice("--window=".length);
    else if (a.startsWith("--after=")) args.after = a.slice("--after=".length);
    else if (a.startsWith("--before=")) args.before = a.slice("--before=".length);
    else if (a.startsWith("--labels=")) {
      args.labels = a.slice("--labels=".length).split(",").map((l) => l.trim().toUpperCase()).filter(Boolean);
    } else if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--limit=")) args.limit = parseInt(a.slice("--limit=".length), 10);
    else if (a === "--list-labels") args.listLabels = true;
    else if (a === "--no-atomize") args.atomize = false;
    else if (a.startsWith("--atomize-min-words=")) args.atomizeMinWords = parseInt(a.slice("--atomize-min-words=".length), 10) || 150;
    else if (a.startsWith("--atomize-provider=")) args.atomizeProvider = a.slice("--atomize-provider=".length);
    else if (a.startsWith("--login-hint=")) args.loginHint = a.slice("--login-hint=".length);
    else if (a === "--include-unengaged") { args.includeUnengaged = true; args.engagedOnly = false; }
    else if (a === "--engaged-only") { args.engagedOnly = true; args.includeUnengaged = false; }
    else if (a === "--refresh-engagement") args.refreshEngagement = true;
    else if (a === "--skip-contacts-refresh") args.skipContactsRefresh = true;
    else if (a.startsWith("--override-labels=")) {
      args.overrideLabels = a.slice("--override-labels=".length).split(",").map((l) => l.trim().toUpperCase()).filter(Boolean);
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node pull-gmail.mjs [options]

Options:
  --window=<24h|7d|30d|90d|1y|all>  Time window (default: 24h)
  --after=YYYY/MM/DD                Absolute start date (overrides --window)
  --before=YYYY/MM/DD               Absolute end date (combines with --after)
  --labels=LABEL1,LABEL2            Comma-separated Gmail labels (default: SENT)
  --limit=N                         Max emails to process (default: 50)
  --dry-run                         Parse and show without writing pack file
  --list-labels                     List all Gmail labels and exit
  --login-hint=EMAIL                Force consent to a specific Google account

Engagement filter:
  --engaged-only                    Only ingest threads where you've replied (DEFAULT)
  --include-unengaged               Disable engagement filter (ingest everything)
  --refresh-engagement              Force full-history re-sweep of engaged threads
  --override-labels=LABEL1,LABEL2   Labels that bypass engagement filter (default: STARRED,IMPORTANT)

Atomization:
  --no-atomize                      Skip LLM atomization entirely
  --atomize-min-words=N             Only atomize messages >= N words (default: 150)
  --atomize-provider=PROVIDER       'anthropic' | 'openrouter' | 'claude-cli' (default: anthropic)

Relationship tier (metadata only — does not gate):
  --skip-contacts-refresh           Don't warn about missing/stale contacts cache

  --help                            Show this help
`);
}

// ─── OAuth2 ─────────────────────────────────────────────────────────────────

function loadOAuthClient() {
  const id = process.env.GMAIL_OAUTH_CLIENT_ID;
  const secret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  if (!id || !secret) {
    console.error(`\nMissing Gmail OAuth credentials.\n`);
    console.error(`Set environment variables before running:`);
    console.error(`  GMAIL_OAUTH_CLIENT_ID=your-desktop-app-client-id`);
    console.error(`  GMAIL_OAUTH_CLIENT_SECRET=your-client-secret`);
    console.error(`\nTo obtain them:`);
    console.error(`  1. https://console.cloud.google.com/apis/credentials`);
    console.error(`  2. Create OAuth 2.0 Client ID, type: Desktop app`);
    console.error(`  3. Enable Gmail API: https://console.cloud.google.com/apis/library/gmail.googleapis.com`);
    console.error(`\nSee recipes/gmail-smart-pull/README.md for full setup.\n`);
    process.exit(1);
  }
  return { client_id: id, client_secret: secret };
}

function loadToken() {
  if (!existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveToken(token) {
  // Atomic write: tmp file + rename keeps token.json from ever being half-written
  // under concurrent runs or crashes. Owner-only (0o600) prevents other local
  // users/processes from reading the refresh token on POSIX. On Windows the
  // mode bit is a best-effort hint — users who need hard isolation should put
  // the token under a user-profile-restricted directory via GMAIL_TOKEN_PATH.
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  const tmp = `${TOKEN_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(token, null, 2), { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Windows non-POSIX filesystems may reject chmod — ignore silently.
  }
  renameSync(tmp, TOKEN_PATH);
}

async function refreshAccessToken(creds, token) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  // Check HTTP status before trying to parse JSON — proxy/5xx responses may
  // not be valid JSON and should surface with useful status/body context.
  if (!res.ok) {
    let body = "";
    try { body = await res.text(); } catch { /* ignore */ }
    throw new Error(`Token refresh failed: HTTP ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
  const updated = {
    access_token: data.access_token,
    refresh_token: token.refresh_token,
    token_type: data.token_type,
    expiry_date: Date.now() + data.expires_in * 1000,
  };
  saveToken(updated);
  return updated;
}

function openBrowser(url) {
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    // Fall back to printing.
  }
}

async function authorize(creds, loginHint = "") {
  let token = loadToken();
  if (token) {
    if (Date.now() < token.expiry_date - 60_000) return token.access_token;
    console.log("Access token expired, refreshing...");
    token = await refreshAccessToken(creds, token);
    return token.access_token;
  }

  // CSRF protection: generate a random state value and reject any callback
  // that doesn't echo it back. Without this, any local process (or a
  // malicious tab that can reach the loopback port) can race the real
  // browser redirect with an attacker-controlled `code` and bind the
  // script to the wrong Google account.
  const oauthState = randomBytes(16).toString("hex");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", creds.client_id);
  authUrl.searchParams.set("redirect_uri", CALLBACK_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", oauthState);
  if (loginHint) authUrl.searchParams.set("login_hint", loginHint);

  console.log("\nOpening browser for Gmail authorization...");
  console.log("If the browser doesn't open, visit:\n  " + authUrl.toString() + "\n");
  openBrowser(authUrl.toString());

  // Escape untrusted querystring values before reflecting into HTML.
  const escapeHtml = (s) => String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const code = await new Promise((resolveCode, rejectCode) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, CALLBACK_URI);
      const authCode = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");
      const err = url.searchParams.get("error");
      if (err) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<html><body><h2>Authorization failed</h2><p>${escapeHtml(err)}</p></body></html>`);
        server.close();
        rejectCode(new Error(`OAuth error: ${err}`));
        return;
      }
      if (authCode) {
        // Reject callbacks whose state doesn't match the one we generated.
        // Use a constant-time comparison? — not critical for a one-shot
        // localhost callback, but we still want a hard match.
        if (gotState !== oauthState) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Authorization failed</h2><p>Invalid state.</p></body></html>");
          setTimeout(() => server.close(), 200);
          rejectCode(new Error("OAuth error: state mismatch (possible CSRF)"));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h2>Authorization complete</h2><p>You can close this tab and return to your terminal.</p></body></html>",
        );
        setTimeout(() => server.close(), 200);
        resolveCode(authCode);
        return;
      }
      res.writeHead(400);
      res.end("Waiting for auth...");
    });
    // Bind to loopback explicitly. Default listen() on some Node/OS combos
    // binds to :: / 0.0.0.0, which would expose the callback to any
    // network peer for a few seconds. 127.0.0.1 keeps it strictly local.
    server.listen(CALLBACK_PORT, "127.0.0.1");
    server.on("error", rejectCode);
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      redirect_uri: CALLBACK_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    let body = "";
    try { body = await tokenRes.text(); } catch { /* ignore */ }
    throw new Error(`Token exchange failed: HTTP ${tokenRes.status} ${tokenRes.statusText} — ${body.slice(0, 300)}`);
  }
  const tokenData = await tokenRes.json();
  if (tokenData.error) throw new Error(`Token exchange failed: ${tokenData.error_description || tokenData.error}`);
  const newToken = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_type: tokenData.token_type,
    expiry_date: Date.now() + tokenData.expires_in * 1000,
  };
  saveToken(newToken);
  console.log("\nAuthorization successful. Token saved to " + TOKEN_PATH + "\n");
  return newToken.access_token;
}

// ─── Gmail API helpers ──────────────────────────────────────────────────────

// Retryable status codes per Google API guidance: 429 (rate limit),
// 500/502/503/504 (server errors). Other 4xx are permanent.
const GMAIL_RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const GMAIL_MAX_RETRIES = 5;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function gmailFetch(accessToken, path) {
  let lastErr;
  for (let attempt = 0; attempt <= GMAIL_MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(`${GMAIL_API}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      // Network-level failure (DNS, socket, abort). Retry with backoff.
      lastErr = err;
      if (attempt === GMAIL_MAX_RETRIES) throw new Error(`Gmail API network error after ${attempt + 1} attempts: ${err.message}`);
      const backoff = Math.min(2000 * 2 ** attempt, 30_000) + Math.floor(Math.random() * 500);
      console.warn(`   [gmail] network error on ${path}, retrying in ${backoff}ms (attempt ${attempt + 1}/${GMAIL_MAX_RETRIES})`);
      await sleep(backoff);
      continue;
    }
    if (res.ok) return res.json();
    if (!GMAIL_RETRY_STATUS.has(res.status) || attempt === GMAIL_MAX_RETRIES) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gmail API error ${res.status}: ${body.slice(0, 500)}`);
    }
    // Retryable. Respect Retry-After if present, else exponential backoff w/ jitter.
    const retryAfter = parseInt(res.headers.get("retry-after") || "0", 10);
    const backoff = retryAfter > 0
      ? Math.min(retryAfter * 1000, 60_000)
      : Math.min(2000 * 2 ** attempt, 30_000) + Math.floor(Math.random() * 500);
    console.warn(`   [gmail] ${res.status} on ${path}, retrying in ${backoff}ms (attempt ${attempt + 1}/${GMAIL_MAX_RETRIES})`);
    await sleep(backoff);
  }
  throw lastErr || new Error("Gmail API: exhausted retries");
}

async function listLabels(accessToken) {
  const data = await gmailFetch(accessToken, "/labels");
  return data.labels || [];
}

function buildDateQuery(args) {
  const parts = [];
  if (args.after) parts.push(`after:${args.after}`);
  if (args.before) parts.push(`before:${args.before}`);
  if (parts.length) return parts.join(" ");

  const now = new Date();
  let after;
  switch (args.window) {
    case "24h": after = new Date(now.getTime() - 24 * 3600 * 1000); break;
    case "7d": after = new Date(now.getTime() - 7 * 24 * 3600 * 1000); break;
    case "30d": after = new Date(now.getTime() - 30 * 24 * 3600 * 1000); break;
    case "90d": after = new Date(now.getTime() - 90 * 24 * 3600 * 1000); break;
    case "1y": after = new Date(now.getTime() - 365 * 24 * 3600 * 1000); break;
    case "all": return "";
    default:
      console.error(`Unknown window: ${args.window}. Use 24h, 7d, 30d, 90d, 1y, all, or --after=YYYY/MM/DD.`);
      process.exit(1);
  }
  const y = after.getFullYear();
  const m = String(after.getMonth() + 1).padStart(2, "0");
  const d = String(after.getDate()).padStart(2, "0");
  return `after:${y}/${m}/${d}`;
}

async function listMessagesForLabel(accessToken, label, query, limit) {
  const messages = [];
  let pageToken;
  while (messages.length < limit) {
    const maxResults = Math.min(100, limit - messages.length);
    let path = `/messages?labelIds=${encodeURIComponent(label)}&maxResults=${maxResults}`;
    if (query) path += `&q=${encodeURIComponent(query)}`;
    if (pageToken) path += `&pageToken=${encodeURIComponent(pageToken)}`;
    const data = await gmailFetch(accessToken, path);
    if (!data.messages) break;
    messages.push(...data.messages);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return messages.slice(0, limit);
}

async function listMessages(accessToken, labels, query, limit) {
  const seen = new Set();
  const all = [];
  for (const label of labels) {
    const msgs = await listMessagesForLabel(accessToken, label, query, limit);
    for (const m of msgs) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        all.push(m);
      }
    }
  }
  return all.slice(0, limit);
}

async function getMessage(accessToken, id) {
  return gmailFetch(accessToken, `/messages/${id}?format=full`);
}

function getHeader(msg, name) {
  const headers = msg.payload?.headers || [];
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

// ─── Body extraction + cleanup ──────────────────────────────────────────────

function decodeBase64Url(data) {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  return Buffer.from(padded, "base64").toString("utf8");
}

function extractTextFromParts(part) {
  let plain = "";
  let html = "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    plain += decodeBase64Url(part.body.data);
  } else if (part.mimeType === "text/html" && part.body?.data) {
    html += decodeBase64Url(part.body.data);
  }
  if (part.parts) {
    for (const sub of part.parts) {
      const e = extractTextFromParts(sub);
      plain += e.plain;
      html += e.html;
    }
  }
  return { plain, html };
}

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripQuotedReplies(text) {
  const lines = text.split("\n");
  const cleaned = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^On .+ wrote:$/i.test(t)) break;
    if (/^On .+/i.test(t) && !t.endsWith("wrote:")) {
      const look = lines.slice(i, i + 4).join(" ");
      if (/^On .+ wrote:$/im.test(look)) break;
    }
    if (/^-{3,}\s*Original Message\s*-{3,}$/i.test(t)) break;
    if (/^_{3,}$/.test(t)) break;
    if (/^From:.*@/.test(t) && cleaned.length > 0) break;
    if (/^-{5,}\s*Forwarded message/i.test(t)) break;
    if (/^>/.test(t) && cleaned.length > 0) break;
    cleaned.push(lines[i]);
  }
  return cleaned.join("\n").trim();
}

function stripSignature(text) {
  const lines = text.split("\n");
  const cleaned = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "--" || lines[i].trim() === "-- ") break;
    if (i > lines.length - 8) {
      const remaining = lines.slice(i).join("\n").toLowerCase();
      if (/^(regards|best|thanks|cheers|sincerely|sent from)/i.test(lines[i].trim())) {
        cleaned.push(lines[i]);
        break;
      }
      if (remaining.includes("sent from my iphone") || remaining.includes("sent from my ipad")) break;
    }
    cleaned.push(lines[i]);
  }
  return cleaned.join("\n").trim();
}

function wordCount(text) {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function isAutoGenerated(msg, body) {
  const subject = getHeader(msg, "Subject").toLowerCase();
  const from = getHeader(msg, "From").toLowerCase();
  const autoHeader = getHeader(msg, "Auto-Submitted").toLowerCase();
  if (autoHeader && autoHeader !== "no") return true;
  if (subject === "unsubscribe") return true;
  if (/reacted via gmail/i.test(body)) return true;
  if (/this message was automatically generated/i.test(body)) return true;

  const noiseFromPatterns = [
    "no-reply", "noreply", "no.reply", "automated@", "donotreply",
    "notifications@", "mailer-daemon", "postmaster@",
  ];
  if (noiseFromPatterns.some((p) => from.includes(p))) return true;

  const noiseSubjectPatterns = [
    /\b(receipt|invoice|payment|autopay|billing)\b/i,
    /\byour (order|booking|reservation|subscription)\b/i,
    /\bconfirmation #/i,
    /\bbooking #/i,
    /\bpassword reset\b/i,
    /\bverify your (email|account)\b/i,
    /\bpayment (is )?due\b/i,
    /\bpayment failed\b/i,
    /\brequests? \$[\d,.]+/i,
  ];
  if (noiseSubjectPatterns.some((p) => p.test(subject))) return true;

  const cssRatio = (body.match(/{[^}]*}/g) || []).length;
  if (cssRatio > 10) return true;

  return false;
}

// Returns { ok: true, email } on success or { ok: false, reason } on skip.
function processEmail(msg, labelMap) {
  const { plain, html } = extractTextFromParts(msg.payload);
  let body = plain || htmlToText(html);
  if (!body.trim()) return { ok: false, reason: "empty_body" };
  if (isAutoGenerated(msg, body)) return { ok: false, reason: "auto_generated" };
  body = stripQuotedReplies(body);
  body = stripSignature(body);
  if (!body.trim()) return { ok: false, reason: "empty_after_strip" };
  const wc = wordCount(body);
  if (wc < 10) return { ok: false, reason: "too_short", wordCount: wc };

  const rawLabels = msg.labelIds || [];
  const readableLabels = rawLabels
    .map((id) => labelMap.get(id) || id)
    .filter((n) => !n.startsWith("CATEGORY_"));

  // RFC 2822 threading headers — captured at source so replies_to edges can
  // be built offline without re-fetching from Gmail.
  const messageId = getHeader(msg, "Message-ID") || null;
  const inReplyTo = getHeader(msg, "In-Reply-To") || null;
  const referencesHdr = getHeader(msg, "References");
  const references = referencesHdr
    ? referencesHdr.split(/\s+/).map((s) => s.trim()).filter(Boolean)
    : [];

  // Structured correspondent parse. Parse once here so pack consumers and
  // downstream entity-resolver don't re-split the raw strings.
  const fromRaw = getHeader(msg, "From");
  const toRaw = getHeader(msg, "To");
  const ccRaw = getHeader(msg, "Cc");
  const parseList = (raw) =>
    parseRfc2822Address(raw).map(({ displayName, email }) => ({
      name: displayName || null,
      email: normalizeEmail(email),
    }));
  const fromParsed = parseList(fromRaw);
  const toParsed = parseList(toRaw);
  const ccParsed = parseList(ccRaw);

  return {
    ok: true,
    email: {
      gmailId: msg.id,
      threadId: msg.threadId,
      from: fromRaw,
      to: toRaw,
      cc: ccRaw,
      fromParsed,
      toParsed,
      ccParsed,
      subject: getHeader(msg, "Subject"),
      date: new Date(parseInt(msg.internalDate, 10)).toISOString(),
      labels: readableLabels,
      body,
      wordCount: wc,
      messageId,
      inReplyTo,
      references,
    },
  };
}

// ─── Pack record builder ────────────────────────────────────────────────────

function buildAtomRecord(email, runId, ctx = {}, atom = null) {
  const atomized = atom != null;
  const atomText = atomized ? atom.text : email.body;
  const atomWordCount = atomized ? wordCount(atomText) : email.wordCount;
  const atomIndex = atomized ? atom.index : 0;
  const atomCount = atomized ? atom.total : 1;
  const atomSuffix = atomized ? ` | atom ${atomIndex + 1} of ${atomCount}` : "";

  const text = `[Email from ${email.from}${email.to ? ` to ${email.to}` : ""} | Subject: ${email.subject} | ${email.date}${atomSuffix}]\n\n${atomText}`;
  // Detect on body + subject only. Skip the wrapped header (from/to always contain
  // email addresses, which would trivially hit the personal-tier email regex).
  const sens = detectSensitivity(`${email.subject || ""}\n${atomText}`);
  const rel = classifyRelationshipTier({
    from: email.from,
    to: email.to,
    cc: email.cc,
    threadId: email.threadId,
    contactsCache: ctx.contactsCache,
    engagedThreads: ctx.engagedThreads,
  });
  const memoryId = atomCount > 1
    ? `gmail:${email.gmailId}#atom:${atomIndex}`
    : `gmail:${email.gmailId}`;
  return {
    memoryId,
    text,
    type: "reference",
    importance: 3,
    tags: email.labels.filter((l) => !["INBOX", "SENT", "UNREAD", "IMPORTANT", "STARRED"].includes(l)),
    fingerprint: sha256Hex(text),
    sensitivity: sens.tier,
    sensitiveReasons: sens.reasons,
    context: {
      sourceType: "gmail_export",
      sourceId: memoryId,
      sourceFile: `gmail:thread:${email.threadId}`,
      sourceLocator: atomCount > 1
        ? `gmail:message:${email.gmailId}#atom:${atomIndex}`
        : `gmail:message:${email.gmailId}`,
      conversationId: email.threadId,
      conversationTitle: email.subject || "(no subject)",
      conversationCreatedAt: email.date,
      chunkIndex: atomIndex,
      runId,
      relationship_tier: rel.tier,
      relationship_match: rel.matchedEmail,
      contact_name: rel.contactName,
      gmail: {
        from: email.from,
        to: email.to,
        cc: email.cc,
        correspondents: {
          author: email.fromParsed || [],
          recipients: email.toParsed || [],
          cc: email.ccParsed || [],
        },
        gmail_id: email.gmailId,
        thread_id: email.threadId,
        labels: email.labels,
        message_id: email.messageId,
        in_reply_to: email.inReplyTo,
        references: email.references,
        ...(atomCount > 1 && { atom_index: atomIndex, atom_count: atomCount }),
        atom_word_count: atomWordCount,
        word_count: email.wordCount,
      },
    },
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const creds = loadOAuthClient();
  const accessToken = await authorize(creds, args.loginHint);

  if (args.listLabels) {
    const labels = await listLabels(accessToken);
    console.log("\nGmail Labels:\n");
    const sorted = labels.sort((a, b) => a.name.localeCompare(b.name));
    for (const l of sorted) {
      const count = l.messagesTotal !== undefined ? ` (${l.messagesTotal} messages)` : "";
      console.log(`  ${l.id.padEnd(25)} ${l.name}${count}`);
    }
    return;
  }

  const allLabels = await listLabels(accessToken);
  const labelMap = new Map(allLabels.map((l) => [l.id, l.name]));

  const query = buildDateQuery(args);
  const runId = new Date().toISOString().replace(/[:.]/g, "-");

  let engagedThreads = new Set();
  const overrideLabelSet = new Set(args.overrideLabels);
  if (args.engagedOnly && !args.includeUnengaged) {
    engagedThreads = await loadOrRefreshEngagedThreads(accessToken, args);
  }

  const contactsCache = ensureContactsCache(args);
  const recordCtx = { contactsCache, engagedThreads };
  if (contactsCache) {
    console.log(`[contacts] ${contactsCache.unique_email_addresses || Object.keys(contactsCache.contacts || {}).length} email addresses in cache`);
  }

  console.log(`\nPulling emails:`);
  console.log(`  Labels: ${args.labels.join(", ")}`);
  console.log(`  Window: ${args.window}${query ? ` (${query})` : ""}`);
  if (args.after) console.log(`  After:  ${args.after}`);
  if (args.before) console.log(`  Before: ${args.before}`);
  console.log(`  Limit:  ${args.limit}`);
  console.log(`  Mode:   ${args.dryRun ? "DRY RUN (no pack written)" : "Pack emit"}`);
  if (args.engagedOnly && !args.includeUnengaged) {
    console.log(`  Engagement: gate ON (${engagedThreads.size} engaged threads; bypass labels: ${[...overrideLabelSet].join(",")})`);
  } else {
    console.log(`  Engagement: gate OFF (--include-unengaged)`);
  }
  console.log(`  Run ID: ${runId}\n`);

  const fetchedIds = loadFetchedIds();
  const messageRefs = await listMessages(accessToken, args.labels, query, args.limit);
  console.log(`Found ${messageRefs.length} messages. ${fetchedIds.size} already in fetched.jsonl.\n`);
  if (messageRefs.length === 0) return;

  const now = () => new Date().toISOString();
  let processed = 0;
  const skipReasons = {
    empty_body: 0, auto_generated: 0, empty_after_strip: 0, too_short: 0,
    no_engagement: 0,
  };
  let alreadyFetched = 0;
  let fetchErrors = 0;

  const emails = [];
  for (const ref of messageRefs) {
    if (fetchedIds.has(ref.id)) {
      alreadyFetched++;
      continue;
    }

    let msg;
    try {
      msg = await getMessage(accessToken, ref.id);
    } catch (err) {
      fetchErrors++;
      if (!args.dryRun) {
        logError({ gmail_id: ref.id, thread_id: ref.threadId, stage: "gmail_get_message", error: err.message, at: now() });
      }
      console.warn(`   [error] fetch ${ref.id}: ${err.message}`);
      continue;
    }

    const fetchedRecord = {
      gmail_id: msg.id,
      thread_id: msg.threadId,
      from: getHeader(msg, "From"),
      subject: getHeader(msg, "Subject"),
      date: new Date(parseInt(msg.internalDate, 10)).toISOString(),
      labels: (msg.labelIds || []).map((id) => labelMap.get(id) || id).filter((n) => !n.startsWith("CATEGORY_")),
      fetched_at: now(),
      run_id: runId,
    };
    if (!args.dryRun) logFetched(fetchedRecord);

    // Engagement gate. After fetch (to access labelIds for override).
    if (args.engagedOnly && !args.includeUnengaged) {
      const rawLabels = msg.labelIds || [];
      const hasBypass = rawLabels.some((l) => overrideLabelSet.has(l));
      const engaged = engagedThreads.has(msg.threadId);
      if (!engaged && !hasBypass) {
        skipReasons.no_engagement++;
        if (!args.dryRun) {
          logExtracted({
            gmail_id: msg.id,
            thread_id: msg.threadId,
            status: "skipped_no_engagement",
            at: now(),
            run_id: runId,
          });
        }
        continue;
      }
    }

    const result = processEmail(msg, labelMap);
    if (!result.ok) {
      skipReasons[result.reason] = (skipReasons[result.reason] || 0) + 1;
      if (!args.dryRun) {
        logExtracted({
          gmail_id: msg.id,
          thread_id: msg.threadId,
          status: `skipped_${result.reason}`,
          word_count: result.wordCount ?? null,
          at: now(),
          run_id: runId,
        });
      }
      continue;
    }

    const email = result.email;
    if (!args.dryRun) {
      logExtracted({
        gmail_id: email.gmailId,
        thread_id: email.threadId,
        status: "success",
        word_count: email.wordCount,
        at: now(),
        run_id: runId,
      });
    }

    processed++;
    emails.push(email);
    console.log(`${processed}. ${email.subject || "(no subject)"}`);
    console.log(`   From: ${email.from} | ${email.wordCount} words | ${email.date.slice(0, 10)}`);
    if (args.dryRun) {
      console.log(`   "${email.body.slice(0, 120).replace(/\s+/g, " ")}..."\n`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const totalSkipped = Object.values(skipReasons).reduce((a, b) => a + b, 0);

  // Group into threads.
  const threadMap = new Map();
  for (const email of emails) {
    if (!threadMap.has(email.threadId)) {
      threadMap.set(email.threadId, {
        threadId: email.threadId,
        subject: email.subject,
        messages: [],
      });
    }
    threadMap.get(email.threadId).messages.push(email);
  }
  for (const thread of threadMap.values()) {
    thread.messages.sort((a, b) => a.date.localeCompare(b.date));
  }
  const threads = [...threadMap.values()];

  // Build pack records. Long emails (>= atomizeMinWords words) are split by
  // the LLM atomizer into multiple atomic thoughts; short emails remain as one.
  const EMAIL_ATOM_PROMPT = `${DEFAULT_ATOMIZE_PROMPT}

EMAIL-SPECIFIC GUIDANCE:
- Each atom should capture one distinct idea, decision, commitment, or question
- Preserve quoted replies only if they convey a new idea in this message
- Do NOT atomize pleasantries, greetings, or signatures as their own thoughts
- Small emails that are already one thought should return a one-element array`;

  const packMemories = [];
  let atomizedCount = 0;
  let atomizeFailures = 0;
  for (const email of emails) {
    const shouldAtomize = args.atomize && email.wordCount >= args.atomizeMinWords;
    if (!shouldAtomize) {
      packMemories.push(buildAtomRecord(email, runId, recordCtx));
      continue;
    }
    try {
      const atoms = await atomizeText(email.body, {
        prompt: EMAIL_ATOM_PROMPT,
        provider: args.atomizeProvider,
        timeoutMs: 45_000,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        openrouterApiKey: process.env.OPENROUTER_API_KEY,
      });
      if (atoms.length === 1) {
        // LLM judged the email already-atomic. Use the curated text so we
        // don't silently drop the LLM's work (it may still have trimmed
        // pleasantries/signatures/quoted replies per EMAIL_ATOM_PROMPT).
        packMemories.push(
          buildAtomRecord(email, runId, recordCtx, { text: atoms[0], index: 0, total: 1 }),
        );
      } else {
        atomizedCount++;
        const total = atoms.length;
        for (let i = 0; i < total; i++) {
          packMemories.push(
            buildAtomRecord(email, runId, recordCtx, { text: atoms[i], index: i, total }),
          );
        }
        console.log(`   [atomize] ${email.gmailId} (${email.wordCount} words) → ${total} atoms`);
      }
    } catch (err) {
      // Fall back to single-thought capture; log and continue. Never lose the email.
      atomizeFailures++;
      console.warn(`   [atomize] ${email.gmailId} failed, capturing whole-email: ${err.message.slice(0, 160)}`);
      packMemories.push(buildAtomRecord(email, runId, recordCtx));
    }
  }

  const pack = {
    version: 2,
    source_type: "gmail_export",
    run_id: runId,
    generated_at: new Date().toISOString(),
    stats: {
      messages_found: messageRefs.length,
      messages_processed: processed,
      messages_skipped_total: totalSkipped,
      skip_reasons: skipReasons,
      already_fetched: alreadyFetched,
      fetch_errors: fetchErrors,
      threads_total: threads.length,
      threads_multi_message: threads.filter((t) => t.messages.length >= 2).length,
      emails_processed: emails.length,
      thoughts_total: packMemories.length,
      emails_atomized: atomizedCount,
      atomize_failures: atomizeFailures,
    },
    safe_memories: packMemories,
    personal_memories: [],
  };

  if (args.dryRun) {
    console.log("\n─── DRY RUN pack preview ───");
    console.log(JSON.stringify(pack.stats, null, 2));
    if (packMemories.length > 0) {
      console.log(`\nFirst thought record:`);
      console.log(JSON.stringify(packMemories[0], null, 2).slice(0, 800) + "\n...");
      const atomSample = packMemories.find((m) => m.memoryId?.includes("#atom:"));
      if (atomSample) {
        console.log(`\nSample atomized record:`);
        console.log(JSON.stringify(atomSample, null, 2).slice(0, 800) + "\n...");
      }
    }
    console.log("\n(dry run — no pack file written, state logs untouched)");
    return;
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const packPath = join(OUTPUT_DIR, `${runId}.json`);
  writeFileSync(packPath, JSON.stringify(pack, null, 2));

  console.log("\n─── Summary ───");
  console.log(`Pack:             ${packPath}`);
  console.log(`PACK_PATH=${packPath}`);
  console.log(`Fetched log:      ${FETCHED_LOG_PATH}`);
  console.log(`Extracted log:    ${EXTRACTED_LOG_PATH}`);
  console.log(JSON.stringify(pack.stats, null, 2));
  console.log(`\nNext step: feed ${packPath} into your Open Brain import pipeline.`);
}

main().catch((err) => {
  console.error("Fatal:", err.stack || err.message);
  process.exit(1);
});
