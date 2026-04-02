#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

/**
 * Open Brain — Outlook Pull Script
 *
 * Fetches emails from Outlook via Microsoft Graph API, cleans them, generates
 * embeddings and metadata, and inserts each as a thought into Supabase with
 * SHA-256 content fingerprint dedup.
 *
 * Auth: Azure AD device code flow (no local server needed).
 *
 * Ingestion modes:
 *   Default:              Supabase direct insert (requires SUPABASE_URL,
 *                         SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY)
 *   --ingest-endpoint:    Custom endpoint (requires INGEST_URL, INGEST_KEY)
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-write --allow-env pull-outlook.ts [options]
 *
 * Options:
 *   --window=24h|7d|30d|90d|1y|all  Time window to fetch (default: 24h)
 *   --folders=Inbox,SentItems       Comma-separated folder names (default: SentItems)
 *   --importance=high|normal|low    Filter by importance (default: no filter)
 *   --dry-run                       Parse and show emails without ingesting
 *   --limit=N                       Max emails to process (default: 50)
 *   --list-folders                  List all mail folders and exit
 *   --ingest-endpoint               Use INGEST_URL/INGEST_KEY instead of Supabase direct
 *   --crm-only                      Only import emails from/to contacts in your CRM
 *   --skip-attachments              Skip attachment processing (email bodies only)
 */

// ─── Configuration ───────────────────────────────────────────────────────────

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const TOKEN_PATH = `${SCRIPT_DIR}token.json`;
const SYNC_LOG_PATH = `${SCRIPT_DIR}sync-log.json`;

const GRAPH_API = "https://graph.microsoft.com/v1.0";
const SCOPES = ["https://graph.microsoft.com/Mail.Read", "offline_access"];

// Microsoft Azure AD
const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID") || "";
const MICROSOFT_TENANT_ID = Deno.env.get("MICROSOFT_TENANT_ID") || "common";

// Supabase direct insert (default mode)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";

// Edge Function endpoint (--ingest-endpoint mode)
const INGEST_URL = Deno.env.get("INGEST_URL") || "";
const INGEST_KEY = Deno.env.get("INGEST_KEY") || "";

// CRM integration
const DEFAULT_USER_ID = Deno.env.get("DEFAULT_USER_ID") || "";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// ─── Sync Log (deduplication) ────────────────────────────────────────────────

interface SyncLog {
  ingested_ids: Record<string, string>; // outlook_message_id -> ISO timestamp
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

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

interface CliArgs {
  window: string;
  folders: string[];
  dryRun: boolean;
  limit: number;
  listFolders: boolean;
  ingestEndpoint: boolean;
  importance: string | null;
  crmOnly: boolean;
  skipAttachments: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    window: "24h",
    folders: ["SentItems"],
    dryRun: false,
    limit: 50,
    listFolders: false,
    ingestEndpoint: false,
    importance: null,
    crmOnly: false,
    skipAttachments: false,
  };

  for (const arg of Deno.args) {
    if (arg.startsWith("--window=")) {
      args.window = arg.split("=")[1];
    } else if (arg.startsWith("--folders=")) {
      args.folders = arg.split("=")[1].split(",").map((f) => f.trim());
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg.startsWith("--limit=")) {
      args.limit = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--list-folders") {
      args.listFolders = true;
    } else if (arg === "--ingest-endpoint") {
      args.ingestEndpoint = true;
    } else if (arg.startsWith("--importance=")) {
      args.importance = arg.split("=")[1].toLowerCase();
    } else if (arg === "--crm-only") {
      args.crmOnly = true;
    } else if (arg === "--skip-attachments") {
      args.skipAttachments = true;
    }
  }

  return args;
}

// ─── OAuth2 Device Code Flow ────────────────────────────────────────────────

