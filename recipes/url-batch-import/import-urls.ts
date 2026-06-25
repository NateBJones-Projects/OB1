#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

/**
 * Open Brain — URL Batch Import Script
 *
 * Fetches a list of URLs (news articles, blog posts, web pages), extracts
 * text content, generates embeddings and LLM summaries via OpenRouter, and
 * inserts each as a thought into Supabase with SHA-256 content fingerprint
 * dedup.
 *
 * Ingestion modes:
 *   Default:              Supabase direct insert (requires SUPABASE_URL,
 *                         SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY)
 *   --ingest-endpoint:    Custom endpoint (requires INGEST_URL, INGEST_KEY)
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-write --allow-env import-urls.ts --input=urls.txt
 *
 * Options:
 *   --input=path          Path to .txt or .csv file (required)
 *   --dry-run             Fetch and preview without writing to Open Brain
 *   --limit=N             Max URLs to process (default: all)
 *   --offset=N            Skip first N URLs — enables range batching (default: 0)
 *   --ingest-endpoint     Use INGEST_URL/INGEST_KEY instead of Supabase direct
 */

// ─── Configuration ────────────────────────────────────────────────────────────

const SYNC_LOG_PATH = "./sync-log.json";
const FAILURES_LOG_PATH = "./failures.log";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const INGEST_URL = Deno.env.get("INGEST_URL") || "";
const INGEST_KEY = Deno.env.get("INGEST_KEY") || "";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const FETCH_TIMEOUT_MS = 15_000;

// ─── Sync Log ─────────────────────────────────────────────────────────────────

interface SyncLog {
  ingested_urls: Record<string, string>; // url -> ISO timestamp
  last_sync: string;
}

async function loadSyncLog(): Promise<SyncLog> {
  try {
    const text = await Deno.readTextFile(SYNC_LOG_PATH);
    return JSON.parse(text);
  } catch {
    return { ingested_urls: {}, last_sync: "" };
  }
}

async function saveSyncLog(log: SyncLog): Promise<void> {
  await Deno.writeTextFile(SYNC_LOG_PATH, JSON.stringify(log, null, 2));
}

// ─── Content Fingerprint ──────────────────────────────────────────────────────

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function contentFingerprint(text: string): Promise<string> {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, " ");
  return await sha256(normalized);
}

// Tracking/query params that don't change article identity.
const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid", "ref", "ref_src", "ref_url",
  "igshid", "_ga", "yclid", "spm",
];

// Canonicalize a URL so the same article dedups regardless of tracking params,
// trailing slashes, fragments, or host casing.
function normalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl.trim());
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    u.protocol = u.protocol.toLowerCase();
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    // Drop any remaining utm_* defensively, then sort for stable ordering.
    for (const key of [...u.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    let path = u.pathname.replace(/\/+$/, "");
    if (path === "") path = "/";
    const query = u.searchParams.toString();
    return `${u.protocol}//${u.hostname}${path}${query ? "?" + query : ""}`.toLowerCase();
  } catch {
    // Not a parseable URL — fall back to a trimmed lowercase string.
    return rawUrl.trim().toLowerCase();
  }
}

// URL-stable fingerprint: identical URLs (modulo tracking params) hash identically
// across runs, so the DB unique constraint reliably rejects re-imports.
export async function urlFingerprint(rawUrl: string): Promise<string> {
  return await sha256(normalizeUrl(rawUrl));
}

// ─── CLI Argument Parsing ─────────────────────────────────────────────────────

interface CliArgs {
  input: string;
  dryRun: boolean;
  limit: number;
  offset: number;
  ingestEndpoint: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    input: "",
    dryRun: false,
    limit: Infinity,
    offset: 0,
    ingestEndpoint: false,
  };

  for (const arg of Deno.args) {
    if (arg.startsWith("--input=")) {
      args.input = arg.split("=").slice(1).join("=");
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg.startsWith("--limit=")) {
      args.limit = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--offset=")) {
      args.offset = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--ingest-endpoint") {
      args.ingestEndpoint = true;
    }
  }

  return args;
}

