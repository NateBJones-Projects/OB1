#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

/**
 * Open Brain — Gmail Pull Script
 *
 * Fetches emails from Gmail via REST API, cleans them, generates embeddings
 * and metadata, and inserts each as a thought into Supabase with SHA-256
 * content fingerprint dedup.
 *
 * Ingestion modes:
 *   Default:              Supabase direct insert (requires SUPABASE_URL,
 *                         SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY)
 *   --ingest-endpoint:    Custom endpoint (requires INGEST_URL, INGEST_KEY)
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-write --allow-env pull-gmail.ts [options]
 *
 * Options:
 *   --window=24h|7d|30d|90d|1y|all  Time window to fetch (default: 24h)
 *   --labels=SENT,STARRED           Comma-separated Gmail labels (default: SENT)
 *   --dry-run                       Parse and show emails without ingesting
 *   --limit=N                       Max emails to process (default: 50)
 *   --list-labels                   List all Gmail labels and exit
 *   --ingest-endpoint               Use INGEST_URL/INGEST_KEY instead of Supabase direct
 *   --no-redact                     Disable sensitive-data redaction before ingest
 */

// ─── Configuration ───────────────────────────────────────────────────────────

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const CREDENTIALS_PATH = `${SCRIPT_DIR}credentials.json`;
const TOKEN_PATH = `${SCRIPT_DIR}token.json`;
const SYNC_LOG_PATH = `${SCRIPT_DIR}sync-log.json`;
const REDACTION_POLICY_URL = new URL(
  "../../primitives/sensitive-data-redaction/patterns.json",
  import.meta.url,
);

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

// Supabase direct insert (default mode)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";

// Edge Function endpoint (--ingest-endpoint mode)
const INGEST_URL = Deno.env.get("INGEST_URL") || "";
const INGEST_KEY = Deno.env.get("INGEST_KEY") || "";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

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

// ─── Content Fingerprint ────────────────────────────────────────────────────

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Sensitive Data Redaction ───────────────────────────────────────────────

interface SensitiveDataRule {
  label: string;
  action: "redact" | "skip";
  pattern: string;
  placeholder?: string;
  flags?: string;
}

interface SensitiveDataPolicyFile {
  version: string;
  rules: SensitiveDataRule[];
}

interface RedactionFinding {
  label: string;
  action: "redact" | "skip";
  count: number;
}

interface RedactionResult {
  text: string;
  skipped: boolean;
  skipLabel?: string;
  findings: RedactionFinding[];
  totalRedactions: number;
  policyVersion: string;
}

let sensitiveDataPolicyPromise: Promise<SensitiveDataPolicyFile> | null = null;

