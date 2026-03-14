#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

/**
 * Open Brain — Gmail Pull Script
 *
 * Fetches emails from Gmail via REST API, parses and chunks them,
 * and stores each as a thought in your Open Brain instance.
 *
 * Ingestion modes:
 *
 *   Default (Supabase direct):
 *     Generates embeddings via OpenRouter, inserts via Supabase insert_thought RPC.
 *     Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY
 *
 *   --ingest-endpoint:
 *     POSTs to a custom ingest endpoint that handles embedding + storage.
 *     Requires: INGEST_URL, INGEST_KEY
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-write --allow-env pull-gmail.ts [options]
 *
 * Options:
 *   --window=24h|7d|30d|1y|all    Time window to fetch (default: 24h)
 *   --labels=SENT,STARRED          Comma-separated Gmail labels (default: SENT)
 *   --dry-run                      Parse and show emails without ingesting
 *   --limit=N                      Max emails to process (default: 50)
 *   --list-labels                  List all Gmail labels and exit
 *   --ingest-endpoint              Use INGEST_URL/INGEST_KEY instead of Supabase direct
 */

// ─── Configuration ───────────────────────────────────────────────────────────

const CREDENTIALS_PATH = "credentials.json";
const TOKEN_PATH = "token.json";
const SYNC_LOG_PATH = "gmail-sync-log.json";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const INGEST_URL = Deno.env.get("INGEST_URL") || "";
const INGEST_KEY = Deno.env.get("INGEST_KEY") || "";

// ─── Sync Log (deduplication) ────────────────────────────────────────────────

interface SyncLog {
  ingested_ids: Record<string, string>; // gmail_message_id -> ISO timestamp
  last_sync: string;
}

async function loadSyncLog(): Promise<SyncLog> {
  try {
    const text = await Deno.readTextFile(SYNC_LOG_PATH);
    return JSON.parse(text);
  } catch {
    return { ingested_ids: {}, last_sync: "" };
  }
}

async function saveSyncLog(log: SyncLog): Promise<void> {
  await Deno.writeTextFile(SYNC_LOG_PATH, JSON.stringify(log, null, 2));
}

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

interface CliArgs {
  window: string;
  labels: string[];
  dryRun: boolean;
  limit: number;
  listLabels: boolean;
  ingestEndpoint: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    window: "24h",
    labels: ["SENT"],
    dryRun: false,
    limit: 50,
    listLabels: false,
    ingestEndpoint: false,
  };

  for (const arg of Deno.args) {
    if (arg.startsWith("--window=")) {
      args.window = arg.split("=")[1];
    } else if (arg.startsWith("--labels=")) {
      args.labels = arg.split("=")[1].split(",").map((l) => l.trim().toUpperCase());
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg.startsWith("--limit=")) {
      args.limit = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--list-labels") {
      args.listLabels = true;
    } else if (arg === "--ingest-endpoint") {
      args.ingestEndpoint = true;
    }
  }

  return args;
}

// ─── OAuth2 Flow ─────────────────────────────────────────────────────────────