interface TokenData {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
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

async function refreshAccessToken(token: TokenData): Promise<TokenData> {
  const tokenUrl = `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token",
      scope: SCOPES.join(" "),
    }),
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
  }

  const updated: TokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || token.refresh_token,
    token_type: data.token_type,
    expiry_date: Date.now() + data.expires_in * 1000,
  };
  await saveToken(updated);
  return updated;
}

async function deviceCodeAuth(): Promise<TokenData> {
  const deviceCodeUrl = `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/devicecode`;
  const tokenUrl = `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;

  // Step 1: Request device code
  const dcRes = await fetch(deviceCodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      scope: SCOPES.join(" "),
    }),
  });

  const dcData = await dcRes.json();
  if (dcData.error) {
    throw new Error(`Device code request failed: ${dcData.error_description || dcData.error}`);
  }

  console.log(`\n${dcData.message}\n`);

  // Step 2: Poll for token
  let interval = dcData.interval || 5;
  const expiresAt = Date.now() + (dcData.expires_in || 900) * 1000;

  while (Date.now() < expiresAt) {
    await new Promise((r) => setTimeout(r, interval * 1000));

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        device_code: dcData.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const tokenData = await tokenRes.json();
    console.log(`   Poll response: ${tokenData.error || "success"}`);

    if (tokenData.error === "authorization_pending") {
      continue;
    }

    if (tokenData.error === "slow_down") {
      interval += 5;
      continue;
    }

    if (tokenData.error) {
      console.error(`   Full error: ${JSON.stringify(tokenData)}`);
      throw new Error(`Authorization failed: ${tokenData.error_description || tokenData.error}`);
    }

    // Success
    const newToken: TokenData = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_type: tokenData.token_type,
      expiry_date: Date.now() + tokenData.expires_in * 1000,
    };
    await saveToken(newToken);
    console.log("Authorization successful! Token saved.\n");
    return newToken;
  }

  throw new Error("Device code flow expired. Please try again.");
}

async function authorize(): Promise<string> {
  let token = await loadToken();

  if (token) {
    if (Date.now() < token.expiry_date - 60_000) {
      return token.access_token;
    }
    console.log("Access token expired, refreshing...");
    try {
      token = await refreshAccessToken(token);
      return token.access_token;
    } catch (err) {
      console.log(`Refresh failed (${err instanceof Error ? err.message : err}), re-authenticating...`);
    }
  }

  const newToken = await deviceCodeAuth();
  return newToken.access_token;
}

// ─── Graph API Helpers ──────────────────────────────────────────────────────

async function graphFetch(accessToken: string, path: string, retries = 2): Promise<unknown> {
  const res = await fetch(`${GRAPH_API}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.body-content-type="text"',
    },
  });

  // Handle rate limiting with retry
  if (res.status === 429 && retries > 0) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
    console.log(`   Rate limited — retrying in ${retryAfter}s...`);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return graphFetch(accessToken, path, retries - 1);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph API error ${res.status}: ${body}`);
  }
  return res.json();
}

interface GraphMailFolder {
  id: string;
  displayName: string;
  totalItemCount: number;
  childFolderCount: number;
}

async function listFolders(accessToken: string): Promise<GraphMailFolder[]> {
  const folders: GraphMailFolder[] = [];
  let url = "/me/mailFolders?$top=100";

  while (url) {
    const data = (await graphFetch(accessToken, url)) as {
      value: GraphMailFolder[];
      "@odata.nextLink"?: string;
    };
    folders.push(...data.value);
    url = data["@odata.nextLink"]
      ? data["@odata.nextLink"].replace(GRAPH_API, "")
      : "";
  }

  return folders;
}

// Well-known folder names that Graph accepts directly in the URL path
const WELL_KNOWN_FOLDERS: Record<string, string> = {
  inbox: "Inbox",
  sentitems: "SentItems",
  drafts: "Drafts",
  deleteditems: "DeletedItems",
  junkemail: "JunkEmail",
  archive: "Archive",
  outbox: "Outbox",
};

async function resolveFolderId(
  accessToken: string,
  name: string,
  allFolders: GraphMailFolder[],
): Promise<{ id: string; displayName: string } | null> {
  // Check well-known names first (case-insensitive)
  const normalized = name.toLowerCase().replace(/[\s_-]/g, "");
  for (const [key, wellKnown] of Object.entries(WELL_KNOWN_FOLDERS)) {
    if (normalized === key || normalized === wellKnown.toLowerCase()) {
      try {
        const folder = (await graphFetch(accessToken, `/me/mailFolders/${wellKnown}`)) as GraphMailFolder;
        return { id: folder.id, displayName: folder.displayName };
      } catch {
        // Fall through to display name search
      }
    }
  }

  // Try exact well-known name as path
  if (name === name.replace(/[^a-zA-Z]/g, "")) {
    try {
      const folder = (await graphFetch(accessToken, `/me/mailFolders/${name}`)) as GraphMailFolder;
      return { id: folder.id, displayName: folder.displayName };
    } catch {
      // Fall through
    }
  }

  // Search by display name in the pre-fetched list
  const match = allFolders.find(
    (f) => f.displayName.toLowerCase() === name.toLowerCase(),
  );
  if (match) return { id: match.id, displayName: match.displayName };

  return null;
}