// ─── Input File Parsing ───────────────────────────────────────────────────────

interface UrlEntry {
  url: string;
  title?: string;
  category?: string;
  note?: string;
}

function parseTxt(text: string): UrlEntry[] {
  const entries: UrlEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    // Ignore blank lines and # comments silently.
    if (line.length === 0 || line.startsWith("#")) continue;
    // Non-URL lines (e.g. section markers like "START") are reported as
    // skipped rather than counted as fetch failures.
    if (!/^https?:\/\//i.test(line)) {
      console.log(`   Skipped (not a URL): ${line}`);
      continue;
    }
    entries.push({ url: line });
  }
  return entries;
}

function parseCsv(text: string): UrlEntry[] {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const urlIdx = headers.indexOf("url");
  if (urlIdx === -1) {
    console.error("CSV must have a 'url' column header.");
    Deno.exit(1);
  }

  const titleIdx = headers.indexOf("title");
  const categoryIdx = headers.indexOf("category");
  const noteIdx = headers.indexOf("note");

  const entries: UrlEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const url = cols[urlIdx];
    if (!url) continue;
    entries.push({
      url,
      title: titleIdx !== -1 ? cols[titleIdx] || undefined : undefined,
      category: categoryIdx !== -1 ? cols[categoryIdx] || undefined : undefined,
      note: noteIdx !== -1 ? cols[noteIdx] || undefined : undefined,
    });
  }
  return entries;
}

async function parseInputFile(path: string): Promise<UrlEntry[]> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    console.error(`Cannot read input file: ${path}`);
    Deno.exit(1);
  }

  if (path.toLowerCase().endsWith(".csv")) {
    return parseCsv(text);
  }
  return parseTxt(text);
}

// ─── Failures Log ─────────────────────────────────────────────────────────────

async function logFailure(url: string, reason: string): Promise<void> {
  const line = `[${new Date().toISOString()}] FAILED ${url} — ${reason}\n`;
  try {
    const existing = await Deno.readTextFile(FAILURES_LOG_PATH).catch(() => "");
    await Deno.writeTextFile(FAILURES_LOG_PATH, existing + line);
  } catch {
    // best-effort — don't crash the run if the log can't be written
  }
}

// ─── URL Fetch with Timeout ───────────────────────────────────────────────────

async function fetchUrl(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Present as a real browser. Many news/lifestyle sites bot-block
        // self-identifying scraper User-Agents with HTTP 403.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(timer);

    if (!res.ok) {
      await logFailure(url, `HTTP ${res.status}`);
      return null;
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      await logFailure(url, `Unsupported content-type: ${contentType}`);
      return null;
    }

    return await res.text();
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    await logFailure(url, msg);
    return null;
  }
}

// ─── HTML Text Extraction ─────────────────────────────────────────────────────

function extractText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, " ")
    .replace(/<\/?(p|div|h[1-6]|li|tr|br|blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ─── OpenRouter: Embedding ────────────────────────────────────────────────────

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

// ─── OpenRouter: Summary + Metadata ──────────────────────────────────────────

interface ArticleMetadata {
  title: string;
  summary: string;
  topics: string[];
  entities: string[];
  type: string;
}

async function extractSummaryAndMetadata(
  rawText: string,
  url: string,
  csvTitle?: string,
): Promise<ArticleMetadata> {
  const truncated = rawText.slice(0, 12000);
  const titleHint = csvTitle ? `The user labelled this article: "${csvTitle}". ` : "";

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
          content:
            `You extract structured data from web article text. ${titleHint}Return JSON with:
- "title": article title (from content, not the URL)
- "summary": 2-4 sentence summary of key points and takeaways
- "topics": array of 2-4 short topic tags (e.g. ["AI", "climate", "policy"])
- "entities": array of notable people, companies, or products mentioned (empty array if none)
- "type": one of "news", "analysis", "opinion", "tutorial", "research", "reference"
Only extract what is explicitly in the content.`,
        },
        {
          role: "user",
          content: `URL: ${url}\n\nContent:\n${truncated}`,
        },
      ],
    }),
  });

  const d = await res.json();
  try {
    const parsed = JSON.parse(d.choices[0].message.content);
    return {
      title: parsed.title || csvTitle || extractDomain(url),
      summary: parsed.summary || rawText.slice(0, 300),
      topics: Array.isArray(parsed.topics) ? parsed.topics : ["uncategorized"],
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      type: parsed.type || "reference",
    };
  } catch {
    return {
      title: csvTitle || extractDomain(url),
      summary: rawText.slice(0, 300),
      topics: ["uncategorized"],
      entities: [],
      type: "reference",
    };
  }
}