interface OAuthCredentials {
  installed: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

interface TokenData {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
}

async function loadCredentials(): Promise<OAuthCredentials> {
  try {
    const text = await Deno.readTextFile(CREDENTIALS_PATH);
    return JSON.parse(text);
  } catch {
    console.error(`\nNo credentials.json found in current directory.`);
    console.error("\nTo set up Gmail API access:");
    console.error("  1. Go to https://console.cloud.google.com/apis/credentials");
    console.error("  2. Create an OAuth 2.0 Client ID (type: Desktop app)");
    console.error("  3. Download the JSON and save it as credentials.json");
    console.error("  4. Enable the Gmail API at https://console.cloud.google.com/apis/library/gmail.googleapis.com");
    Deno.exit(1);
  }
}

async function loadToken(): Promise<TokenData | null> {
  try {
    const text = await Deno.readTextFile(TOKEN_PATH);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function saveToken(token: TokenData): Promise<void> {
  await Deno.writeTextFile(TOKEN_PATH, JSON.stringify(token, null, 2));
}

async function refreshAccessToken(
  creds: OAuthCredentials,
  token: TokenData,
): Promise<TokenData> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.installed.client_id,
      client_secret: creds.installed.client_secret,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
  }

  const updated: TokenData = {
    access_token: data.access_token,
    refresh_token: token.refresh_token,
    token_type: data.token_type,
    expiry_date: Date.now() + data.expires_in * 1000,
  };
  await saveToken(updated);
  return updated;
}

async function authorize(creds: OAuthCredentials): Promise<string> {
  let token = await loadToken();

  if (token) {
    if (Date.now() < token.expiry_date - 60_000) {
      return token.access_token;
    }
    console.log("Access token expired, refreshing...");
    token = await refreshAccessToken(creds, token);
    return token.access_token;
  }

  // First-time auth: open browser for consent
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", creds.installed.client_id);
  authUrl.searchParams.set("redirect_uri", "http://localhost:3847/callback");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.log("\nOpen this URL in your browser to authorize:\n");
  console.log(authUrl.toString());
  console.log("\nWaiting for authorization...");

  // Spin up a tiny local server to catch the redirect
  const code = await new Promise<string>((resolve) => {
    const server = Deno.serve({ port: 3847, onListen: () => {} }, (req) => {
      const url = new URL(req.url);
      const authCode = url.searchParams.get("code");
      if (authCode) {
        resolve(authCode);
        setTimeout(() => server.shutdown(), 100);
        return new Response(
          "<html><body><h2>Authorization complete!</h2><p>You can close this tab and return to your terminal.</p></body></html>",
          { headers: { "Content-Type": "text/html" } },
        );
      }
      return new Response("Waiting for auth...", { status: 400 });
    });
  });

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.installed.client_id,
      client_secret: creds.installed.client_secret,
      redirect_uri: "http://localhost:3847/callback",
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    throw new Error(`Token exchange failed: ${tokenData.error_description || tokenData.error}`);
  }

  const newToken: TokenData = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_type: tokenData.token_type,
    expiry_date: Date.now() + tokenData.expires_in * 1000,
  };
  await saveToken(newToken);
  console.log("\nAuthorization successful! Token saved.\n");
  return newToken.access_token;
}

// ─── Gmail API Helpers ───────────────────────────────────────────────────────