async function loadSensitiveDataPolicy(): Promise<SensitiveDataPolicyFile> {
  if (!sensitiveDataPolicyPromise) {
    sensitiveDataPolicyPromise = (async () => {
      try {
        const text = await Deno.readTextFile(REDACTION_POLICY_URL);
        const parsed = JSON.parse(text) as Partial<SensitiveDataPolicyFile>;
        if (!parsed.rules || !Array.isArray(parsed.rules)) {
          throw new Error("Invalid patterns.json format");
        }
        return {
          version: parsed.version || "unknown",
          rules: parsed.rules as SensitiveDataRule[],
        };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Sensitive-data redaction requires ${REDACTION_POLICY_URL.pathname}. ` +
            `Keep the repo structure intact or pass --no-redact to opt out. (${detail})`,
        );
      }
    })();
  }

  return await sensitiveDataPolicyPromise;
}

function buildRuleRegex(rule: SensitiveDataRule, global = false): RegExp {
  let flags = rule.flags || "";
  if (global && !flags.includes("g")) flags += "g";
  return new RegExp(rule.pattern, flags);
}

async function applySensitiveDataPolicy(text: string): Promise<RedactionResult> {
  const policy = await loadSensitiveDataPolicy();
  let current = text;
  const findings: RedactionFinding[] = [];
  let totalRedactions = 0;

  for (const rule of policy.rules) {
    if (rule.action === "skip") {
      if (buildRuleRegex(rule).test(current)) {
        return {
          text: current,
          skipped: true,
          skipLabel: rule.label,
          findings: [{ label: rule.label, action: "skip", count: 1 }],
          totalRedactions: 0,
          policyVersion: policy.version,
        };
      }
      continue;
    }

    const regex = buildRuleRegex(rule, true);
    const matches = current.match(regex);
    if (!matches || matches.length === 0) continue;

    current = current.replace(regex, rule.placeholder || "[REDACTED]");
    findings.push({ label: rule.label, action: "redact", count: matches.length });
    totalRedactions += matches.length;
  }

  return {
    text: current,
    skipped: false,
    findings,
    totalRedactions,
    policyVersion: policy.version,
  };
}

function formatRedactionFindings(findings: RedactionFinding[]): string {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    if (finding.action !== "redact") continue;
    counts.set(finding.label, (counts.get(finding.label) || 0) + finding.count);
  }

  return [...counts.entries()]
    .map(([label, count]) => (count > 1 ? `${label} x${count}` : label))
    .join(", ");
}

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

interface CliArgs {
  window: string;
  labels: string[];
  dryRun: boolean;
  limit: number;
  listLabels: boolean;
  ingestEndpoint: boolean;
  noRedact: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    window: "24h",
    labels: ["SENT"],
    dryRun: false,
    limit: 50,
    listLabels: false,
    ingestEndpoint: false,
    noRedact: false,
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
    } else if (arg === "--no-redact") {
      args.noRedact = true;
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
    console.error(`\nNo credentials.json found at: ${CREDENTIALS_PATH}`);
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
    case "90d":
      after = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case "1y":
      after = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    case "all":
      return "";
    default:
      console.error(`Unknown window: ${window}. Use 24h, 7d, 30d, 90d, 1y, or all.`);
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

function stripQuotedReplies(text: string): string {
  const lines = text.split("\n");
  const cleaned: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^On .+ wrote:$/i.test(trimmed)) break;
    if (/^On .+/i.test(trimmed) && !trimmed.endsWith("wrote:")) {
      const lookahead = lines.slice(i, i + 4).join(" ");
      if (/^On .+ wrote:$/im.test(lookahead)) break;
    }
    if (/^-{3,}\s*Original Message\s*-{3,}$/i.test(trimmed)) break;
    if (/^_{3,}$/.test(trimmed)) break;
    if (/^From:.*@/.test(trimmed) && cleaned.length > 0) break;
    if (/^-{5,}\s*Forwarded message/i.test(trimmed)) break;
    if (/^>/.test(trimmed) && cleaned.length > 0) break;

    cleaned.push(lines[i]);
  }

  return cleaned.join("\n").trim();
}

function stripSignature(text: string): string {
  const lines = text.split("\n");
  const cleaned: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "--" || lines[i].trim() === "-- ") break;

    if (i > lines.length - 8) {
      const remaining = lines.slice(i).join("\n").toLowerCase();
      if (/^(regards|best|thanks|cheers|sincerely|sent from)/i.test(lines[i].trim())) {
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

// ─── Email Processing ────────────────────────────────────────────────────────

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

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
}

function isAutoGenerated(msg: GmailMessage, body: string): boolean {
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

function processEmail(msg: GmailMessage): ProcessedEmail | null {
  const { plain, html } = extractTextFromParts(msg.payload);

  let body = plain || htmlToText(html);
  if (!body.trim()) return null;

  if (isAutoGenerated(msg, body)) return null;

  body = stripQuotedReplies(body);
  body = stripSignature(body);

  if (!body.trim() || wordCount(body) < 10) return null;

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
  };
}

// ─── Embedding & Metadata (Supabase direct mode) ───────────────────────────

async function getEmbedding(text: string): Promise<number[]> {
  const truncated = text.slice(0, 8000);
  const res = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: truncated,
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Embedding failed: ${res.status} ${msg}`);
  }
  const d = await res.json();
  return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await res.json();
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

// ─── Content Fingerprint (normalized, matches upsert_thought RPC) ───────────

async function contentFingerprint(text: string): Promise<string> {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, " ");
  return await sha256(normalized);
}

// ─── Ingestion ───────────────────────────────────────────────────────────────

interface IngestResult {
  ok: boolean;
  id?: string;
  type?: string;
  topics?: string[];
  error?: string;
  duplicate?: boolean;
}

let fingerprintSupported: boolean | null = null;

async function ingestThoughtDirect(
  content: string,
  source: string,
  extraMetadata?: Record<string, unknown>,
): Promise<IngestResult> {
  const fingerprint = await contentFingerprint(content);

  const [embedding, metadata] = await Promise.all([
    getEmbedding(content),
    extractMetadata(content),
  ]);

  const row: Record<string, unknown> = {
    content,
    embedding,
    metadata: { ...metadata, source, ...extraMetadata },
  };

  if (fingerprintSupported !== false) {
    row.content_fingerprint = fingerprint;
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/thoughts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });

  // 409 = duplicate fingerprint — content already exists, treat as success
  if (res.status === 409) {
    const meta = metadata as Record<string, unknown>;
    return {
      ok: true,
      type: meta.type as string,
      topics: meta.topics as string[],
      duplicate: true,
    };
  }

  // If fingerprint column doesn't exist, retry without it
  if (!res.ok && fingerprintSupported === null) {
    const body = await res.text();
    if (body.includes("content_fingerprint")) {
      fingerprintSupported = false;
      console.log("   (content_fingerprint column not found — inserting without dedup)");
      console.log("   Run the SQL from primitives/content-fingerprint-dedup to enable dedup.\n");
      delete row.content_fingerprint;
      const retry = await fetch(`${SUPABASE_URL}/rest/v1/thoughts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify(row),
      });
      if (!retry.ok) {
        const retryBody = await retry.text();
        return { ok: false, error: `HTTP ${retry.status}: ${retryBody}` };
      }
      const data = await retry.json();
      const meta = metadata as Record<string, unknown>;
      return {
        ok: true,
        id: Array.isArray(data) ? data[0]?.id : data?.id,
        type: meta.type as string,
        topics: meta.topics as string[],
      };
    }
    return { ok: false, error: `HTTP ${res.status}: ${body}` };
  }

  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `HTTP ${res.status}: ${body}` };
  }

  if (fingerprintSupported === null) fingerprintSupported = true;

  const data = await res.json();
  const meta = metadata as Record<string, unknown>;
  return {
    ok: true,
    id: Array.isArray(data) ? data[0]?.id : data?.id,
    type: meta.type as string,
    topics: meta.topics as string[],
  };
}

async function ingestThoughtEndpoint(
  content: string,
  source: string,
  extraMetadata?: Record<string, unknown>,
): Promise<IngestResult> {
  const fingerprint = await sha256(content);

  const body: Record<string, unknown> = {
    content,
    source,
    content_fingerprint: fingerprint,
  };
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
): string {
  return `[Email from ${from} | Subject: ${subject} | Date: ${date}]\n\n${emailBody}`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const redactionPolicyVersion = args.noRedact ? null : (await loadSensitiveDataPolicy()).version;
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

  // Determine ingestion mode
  const useEndpoint = args.ingestEndpoint;
  const ingestMode = args.dryRun ? "DRY RUN" : useEndpoint ? "Edge Function endpoint" : "Supabase direct insert";

  // Normal pull mode
  const query = windowToQuery(args.window);
  console.log(`\nFetching emails...`);
  console.log(`  Labels: ${args.labels.join(", ")}`);
  console.log(`  Window: ${args.window}${query ? ` (${query})` : ""}`);
  console.log(`  Limit:  ${args.limit}`);
  console.log(`  Mode:   ${ingestMode}`);
  console.log(
    `  Redaction: ${
      args.noRedact ? "disabled (--no-redact)" : `Sensitive Data Redaction ${redactionPolicyVersion}`
    }`,
  );

  if (!args.dryRun) {
    if (useEndpoint) {
      if (!INGEST_URL || !INGEST_KEY) {
        console.error("\nINGEST_URL and INGEST_KEY are required with --ingest-endpoint.");
        console.error("Example: export INGEST_URL=https://YOUR_REF.supabase.co/functions/v1/ingest-thought");
        Deno.exit(1);
      }
    } else {
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        console.error("\nSUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for live mode.");
        console.error("Example: export SUPABASE_URL=https://YOUR_REF.supabase.co");
        Deno.exit(1);
      }
      if (!OPENROUTER_API_KEY) {
        console.error("\nOPENROUTER_API_KEY is required for embedding + metadata extraction.");
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
  let ingested = 0;
  let errors = 0;
  let totalWords = 0;
  let sensitiveSkipped = 0;
  let redactedEmails = 0;
  let totalRedactionHits = 0;

  for (const ref of messageRefs) {
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

    let redactionCount = 0;
    let redactionLabels: string[] = [];
    let redactionVersion: string | undefined;
    let redactionSummary = "";

    if (!args.noRedact) {
      const [subjectResult, bodyResult] = await Promise.all([
        applySensitiveDataPolicy(email.subject),
        applySensitiveDataPolicy(email.body),
      ]);

      if (subjectResult.skipped || bodyResult.skipped) {
        sensitiveSkipped++;
        const skipLabel = subjectResult.skipLabel || bodyResult.skipLabel || "sensitive content";
        console.log(`SKIPPED (sensitive-data-redaction): ${email.subject || "(no subject)"}`);
        console.log(`   Reason: ${skipLabel}`);
        console.log();
        continue;
      }

      const findings = [...subjectResult.findings, ...bodyResult.findings];
      redactionCount = subjectResult.totalRedactions + bodyResult.totalRedactions;
      redactionLabels = [...new Set(findings.map((finding) => finding.label))];
      redactionVersion = subjectResult.policyVersion;
      redactionSummary = formatRedactionFindings(findings);

      email.subject = subjectResult.text;
      email.body = bodyResult.text;
      email.wordCount = wordCount(email.body);

      if (redactionCount > 0) {
        redactedEmails++;
        totalRedactionHits += redactionCount;
      }
    }

    processed++;
    totalWords += email.wordCount;

    const readableLabels = email.labels
      .map((id) => labelMap.get(id) || id)
      .filter((name) => !name.startsWith("CATEGORY_"));

    console.log(`${processed}. ${email.subject || "(no subject)"}`);
    console.log(
      `   From: ${email.from} | ${email.wordCount} words | ${new Date(email.date).toLocaleDateString()}`,
    );
    console.log(`   Labels: ${readableLabels.join(", ")}`);
    if (redactionCount > 0) {
      console.log(`   Redacted: ${redactionSummary}`);
    }

    if (args.dryRun) {
      console.log(`   "${email.body.slice(0, 120)}..."`);
      console.log();
      continue;
    }

    const gmailLabels = email.labels
      .map((id) => labelMap.get(id) || id)
      .filter((name) => !name.startsWith("CATEGORY_"));

    const emailMeta: Record<string, unknown> = {
      gmail_labels: gmailLabels,
      gmail_id: email.gmailId,
      gmail_thread_id: email.threadId,
    };
    if (redactionCount > 0) {
      emailMeta.redaction_applied = true;
      emailMeta.redaction_count = redactionCount;
      emailMeta.redaction_labels = redactionLabels;
      emailMeta.redaction_version = redactionVersion;
    }

    const content = buildEmailContent(email.body, email.from, email.subject, email.date);
    const result = useEndpoint
      ? await ingestThoughtEndpoint(content, "gmail", emailMeta)
      : await ingestThoughtDirect(content, "gmail", emailMeta);

    if (result.ok) {
      ingested++;
      syncLog.ingested_ids[ref.id] = new Date().toISOString();
      const dupTag = result.duplicate ? " (duplicate — skipped)" : "";
      console.log(`   -> Ingested: ${result.type} — ${(result.topics || []).join(", ")}${dupTag}`);
    } else {
      errors++;
      console.error(`   -> ERROR: ${result.error}`);
    }

    console.log();
    await new Promise((r) => setTimeout(r, 200));
  }

  // Save sync log
  if (!args.dryRun) {
    syncLog.last_sync = new Date().toISOString();
    await saveSyncLog(syncLog);
  }

  // Summary
  console.log("\u2500".repeat(60));
  console.log("Summary:");
  console.log(`  Emails found:     ${messageRefs.length}`);
  if (alreadyIngested > 0) {
    console.log(`  Already ingested: ${alreadyIngested} (skipped)`);
  }
  console.log(`  Processed:        ${processed}`);
  console.log(`  Skipped (noise):  ${skipped}`);
  if (sensitiveSkipped > 0) {
    console.log(`  Skipped (sensitive): ${sensitiveSkipped}`);
  }
  if (redactedEmails > 0) {
    console.log(`  Redacted emails:  ${redactedEmails} (${totalRedactionHits} replacements)`);
  }
  console.log(`  Total words:      ${totalWords.toLocaleString()}`);
  if (!args.dryRun) {
    console.log(`  Ingested:         ${ingested}`);
    console.log(`  Errors:           ${errors}`);
  }

  const estimatedCost = (totalWords / 750) * 0.00002 + (processed * 0.00015);
  console.log(`  Est. API cost:    $${estimatedCost.toFixed(4)}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  Deno.exit(1);
});