function windowToFilter(window: string): string {
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
    case "180d":
    case "6m":
      after = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
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

  return `receivedDateTime ge ${after.toISOString()}`;
}

interface GraphMessage {
  id: string;
  conversationId: string;
  subject: string;
  from: { emailAddress: { name: string; address: string } };
  toRecipients: Array<{ emailAddress: { name: string; address: string } }>;
  receivedDateTime: string;
  body: { contentType: string; content: string };
  importance: string;
  parentFolderId: string;
  hasAttachments: boolean;
}

async function listMessagesForFolder(
  accessToken: string,
  folderId: string,
  filter: string,
  importance: string | null,
  limit: number,
): Promise<GraphMessage[]> {
  const messages: GraphMessage[] = [];
  const select = "id,subject,from,toRecipients,receivedDateTime,body,importance,conversationId,parentFolderId,hasAttachments";

  // Build OData filter
  const filters: string[] = [];
  if (filter) filters.push(filter);
  if (importance) filters.push(`importance eq '${importance}'`);
  const filterParam = filters.length > 0 ? `&$filter=${encodeURIComponent(filters.join(" and "))}` : "";

  let url = `/me/mailFolders/${folderId}/messages?$top=${Math.min(50, limit)}&$select=${select}&$orderby=receivedDateTime desc${filterParam}`;

  while (url && messages.length < limit) {
    const data = (await graphFetch(accessToken, url)) as {
      value: GraphMessage[];
      "@odata.nextLink"?: string;
    };
    messages.push(...data.value);
    url = data["@odata.nextLink"]
      ? data["@odata.nextLink"].replace(GRAPH_API, "")
      : "";
  }

  return messages.slice(0, limit);
}

async function listAllMessages(
  accessToken: string,
  folderIds: Array<{ id: string; displayName: string }>,
  filter: string,
  importance: string | null,
  limit: number,
): Promise<GraphMessage[]> {
  const seen = new Set<string>();
  const allMessages: GraphMessage[] = [];

  for (const folder of folderIds) {
    const messages = await listMessagesForFolder(accessToken, folder.id, filter, importance, limit);
    for (const msg of messages) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        allMessages.push(msg);
      }
    }
  }

  return allMessages.slice(0, limit);
}

// ─── Email Body Extraction ──────────────────────────────────────────────────

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

function extractBody(msg: GraphMessage): string {
  if (!msg.body || !msg.body.content) return "";

  if (msg.body.contentType.toLowerCase() === "text") {
    return msg.body.content;
  }

  return htmlToText(msg.body.content);
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
    // Outlook-specific reply markers
    if (/^From:\s.+\nSent:\s/im.test(lines.slice(i, i + 3).join("\n")) && cleaned.length > 0) break;

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
      if (/^(regards|best|thanks|cheers|sincerely|sent from|kind regards|warm regards|many thanks)/i.test(lines[i].trim())) {
        cleaned.push(lines[i]);
        break;
      }
      if (remaining.includes("sent from my iphone") || remaining.includes("sent from my ipad") || remaining.includes("sent from outlook")) {
        break;
      }
    }

    cleaned.push(lines[i]);
  }

  return cleaned.join("\n").trim();
}

// ─── Email Processing ───────────────────────────────────────────────────────

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

interface ProcessedEmail {
  outlookId: string;
  conversationId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  folders: string[];
  body: string;
  wordCount: number;
  importance: string;
}