async function gmailFetch(accessToken: string, path: string): Promise<unknown> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API error ${res.status}: ${body}`);
  }
  return res.json();
}

interface GmailLabel {
  id: string;
  name: string;
  type: string;
  messagesTotal?: number;
}

async function listLabels(accessToken: string): Promise<GmailLabel[]> {
  const data = (await gmailFetch(accessToken, "/labels")) as { labels: GmailLabel[] };
  return data.labels;
}

function windowToQuery(window: string): string {
  const now = new Date();
  let after: Date;

  switch (window) {
    case "24h":
      after = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "7d":
      after = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
      after = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case "1y":
      after = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    case "all":
      return "";
    default:
      console.error(`Unknown window: ${window}. Use 24h, 7d, 30d, 1y, or all.`);
      Deno.exit(1);
  }

  const y = after.getFullYear();
  const m = String(after.getMonth() + 1).padStart(2, "0");
  const d = String(after.getDate()).padStart(2, "0");
  return `after:${y}/${m}/${d}`;
}

interface GmailMessageRef {
  id: string;
  threadId: string;
}

async function listMessagesForLabel(
  accessToken: string,
  label: string,
  query: string,
  limit: number,
): Promise<GmailMessageRef[]> {
  const messages: GmailMessageRef[] = [];
  let pageToken: string | undefined;

  while (messages.length < limit) {
    const maxResults = Math.min(100, limit - messages.length);
    let path = `/messages?labelIds=${label}&maxResults=${maxResults}`;
    if (query) path += `&q=${encodeURIComponent(query)}`;
    if (pageToken) path += `&pageToken=${pageToken}`;

    const data = (await gmailFetch(accessToken, path)) as {
      messages?: GmailMessageRef[];
      nextPageToken?: string;
    };

    if (!data.messages) break;
    messages.push(...data.messages);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return messages.slice(0, limit);
}

async function listMessages(
  accessToken: string,
  labels: string[],
  query: string,
  limit: number,
): Promise<GmailMessageRef[]> {
  // Query each label separately (OR logic) and deduplicate by message ID
  const seen = new Set<string>();
  const allMessages: GmailMessageRef[] = [];

  for (const label of labels) {
    const messages = await listMessagesForLabel(accessToken, label, query, limit);
    for (const msg of messages) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        allMessages.push(msg);
      }
    }
  }

  // Sort by ID descending (Gmail IDs are roughly chronological) and apply limit
  return allMessages.slice(0, limit);
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  mimeType: string;
  body: { data?: string; size: number };
  parts?: GmailMessagePart[];
  headers?: GmailHeader[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  payload: GmailMessagePart;
  internalDate: string;
}

async function getMessage(accessToken: string, id: string): Promise<GmailMessage> {
  return (await gmailFetch(accessToken, `/messages/${id}?format=full`)) as GmailMessage;
}

function getHeader(msg: GmailMessage, name: string): string {
  const headers = msg.payload.headers || [];
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

// ─── Email Body Extraction ───────────────────────────────────────────────────

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
}

function extractTextFromParts(part: GmailMessagePart): { plain: string; html: string } {
  let plain = "";
  let html = "";

  if (part.mimeType === "text/plain" && part.body.data) {
    plain += decodeBase64Url(part.body.data);
  } else if (part.mimeType === "text/html" && part.body.data) {
    html += decodeBase64Url(part.body.data);
  }

  if (part.parts) {
    for (const sub of part.parts) {
      const extracted = extractTextFromParts(sub);
      plain += extracted.plain;
      html += extracted.html;
    }
  }

  return { plain, html };
}

function htmlToText(html: string): string {
  return html
    // Block-level elements get newlines
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/tr>/gi, "\n")
    // List items
    .replace(/<li[^>]*>/gi, "- ")
    // Strip all remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode common entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    // Clean up whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripQuotedReplies(text: string): string {
  const lines = text.split("\n");
  const cleaned: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // "On ... wrote:" on a single line
    if (/^On .+ wrote:$/i.test(trimmed)) break;
    // Gmail wraps long "On ... wrote:" across multiple lines — check if next lines end with "wrote:"
    if (/^On .+/i.test(trimmed) && !trimmed.endsWith("wrote:")) {
      const lookahead = lines.slice(i, i + 4).join(" ");
      if (/^On .+ wrote:$/im.test(lookahead)) break;
    }
    if (/^-{3,}\s*Original Message\s*-{3,}$/i.test(trimmed)) break;
    if (/^_{3,}$/.test(trimmed)) break;
    if (/^From:.*@/.test(trimmed) && cleaned.length > 0) break;
    if (/^-{5,}\s*Forwarded message/i.test(trimmed)) break;
    // Lines starting with > are quoted text
    if (/^>/.test(trimmed) && cleaned.length > 0) break;

    cleaned.push(lines[i]);
  }

  return cleaned.join("\n").trim();
}

function stripSignature(text: string): string {
  const lines = text.split("\n");
  const cleaned: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    // Standard sig delimiter
    if (lines[i].trim() === "--" || lines[i].trim() === "-- ") break;

    // Common signature patterns at end of email
    if (i > lines.length - 8) {
      const remaining = lines.slice(i).join("\n").toLowerCase();
      if (/^(regards|best|thanks|cheers|sincerely|sent from)/i.test(lines[i].trim())) {
        // Keep the sign-off line but drop everything after
        cleaned.push(lines[i]);
        break;
      }
      if (remaining.includes("sent from my iphone") || remaining.includes("sent from my ipad")) {
        break;
      }
    }

    cleaned.push(lines[i]);
  }

  return cleaned.join("\n").trim();
}

// ─── Chunking ────────────────────────────────────────────────────────────────

const CHUNK_THRESHOLD = 500; // words
const CHUNK_TARGET_MIN = 200;
const CHUNK_TARGET_MAX = 500;
const CHUNK_OVERLAP_WORDS = 50;

interface Chunk {
  text: string;
  index: number;
  wordCount: number;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function chunkText(text: string): Chunk[] {
  const totalWords = wordCount(text);
  if (totalWords <= CHUNK_THRESHOLD) {
    return [{ text, index: 0, wordCount: totalWords }];
  }

  // Split on paragraph boundaries first, fall back to sentence boundaries
  let segments = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  // If there's only one segment and it's too long, split on sentence boundaries
  if (segments.length === 1 && totalWords > CHUNK_THRESHOLD) {
    segments = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  }

  const chunks: Chunk[] = [];
  let currentChunk = "";
  let overlapBuffer = "";

  for (const seg of segments) {
    const currentWords = wordCount(currentChunk);
    const segWords = wordCount(seg);

    if (currentWords + segWords > CHUNK_TARGET_MAX && currentWords >= CHUNK_TARGET_MIN) {
      chunks.push({
        text: currentChunk.trim(),
        index: chunks.length,
        wordCount: wordCount(currentChunk),
      });

      const words = currentChunk.trim().split(/\s+/);
      overlapBuffer = words.slice(-CHUNK_OVERLAP_WORDS).join(" ");
      currentChunk = overlapBuffer + "\n\n" + seg;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + seg;
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      index: chunks.length,
      wordCount: wordCount(currentChunk),
    });
  }

  return chunks;
}

// ─── Email Processing ────────────────────────────────────────────────────────

interface ProcessedEmail {
  gmailId: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  labels: string[];
  body: string;
  wordCount: number;
  chunks: Chunk[];
}

function isAutoGenerated(msg: GmailMessage, body: string): boolean {
  const subject = getHeader(msg, "Subject").toLowerCase();
  const from = getHeader(msg, "From").toLowerCase();
  const autoHeader = getHeader(msg, "Auto-Submitted").toLowerCase();
  if (autoHeader && autoHeader !== "no") return true;
  if (subject === "unsubscribe") return true;
  if (/reacted via gmail/i.test(body)) return true;
  if (/this message was automatically generated/i.test(body)) return true;

  // Transactional senders
  const noiseFromPatterns = [
    "no-reply", "noreply", "no.reply", "automated@", "donotreply",
    "notifications@", "mailer-daemon", "postmaster@",
  ];
  if (noiseFromPatterns.some((p) => from.includes(p))) return true;

  // Transactional subjects
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

  // If the body is mostly non-text (CSS, HTML artifacts), skip it
  const cssRatio = (body.match(/{[^}]*}/g) || []).length;
  if (cssRatio > 10) return true;

  return false;
}

function processEmail(msg: GmailMessage): ProcessedEmail | null {
  const { plain, html } = extractTextFromParts(msg.payload);

  let body = plain || htmlToText(html);
  if (!body.trim()) return null;

  if (isAutoGenerated(msg, body)) return null;

  body = stripQuotedReplies(body);
  body = stripSignature(body);

  if (!body.trim() || wordCount(body) < 10) return null;

  const chunks = chunkText(body);

  return {
    gmailId: msg.id,
    threadId: msg.threadId,
    from: getHeader(msg, "From"),
    to: getHeader(msg, "To"),
    subject: getHeader(msg, "Subject"),
    date: new Date(parseInt(msg.internalDate)).toISOString(),
    labels: msg.labelIds || [],
    body,
    wordCount: wordCount(body),
    chunks,
  };
}

// ─── Embedding Generation ───────────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[] | null> {
  const truncated = text.slice(0, 8000);

  const res = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: truncated,
    }),
  });

  if (!res.ok) {
    console.error(`   Warning: Embedding generation failed (${res.status})`);
    return null;
  }

  try {
    const data = await res.json();
    return data.data[0].embedding;
  } catch (e) {
    console.error(`   Warning: Failed to parse embedding response: ${e}`);
    return null;
  }
}

// ─── Ingestion ───────────────────────────────────────────────────────────────

interface IngestResult {
  ok: boolean;
  id?: string;
  type?: string;
  topics?: string[];
  error?: string;
}

async function ingestThoughtSupabase(
  content: string,
  metadata: Record<string, unknown>,
  parentId?: string,
  chunkIndex?: number,
): Promise<IngestResult> {
  const embedding = await generateEmbedding(content);
  if (!embedding) {
    return { ok: false, error: "Failed to generate embedding" };
  }

  const row: Record<string, unknown> = {
    content,
    embedding,
    metadata,
  };
  if (parentId) row.parent_id = parentId;
  if (chunkIndex !== undefined) row.chunk_index = chunkIndex;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/thoughts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Prefer": "return=representation",
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const errorText = await res.text();
    return { ok: false, error: `HTTP ${res.status}: ${errorText}` };
  }

  try {
    const data = await res.json();
    const id = Array.isArray(data) ? data[0]?.id : data?.id;
    return { ok: true, id: id ? String(id) : undefined };
  } catch {
    return { ok: true };
  }
}

async function ingestThoughtEndpoint(
  content: string,
  source: string,
  parentId?: string,
  chunkIndex?: number,
  extraMetadata?: Record<string, unknown>,
): Promise<IngestResult> {
  const body: Record<string, unknown> = { content, source };
  if (parentId) body.parent_id = parentId;
  if (chunkIndex !== undefined) body.chunk_index = chunkIndex;
  if (extraMetadata) body.extra_metadata = extraMetadata;

  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ingest-key": INGEST_KEY,
    },
    body: JSON.stringify(body),
  });

  return (await res.json()) as IngestResult;
}

function buildEmailContent(
  emailBody: string,
  from: string,
  subject: string,
  date: string,
  chunkInfo?: { index: number; total: number },
): string {
  const contextPrefix = `[Email from ${from} | Subject: ${subject} | Date: ${date}]`;
  if (chunkInfo && chunkInfo.total > 1) {
    return `${contextPrefix} [Part ${chunkInfo.index + 1}/${chunkInfo.total}]\n\n${emailBody}`;
  }
  return `${contextPrefix}\n\n${emailBody}`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const creds = await loadCredentials();
  const accessToken = await authorize(creds);

  // --list-labels mode
  if (args.listLabels) {
    const labels = await listLabels(accessToken);
    console.log("\nGmail Labels:\n");
    const sorted = labels.sort((a, b) => a.name.localeCompare(b.name));
    for (const label of sorted) {
      const count = label.messagesTotal !== undefined ? ` (${label.messagesTotal} messages)` : "";
      console.log(`  ${label.id.padEnd(25)} ${label.name}${count}`);
    }
    return;
  }

  // Build label ID -> name map for metadata
  const allLabels = await listLabels(accessToken);
  const labelMap = new Map<string, string>();
  for (const l of allLabels) {
    labelMap.set(l.id, l.name);
  }

  // Normal pull mode
  const query = windowToQuery(args.window);
  const ingestMode = args.ingestEndpoint ? "custom endpoint" : "Supabase direct insert";
  console.log(`\nFetching emails...`);
  console.log(`  Labels: ${args.labels.join(", ")}`);
  console.log(`  Window: ${args.window}${query ? ` (${query})` : ""}`);
  console.log(`  Limit:  ${args.limit}`);
  console.log(`  Mode:   ${args.dryRun ? "DRY RUN (no ingestion)" : "LIVE"}`);
  if (!args.dryRun) {
    console.log(`  Ingest: ${ingestMode}`);
  }

  // Validate env vars for live mode
  if (!args.dryRun) {
    if (args.ingestEndpoint) {
      if (!INGEST_URL) {
        console.error("\nINGEST_URL environment variable is required with --ingest-endpoint.");
        Deno.exit(1);
      }
      if (!INGEST_KEY) {
        console.error("\nINGEST_KEY environment variable is required with --ingest-endpoint.");
        Deno.exit(1);
      }
    } else {
      if (!SUPABASE_URL) {
        console.error("\nSUPABASE_URL environment variable is required.");
        console.error("Set it to your Supabase project URL (e.g., https://xxxxx.supabase.co)");
        Deno.exit(1);
      }
      if (!SUPABASE_SERVICE_ROLE_KEY) {
        console.error("\nSUPABASE_SERVICE_ROLE_KEY environment variable is required.");
        Deno.exit(1);
      }
      if (!OPENROUTER_API_KEY) {
        console.error("\nOPENROUTER_API_KEY environment variable is required for embedding generation.");
        console.error("Get one at https://openrouter.ai/keys");
        Deno.exit(1);
      }
    }
  }

  const syncLog = await loadSyncLog();
  const messageRefs = await listMessages(accessToken, args.labels, query, args.limit);
  console.log(`\nFound ${messageRefs.length} messages.\n`);

  if (messageRefs.length === 0) return;

  let processed = 0;
  let skipped = 0;
  let alreadyIngested = 0;
  let chunked = 0;
  let totalChunks = 0;
  let ingested = 0;
  let errors = 0;
  let totalWords = 0;

  for (const ref of messageRefs) {
    // Dedup: skip if already ingested
    if (syncLog.ingested_ids[ref.id]) {
      alreadyIngested++;
      continue;
    }

    const msg = await getMessage(accessToken, ref.id);
    const email = processEmail(msg);

    if (!email) {
      skipped++;
      continue;
    }

    processed++;
    totalWords += email.wordCount;

    const isChunked = email.chunks.length > 1;
    if (isChunked) chunked++;
    totalChunks += email.chunks.length;

    // Display
    const chunkInfo = isChunked ? ` [${email.chunks.length} chunks]` : "";
    console.log(
      `${processed}. ${email.subject || "(no subject)"}${chunkInfo}`,
    );
    const readableLabels = email.labels
      .map((id) => labelMap.get(id) || id)
      .filter((name) => !name.startsWith("CATEGORY_"));
    console.log(
      `   From: ${email.from} | ${email.wordCount} words | ${new Date(email.date).toLocaleDateString()}`,
    );
    console.log(`   Labels: ${readableLabels.join(", ")}`);

    if (args.dryRun) {
      if (isChunked) {
        for (const chunk of email.chunks) {
          console.log(
            `   Chunk ${chunk.index + 1}: ${chunk.wordCount} words — "${chunk.text.slice(0, 80)}..."`,
          );
        }
      } else {
        console.log(`   "${email.body.slice(0, 120)}..."`);
      }
      console.log();
      continue;
    }

    // Build metadata for this email
    const gmailLabels = email.labels
      .map((id) => labelMap.get(id) || id)
      .filter((name) => !name.startsWith("CATEGORY_"));

    const emailMeta: Record<string, unknown> = {
      source: "gmail",
      gmail_labels: gmailLabels,
      gmail_id: email.gmailId,
      gmail_thread_id: email.threadId,
    };

    // Live ingestion
    let allChunksOk = true;

    if (isChunked) {
      // Insert parent document first
      const parentContent = buildEmailContent(email.body, email.from, email.subject, email.date);

      let parentResult: IngestResult;
      if (args.ingestEndpoint) {
        parentResult = await ingestThoughtEndpoint(parentContent, "gmail", undefined, undefined, emailMeta);
      } else {
        parentResult = await ingestThoughtSupabase(parentContent, emailMeta);
      }

      if (!parentResult.ok || !parentResult.id) {
        errors++;
        allChunksOk = false;
        console.error(`   -> ERROR (parent): ${parentResult.error}`);
      } else {
        console.log(`   -> Parent doc stored: ${parentResult.id}`);
        ingested++;

        // Insert each chunk linked to parent
        for (const chunk of email.chunks) {
          const chunkContent = buildEmailContent(
            chunk.text, email.from, email.subject, email.date,
            { index: chunk.index, total: email.chunks.length },
          );

          let result: IngestResult;
          if (args.ingestEndpoint) {
            result = await ingestThoughtEndpoint(chunkContent, "gmail", parentResult.id, chunk.index, emailMeta);
          } else {
            result = await ingestThoughtSupabase(chunkContent, emailMeta, parentResult.id, chunk.index);
          }

          if (result.ok) {
            ingested++;
            console.log(`   -> Chunk ${chunk.index + 1} ingested`);
          } else {
            errors++;
            allChunksOk = false;
            console.error(`   -> ERROR (chunk ${chunk.index + 1}): ${result.error}`);
          }

          await new Promise((r) => setTimeout(r, 200));
        }
      }
    } else {
      // Single thought (no chunking)
      const content = buildEmailContent(email.body, email.from, email.subject, email.date);

      let result: IngestResult;
      if (args.ingestEndpoint) {
        result = await ingestThoughtEndpoint(content, "gmail", undefined, undefined, emailMeta);
      } else {
        result = await ingestThoughtSupabase(content, emailMeta);
      }

      if (result.ok) {
        ingested++;
        console.log(`   -> Ingested`);
      } else {
        errors++;
        allChunksOk = false;
        console.error(`   -> ERROR: ${result.error}`);
      }

      await new Promise((r) => setTimeout(r, 200));
    }

    if (allChunksOk) {
      syncLog.ingested_ids[ref.id] = new Date().toISOString();
    }

    console.log();
  }

  // Save sync log
  if (!args.dryRun) {
    syncLog.last_sync = new Date().toISOString();
    await saveSyncLog(syncLog);
  }

  // Summary
  console.log("─".repeat(60));
  console.log("Summary:");
  console.log(`  Emails found:     ${messageRefs.length}`);
  if (alreadyIngested > 0) {
    console.log(`  Already ingested: ${alreadyIngested} (skipped)`);
  }
  console.log(`  Processed:        ${processed}`);
  console.log(`  Skipped (empty):  ${skipped}`);
  console.log(`  Total words:      ${totalWords.toLocaleString()}`);
  const chunkOnlyCount = totalChunks - processed;
  console.log(`  Chunked emails:   ${chunked} (produced ${chunked > 0 ? chunkOnlyCount + chunked : 0} thoughts incl. parents)`);
  console.log(`  Total thoughts:   ${totalChunks} (${processed - chunked} single + ${chunked > 0 ? chunkOnlyCount + chunked : 0} from chunked emails)`);
  if (!args.dryRun) {
    console.log(`  Ingested:         ${ingested}`);
    console.log(`  Errors:           ${errors}`);
  }

  // Cost estimation: embedding cost only for Supabase mode
  const embeddingCost = totalChunks * 100 * 0.02 / 1_000_000;
  console.log(`  Est. API cost:    $${embeddingCost.toFixed(4)}`);
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  Deno.exit(1);
});