// ─── Content Builder ──────────────────────────────────────────────────────────

function buildContent(summary: string, title: string, domain: string, date: string): string {
  return `[URL Import | ${title} | ${domain} | ${date}]\n\n${summary}`;
}

// ─── Ingestion ────────────────────────────────────────────────────────────────

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
  extraMetadata: Record<string, unknown>,
): Promise<IngestResult> {
  const fingerprint = extraMetadata.url
    ? await urlFingerprint(extraMetadata.url as string)
    : await contentFingerprint(content);
  const embedding = await getEmbedding(content);

  const row: Record<string, unknown> = {
    content,
    embedding,
    metadata: { source, ...extraMetadata },
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

  if (res.status === 409) {
    return { ok: true, duplicate: true };
  }

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
      return {
        ok: true,
        id: Array.isArray(data) ? data[0]?.id : data?.id,
        type: extraMetadata.type as string,
        topics: extraMetadata.topics as string[],
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
  return {
    ok: true,
    id: Array.isArray(data) ? data[0]?.id : data?.id,
    type: extraMetadata.type as string,
    topics: extraMetadata.topics as string[],
  };
}

async function ingestThoughtEndpoint(
  content: string,
  source: string,
  extraMetadata: Record<string, unknown>,
): Promise<IngestResult> {
  const fingerprint = extraMetadata.url
    ? await urlFingerprint(extraMetadata.url as string)
    : await contentFingerprint(content);

  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ingest-key": INGEST_KEY,
    },
    body: JSON.stringify({
      content,
      source,
      content_fingerprint: fingerprint,
      extra_metadata: extraMetadata,
    }),
  });

  return (await res.json()) as IngestResult;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  if (!args.input) {
    console.error(
      "Usage: deno run --allow-net --allow-read --allow-write --allow-env import-urls.ts --input=urls.txt [options]",
    );
    console.error("       --dry-run         Preview without ingesting");
    console.error("       --limit=N         Max URLs to process");
    console.error("       --offset=N        Skip first N URLs (for range batching)");
    console.error("       --ingest-endpoint Use INGEST_URL/INGEST_KEY endpoint");
    Deno.exit(1);
  }

  const useEndpoint = args.ingestEndpoint;
  const ingestMode = args.dryRun
    ? "DRY RUN"
    : useEndpoint
    ? "Edge Function endpoint"
    : "Supabase direct insert";

  if (!args.dryRun) {
    if (useEndpoint) {
      if (!INGEST_URL || !INGEST_KEY) {
        console.error("\nINGEST_URL and INGEST_KEY are required with --ingest-endpoint.");
        Deno.exit(1);
      }
    } else {
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENROUTER_API_KEY) {
        console.error(
          "\nSUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and OPENROUTER_API_KEY are required.",
        );
        console.error("Copy .env.example to .env and fill in your values, then: source .env");
        Deno.exit(1);
      }
    }
  }

  const allEntries = await parseInputFile(args.input);
  const entries = allEntries.slice(args.offset, isFinite(args.limit) ? args.offset + args.limit : undefined);

  console.log(`\nURL Batch Import`);
  console.log(`  Input:  ${args.input}`);
  console.log(
    `  URLs:   ${allEntries.length} total, processing ${entries.length}` +
      (args.offset > 0 ? ` (offset=${args.offset})` : "") +
      (isFinite(args.limit) ? ` (limit=${args.limit})` : ""),
  );
  console.log(`  Mode:   ${ingestMode}\n`);

  const syncLog = await loadSyncLog();

  let processed = 0;
  let alreadySynced = 0;
  let fetchFailed = 0;
  let ingested = 0;
  let duplicates = 0;
  let errors = 0;

  for (const entry of entries) {
    const { url, title: csvTitle, category } = entry;

    if (syncLog.ingested_urls[url]) {
      alreadySynced++;
      continue;
    }

    processed++;
    console.log(`${processed}. ${url}`);

    const html = await fetchUrl(url);
    if (!html) {
      fetchFailed++;
      console.log(`   -> FETCH FAILED (logged to failures.log)\n`);
      continue;
    }

    const rawText = extractText(html);
    if (rawText.length < 100) {
      fetchFailed++;
      await logFailure(url, "Extracted text too short — likely a JS-rendered SPA");
      console.log(`   -> SKIPPED: insufficient extractable text (JS SPA?)\n`);
      continue;
    }

    const domain = extractDomain(url);
    const date = new Date().toISOString().split("T")[0];

    if (args.dryRun) {
      console.log(`   Domain:  ${domain}`);
      console.log(`   Preview: ${rawText.slice(0, 150).replace(/\n/g, " ")}...`);
      console.log();
      continue;
    }

    let articleMeta: ArticleMetadata;
    try {
      articleMeta = await extractSummaryAndMetadata(rawText, url, csvTitle);
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   -> LLM error: ${msg}\n`);
      continue;
    }

    const content = buildContent(articleMeta.summary, articleMeta.title, domain, date);
    const extraMeta: Record<string, unknown> = {
      url,
      domain,
      title: articleMeta.title,
      topics: articleMeta.topics,
      entities: articleMeta.entities,
      type: articleMeta.type,
      raw_text: rawText.slice(0, 8000),
    };
    if (category) extraMeta.category = category;

    let result: IngestResult;
    try {
      result = useEndpoint
        ? await ingestThoughtEndpoint(content, "url-import", extraMeta)
        : await ingestThoughtDirect(content, "url-import", extraMeta);
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   -> Ingest error: ${msg}\n`);
      continue;
    }

    if (result.ok) {
      if (result.duplicate) {
        duplicates++;
        // Record duplicates too — it's already in Open Brain, so skip it next run.
        syncLog.ingested_urls[url] = new Date().toISOString();
        console.log(`   -> Duplicate — already in Open Brain\n`);
      } else {
        ingested++;
        syncLog.ingested_urls[url] = new Date().toISOString();
        console.log(`   -> Ingested: ${articleMeta.type} — ${articleMeta.topics.join(", ")}\n`);
      }
      // Persist incrementally so an interrupted run doesn't lose dedup progress.
      syncLog.last_sync = new Date().toISOString();
      await saveSyncLog(syncLog);
    } else {
      errors++;
      console.error(`   -> ERROR: ${result.error}\n`);
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  if (!args.dryRun) {
    syncLog.last_sync = new Date().toISOString();
    await saveSyncLog(syncLog);
  }

  console.log("─".repeat(60));
  console.log("Summary:");
  console.log(`  Total in file:    ${allEntries.length}`);
  console.log(`  Processed:        ${processed}`);
  if (alreadySynced > 0) console.log(`  Already synced:   ${alreadySynced} (skipped)`);
  console.log(`  Fetch failed:     ${fetchFailed}`);
  if (!args.dryRun) {
    console.log(`  Ingested:         ${ingested}`);
    if (duplicates > 0) console.log(`  Duplicates:       ${duplicates} (skipped)`);
    if (errors > 0) console.log(`  Errors:           ${errors}`);
  }
  if (fetchFailed > 0) {
    console.log(`\n  Failed URLs saved to: ${FAILURES_LOG_PATH}`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    Deno.exit(1);
  });
}