function isAutoGenerated(msg: GraphMessage, body: string): boolean {
  const subject = (msg.subject || "").toLowerCase();
  const fromAddress = msg.from?.emailAddress?.address?.toLowerCase() || "";

  if (subject === "unsubscribe") return true;
  if (/reacted via/i.test(body)) return true;
  if (/this message was automatically generated/i.test(body)) return true;

  const noiseFromPatterns = [
    "no-reply", "noreply", "no.reply", "automated@", "donotreply",
    "notifications@", "mailer-daemon", "postmaster@",
    "microsoft-noreply@", "msonlineservicesteam@", "microsoftteams@",
  ];
  if (noiseFromPatterns.some((p) => fromAddress.includes(p))) return true;

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

function processEmail(
  msg: GraphMessage,
  folderMap: Map<string, string>,
): ProcessedEmail | null {
  let body = extractBody(msg);
  if (!body.trim()) return null;

  if (isAutoGenerated(msg, body)) return null;

  body = stripQuotedReplies(body);
  body = stripSignature(body);

  if (!body.trim() || wordCount(body) < 10) return null;

  const fromName = msg.from?.emailAddress?.name || "";
  const fromAddr = msg.from?.emailAddress?.address || "";
  const from = fromName ? `${fromName} <${fromAddr}>` : fromAddr;

  const to = (msg.toRecipients || [])
    .map((r) => {
      const n = r.emailAddress?.name || "";
      const a = r.emailAddress?.address || "";
      return n ? `${n} <${a}>` : a;
    })
    .join(", ");

  const folderName = folderMap.get(msg.parentFolderId) || msg.parentFolderId;

  return {
    outlookId: msg.id,
    conversationId: msg.conversationId,
    from,
    to,
    subject: msg.subject || "(no subject)",
    date: msg.receivedDateTime,
    folders: [folderName],
    body,
    wordCount: wordCount(body),
    importance: msg.importance || "normal",
  };
}

// ─── Embedding & Metadata (Supabase direct mode) ────────────────────────────

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

// ─── Ingestion ──────────────────────────────────────────────────────────────

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

// ─── CRM Integration ────────────────────────────────────────────────────────

interface CrmContact {
  id: string;
  name: string;
  email: string;
  company: string | null;
}

async function loadCrmContacts(): Promise<CrmContact[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/professional_contacts?select=id,name,email,company&user_id=eq.${DEFAULT_USER_ID}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to load CRM contacts: ${res.status} ${body}`);
  }

  return (await res.json()) as CrmContact[];
}

function extractEmailAddress(fromField: string): string {
  const match = fromField.match(/<([^>]+)>/);
  return (match ? match[1] : fromField).toLowerCase().trim();
}

function extractAllEmailAddresses(email: ProcessedEmail): string[] {
  const addresses: string[] = [];
  addresses.push(extractEmailAddress(email.from));
  if (email.to) {
    for (const recipient of email.to.split(",")) {
      addresses.push(extractEmailAddress(recipient.trim()));
    }
  }
  return addresses;
}

function matchContactByEmail(
  emailAddresses: string[],
  contacts: CrmContact[],
): CrmContact | null {
  for (const addr of emailAddresses) {
    const match = contacts.find(
      (c) => c.email && c.email.toLowerCase().trim() === addr,
    );
    if (match) return match;
  }
  return null;
}

async function logCrmInteraction(
  contact: CrmContact,
  email: ProcessedEmail,
): Promise<void> {
  const summary = `Email: ${email.subject} (${new Date(email.date).toLocaleDateString()})`;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/contact_interactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      contact_id: contact.id,
      user_id: DEFAULT_USER_ID,
      interaction_type: "email",
      occurred_at: email.date,
      summary,
      follow_up_needed: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`   -> CRM interaction log failed: ${res.status} ${body}`);
  }
}

// ─── Attachment Processing ───────────────────────────────────────────────────

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "pptx", "md", "txt"]);
const SKIP_ATTACHMENT_CONTENT_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/bmp", "image/svg+xml",
  "image/webp", "image/tiff", "image/x-icon",
]);
const SIGNATURE_FILE_PATTERNS = [
  /^image\d{3}\.\w+$/i, /^logo[._-]/i, /^banner[._-]/i,
  /^signature[._-]/i, /^icon[._-]/i, /^spacer\.\w+$/i, /^pixel\.\w+$/i,
];
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

interface GraphAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  contentBytes: string;
}

interface AttachmentProcessResult {
  processed: Array<{ filename: string; fileType: string; wordCount: number; documentId: string }>;
  skipped: number;
  errors: string[];
}

function getAttachmentFileType(filename: string): string {
  return (filename.split(".").pop() || "").toLowerCase();
}

function shouldProcessAttachment(att: { name: string; contentType: string; size: number }): boolean {
  const ext = getAttachmentFileType(att.name);
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)) return false;
  if (SKIP_ATTACHMENT_CONTENT_TYPES.has(att.contentType.toLowerCase())) return false;
  if (att.size > MAX_ATTACHMENT_SIZE) return false;
  if (SIGNATURE_FILE_PATTERNS.some(p => p.test(att.name))) return false;
  return true;
}

async function fetchGraphAttachments(accessToken: string, messageId: string): Promise<GraphAttachment[]> {
  const data = (await graphFetch(accessToken, `/me/messages/${messageId}/attachments`)) as {
    value: Array<Record<string, unknown>>;
  };
  return (data.value || []).filter(
    a => a["@odata.type"] === "#microsoft.graph.fileAttachment" && a.contentBytes,
  ) as unknown as GraphAttachment[];
}

async function extractAttachmentText(
  bytes: Uint8Array,
  fileType: string,
): Promise<{ text: string; pages: number }> {
  if (fileType === "pdf") {
    try {
      const { extractText: pdfExtract } = await import("npm:unpdf@0.12.1");
      const result = await pdfExtract(bytes, { mergePages: true });
      const text = Array.isArray(result.text) ? result.text.join("\n\n") : (result.text || "");
      return { text, pages: result.totalPages || 1 };
    } catch {
      const str = new TextDecoder("latin1").decode(bytes);
      const textParts: string[] = [];
      const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
      let match;
      while ((match = streamRegex.exec(str)) !== null) {
        for (const tj of match[1].matchAll(/\(([^)]*)\)\s*Tj/g)) textParts.push(tj[1]);
        for (const td of match[1].matchAll(/\[([^\]]*)\]\s*TJ/g)) {
          for (const it of td[1].matchAll(/\(([^)]*)\)/g)) textParts.push(it[1]);
        }
      }
      const pageMatches = str.match(/\/Type\s*\/Page[^s]/g);
      return { text: textParts.join(" "), pages: pageMatches?.length || 1 };
    }
  }

  const { unzipSync } = await import("npm:fflate@0.8.2");

  if (fileType === "docx") {
    const files = unzipSync(bytes);
    const docXml = files["word/document.xml"];
    if (!docXml) throw new Error("Invalid DOCX");
    const xml = new TextDecoder().decode(docXml);
    const parts: string[] = [];
    let current = "";
    for (const m of xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<\/w:p>/g)) {
      if (m[0] === "</w:p>") { if (current.trim()) parts.push(current.trim()); current = ""; }
      else current += m[1];
    }
    if (current.trim()) parts.push(current.trim());
    return { text: parts.join("\n"), pages: 1 };
  }

  if (fileType === "xlsx") {
    const files = unzipSync(bytes);
    const sharedData = files["xl/sharedStrings.xml"];
    const strings: string[] = [];
    if (sharedData) {
      for (const m of new TextDecoder().decode(sharedData).matchAll(/<t[^>]*>([^<]*)<\/t>/g)) strings.push(m[1]);
    }
    const values: string[] = [];
    for (const [path, data] of Object.entries(files)) {
      if (path.startsWith("xl/worksheets/sheet") && path.endsWith(".xml")) {
        for (const m of new TextDecoder().decode(data as Uint8Array).matchAll(/<v>([^<]*)<\/v>/g)) values.push(m[1]);
      }
    }
    return { text: [...strings, ...values].join(" "), pages: 1 };
  }

  if (fileType === "pptx") {
    const files = unzipSync(bytes);
    const texts: string[] = [];
    for (const [path, data] of Object.entries(files)) {
      if (/^ppt\/slides\/slide\d+\.xml$/.test(path)) {
        for (const m of new TextDecoder().decode(data as Uint8Array).matchAll(/<a:t>([^<]*)<\/a:t>/g)) texts.push(m[1]);
      }
    }
    return { text: texts.join("\n"), pages: 1 };
  }

  // md, txt
  return { text: new TextDecoder().decode(bytes), pages: 1 };
}

function chunkAttachmentText(text: string, maxWords = 4000, overlap = 200): string[] {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + maxWords, words.length);
    chunks.push(words.slice(start, end).join(" "));
    start = end - overlap;
    if (start >= words.length - overlap) break;
  }
  return chunks;
}

function slugifyStr(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

async function processEmailAttachments(
  accessToken: string,
  messageId: string,
  emailSubject: string,
  emailFrom: string,
  emailDate: string,
  contactMatch: CrmContact | null,
): Promise<AttachmentProcessResult> {
  const result: AttachmentProcessResult = { processed: [], skipped: 0, errors: [] };

  let attachments: GraphAttachment[];
  try {
    attachments = await fetchGraphAttachments(accessToken, messageId);
  } catch (err) {
    result.errors.push(`Fetch: ${(err as Error).message}`);
    return result;
  }

  for (const att of attachments) {
    if (!shouldProcessAttachment(att)) { result.skipped++; continue; }

    try {
      const fileType = getAttachmentFileType(att.name);

      // Check for existing document
      const checkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/documents?email_message_id=eq.${encodeURIComponent(messageId)}&filename=eq.${encodeURIComponent(att.name)}&select=id&limit=1`,
        { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
      );
      if (checkRes.ok) {
        const existing = await checkRes.json();
        if (existing?.length) { result.skipped++; continue; }
      }

      // Decode base64 to Uint8Array (copy to fresh buffer to avoid detached ArrayBuffer issues)
      const binaryStr = atob(att.contentBytes);
      const buffer = new ArrayBuffer(binaryStr.length);
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      // Create a copy so the buffer isn't shared/detached during extraction
      const bytesCopy = bytes.slice();

      // Extract text (use copy to avoid detached buffer)
      const extracted = await extractAttachmentText(bytesCopy, fileType);
      const fullText = (extracted.text || "").toString();
      const pages = extracted.pages || 1;
      if (!fullText || fullText.trim().length < 10) { result.skipped++; continue; }
      const wc = wordCount(fullText);

      // Upload to Supabase Storage (use original bytes)
      const storagePath = `email-attachments/${slugifyStr(emailSubject || "untitled")}/${Date.now()}_${att.name}`;
      const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/documents/${storagePath}`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": att.contentType,
          "x-upsert": "false",
        },
        body: bytes,
      });
      if (!uploadRes.ok) {
        const uploadBody = await uploadRes.text();
        throw new Error(`Storage upload: ${uploadRes.status} ${uploadBody}`);
      }

      // Chunk, embed, insert as thoughts
      const chunks = chunkAttachmentText(fullText);
      const thoughtIds: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunkContent = i === 0
          ? `[Attachment: ${att.name} | From email: ${emailFrom} | Subject: ${emailSubject} | Date: ${emailDate}]\n\n${chunks[i]}`
          : chunks[i];

        const [embedding, metadata] = await Promise.all([
          getEmbedding(chunkContent),
          i === 0 ? extractMetadata(chunkContent) : Promise.resolve({ topics: ["document", "email-attachment"], type: "reference" }),
        ]);

        const thoughtRow: Record<string, unknown> = {
          content: chunkContent,
          embedding,
          metadata: {
            ...metadata,
            source: "email-attachment",
            email_message_id: messageId,
            document_filename: att.name,
            ...(contactMatch ? { crm_contact_id: contactMatch.id, crm_contact_name: contactMatch.name } : {}),
          },
        };

        const thoughtRes = await fetch(`${SUPABASE_URL}/rest/v1/thoughts`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer: "return=representation",
          },
          body: JSON.stringify(thoughtRow),
        });
        if (!thoughtRes.ok) throw new Error(`Thought insert: ${thoughtRes.status}`);
        const thoughtData = await thoughtRes.json();
        thoughtIds.push(Array.isArray(thoughtData) ? thoughtData[0].id : thoughtData.id);

        if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 200));
      }

      // Insert documents record
      const docRow: Record<string, unknown> = {
        filename: att.name,
        file_type: fileType,
        file_size_bytes: bytes.length,
        storage_path: storagePath,
        full_text: fullText,
        page_count: pages,
        word_count: wc,
        thought_id: thoughtIds[0],
        chunk_thought_ids: thoughtIds.slice(1),
        email_message_id: messageId,
        description: `Email attachment from: ${emailFrom} | Subject: ${emailSubject}`,
        tags: ["email-attachment"],
        ...(contactMatch ? { contact_id: contactMatch.id } : {}),
      };

      const docRes = await fetch(`${SUPABASE_URL}/rest/v1/documents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify(docRow),
      });
      if (!docRes.ok) throw new Error(`Document insert: ${docRes.status}`);
      const docData = await docRes.json();
      const docId = Array.isArray(docData) ? docData[0].id : docData.id;

      result.processed.push({ filename: att.name, fileType, wordCount: wc, documentId: docId });
    } catch (err) {
      result.errors.push(`${att.name}: ${(err as Error).message}`);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  return result;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  if (!MICROSOFT_CLIENT_ID) {
    console.error("\nMICROSOFT_CLIENT_ID is required.");
    console.error("Register an app at https://portal.azure.com > App registrations");
    console.error("Then: export MICROSOFT_CLIENT_ID=your-application-client-id\n");
    Deno.exit(1);
  }

  const accessToken = await authorize();

  // --list-folders mode
  if (args.listFolders) {
    const folders = await listFolders(accessToken);
    console.log("\nMail Folders:\n");
    const sorted = folders.sort((a, b) => a.displayName.localeCompare(b.displayName));
    for (const folder of sorted) {
      console.log(`  ${folder.displayName.padEnd(30)} ${folder.totalItemCount} messages`);
    }
    return;
  }

  // Build folder map for display names
  const allFolders = await listFolders(accessToken);
  const folderMap = new Map<string, string>();
  for (const f of allFolders) {
    folderMap.set(f.id, f.displayName);
  }

  // Resolve requested folder names to IDs
  const resolvedFolders: Array<{ id: string; displayName: string }> = [];
  for (const name of args.folders) {
    const resolved = await resolveFolderId(accessToken, name, allFolders);
    if (!resolved) {
      console.error(`\nFolder not found: "${name}"`);
      console.error("Run with --list-folders to see available folders.");
      Deno.exit(1);
    }
    resolvedFolders.push(resolved);
  }

  // Determine ingestion mode
  const useEndpoint = args.ingestEndpoint;
  const ingestMode = args.dryRun ? "DRY RUN" : useEndpoint ? "Edge Function endpoint" : "Supabase direct insert";

  // Load CRM contacts if --crm-only
  let crmContacts: CrmContact[] = [];
  if (args.crmOnly) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("\nSUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --crm-only.");
      Deno.exit(1);
    }
    if (!DEFAULT_USER_ID) {
      console.error("\nDEFAULT_USER_ID is required for --crm-only.");
      console.error("This is your CRM user ID. Set it: export DEFAULT_USER_ID=your-uuid");
      Deno.exit(1);
    }
    crmContacts = await loadCrmContacts();
    console.log(`\nLoaded ${crmContacts.length} CRM contacts for filtering.`);
    const withEmail = crmContacts.filter((c) => c.email);
    console.log(`  ${withEmail.length} contacts have email addresses.`);
  }

  // Build time window filter
  const filter = windowToFilter(args.window);
  console.log(`\nFetching emails...`);
  console.log(`  Folders:    ${resolvedFolders.map((f) => f.displayName).join(", ")}`);
  console.log(`  Window:     ${args.window}${filter ? ` (${filter})` : ""}`);
  if (args.importance) console.log(`  Importance: ${args.importance}`);
  if (args.crmOnly) console.log(`  Filter:     CRM contacts only`);
  console.log(`  Limit:      ${args.limit}`);
  console.log(`  Mode:       ${ingestMode}`);

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
  const messages = await listAllMessages(accessToken, resolvedFolders, filter, args.importance, args.limit);
  console.log(`\nFound ${messages.length} messages.\n`);

  if (messages.length === 0) return;

  let processed = 0;
  let skipped = 0;
  let skippedNoCrm = 0;
  let alreadyIngested = 0;
  let ingested = 0;
  let interactions = 0;
  let errors = 0;
  let totalWords = 0;
  let attachmentsProcessed = 0;
  let attachmentsSkipped = 0;
  let attachmentErrors = 0;

  // Attachment processing requires Supabase direct mode (not endpoint mode)
  const canProcessAttachments = !useEndpoint && !args.skipAttachments &&
    SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && OPENROUTER_API_KEY;

  for (const msg of messages) {
    if (syncLog.ingested_ids[msg.id]) {
      alreadyIngested++;
      continue;
    }

    const email = processEmail(msg, folderMap);

    // Even if the email body is noise/empty, attachments may be valuable
    if (!email && !(msg.hasAttachments && canProcessAttachments)) {
      skipped++;
      continue;
    }

    // CRM filtering: skip emails not from/to a CRM contact
    let matchedContact: CrmContact | null = null;
    if (args.crmOnly && email) {
      const addresses = extractAllEmailAddresses(email);
      matchedContact = matchContactByEmail(addresses, crmContacts);
      if (!matchedContact) {
        skippedNoCrm++;
        continue;
      }
    }

    // Extract basic info for display/attachment metadata even when body is skipped
    const fromName = msg.from?.emailAddress?.name || "";
    const fromAddr = msg.from?.emailAddress?.address || "";
    const msgFrom = fromName ? `${fromName} <${fromAddr}>` : fromAddr;
    const msgSubject = msg.subject || "(no subject)";
    const msgDate = msg.receivedDateTime;

    processed++;
    if (email) totalWords += email.wordCount;

    console.log(`${processed}. ${msgSubject}`);
    console.log(
      `   From: ${msgFrom} | ${email ? email.wordCount : 0} words | ${new Date(msgDate).toLocaleDateString()}`,
    );
    if (email) {
      const folderName = folderMap.get(msg.parentFolderId) || msg.parentFolderId;
      console.log(`   Folder: ${folderName} | Importance: ${msg.importance || "normal"}`);
    } else {
      console.log(`   Body: skipped (noise/empty) — processing attachments only`);
    }
    if (matchedContact) {
      console.log(`   CRM Match: ${matchedContact.name}${matchedContact.company ? ` (${matchedContact.company})` : ""}`);
    }

    if (args.dryRun) {
      if (email) console.log(`   "${email.body.slice(0, 120)}..."`);
      if (msg.hasAttachments) console.log(`   Has attachments: yes`);
      console.log();
      continue;
    }

    let emailIngested = false;

    // Ingest email body if it passed filters
    if (email) {
      const outlookMeta: Record<string, unknown> = {
        outlook_folders: email.folders,
        outlook_id: email.outlookId,
        outlook_conversation_id: email.conversationId,
        outlook_importance: email.importance,
      };

      if (matchedContact) {
        outlookMeta.crm_contact_id = matchedContact.id;
        outlookMeta.crm_contact_name = matchedContact.name;
        if (matchedContact.company) outlookMeta.crm_contact_company = matchedContact.company;
      }

      const content = buildEmailContent(email.body, email.from, email.subject, email.date);
      const result = useEndpoint
        ? await ingestThoughtEndpoint(content, "outlook", outlookMeta)
        : await ingestThoughtDirect(content, "outlook", outlookMeta);

      if (result.ok) {
        ingested++;
        emailIngested = true;
        const dupTag = result.duplicate ? " (duplicate — skipped)" : "";
        console.log(`   -> Ingested: ${result.type} — ${(result.topics || []).join(", ")}${dupTag}`);

        if (matchedContact && !result.duplicate) {
          await logCrmInteraction(matchedContact, email);
          interactions++;
          console.log(`   -> CRM: Logged interaction with ${matchedContact.name}`);
        }
      } else {
        errors++;
        console.error(`   -> ERROR: ${result.error}`);
      }
    }

    // Process attachments (independent of email body ingestion)
    let attachmentsOk = true;
    if (msg.hasAttachments && canProcessAttachments) {
      const attResult = await processEmailAttachments(
        accessToken, msg.id, msgSubject, msgFrom, msgDate, matchedContact,
      );
      if (attResult.processed.length) {
        for (const a of attResult.processed) {
          console.log(`   -> Attachment: ${a.filename} (${a.fileType}, ${a.wordCount} words)`);
        }
        attachmentsProcessed += attResult.processed.length;
      }
      attachmentsSkipped += attResult.skipped;
      if (attResult.errors.length) {
        for (const e of attResult.errors) console.error(`   -> Attachment error: ${e}`);
        attachmentErrors += attResult.errors.length;
        attachmentsOk = false;
      }
    }

    // Only mark as ingested if both email and attachments succeeded
    if (emailIngested || !email) {
      if (attachmentsOk || !msg.hasAttachments) {
        syncLog.ingested_ids[msg.id] = new Date().toISOString();
      }
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
  console.log(`  Emails found:     ${messages.length}`);
  if (alreadyIngested > 0) {
    console.log(`  Already ingested: ${alreadyIngested} (skipped)`);
  }
  console.log(`  Processed:        ${processed}`);
  console.log(`  Skipped (noise):  ${skipped}`);
  if (args.crmOnly) {
    console.log(`  Skipped (no CRM): ${skippedNoCrm}`);
  }
  console.log(`  Total words:      ${totalWords.toLocaleString()}`);
  if (!args.dryRun) {
    console.log(`  Ingested:         ${ingested}`);
    if (args.crmOnly) {
      console.log(`  CRM interactions: ${interactions}`);
    }
    if (!args.skipAttachments) {
      console.log(`  Attachments:      ${attachmentsProcessed} processed, ${attachmentsSkipped} skipped`);
      if (attachmentErrors > 0) console.log(`  Attach errors:    ${attachmentErrors}`);
    }
    console.log(`  Errors:           ${errors}`);
  }

  const estimatedCost = (totalWords / 750) * 0.00002 + (processed * 0.00015);
  console.log(`  Est. API cost:    $${estimatedCost.toFixed(4)}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  Deno.exit(1);
});
