#!/usr/bin/env node
/**
 * Gemini Takeout Import for Open Brain (OB1-compatible)
 *
 * Parses Google Gemini AI conversation exports (HTML takeout format) and imports
 * each conversation entry as a thought with embeddings.
 *
 * Usage:
 *   node import-gemini.mjs /path/to/gemini-export.html [--dry-run] [--skip N] [--limit N]
 *
 * The HTML file comes from Google Takeout → Gemini Apps → My Activity.
 * Entries are separated by <div class="outer-cell"> elements.
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { config } from "dotenv";

config();

// ── Configuration ────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "openai/text-embedding-3-small";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENROUTER_API_KEY) {
  console.error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── CLI Arguments ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const skip = parseInt(args[args.indexOf("--skip") + 1]) || 0;
const limit = parseInt(args[args.indexOf("--limit") + 1]) || Infinity;

if (!filePath) {
  console.error("Usage: node import-gemini.mjs /path/to/gemini-export.html [--dry-run] [--skip N] [--limit N]");
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function contentFingerprint(text) {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function parseGeminiEntries(html) {
  // Split on outer-cell divs
  const cells = html.split(/class="outer-cell/);
  const entries = [];

  for (let i = 1; i < cells.length; i++) {
    const cell = cells[i];
    const text = stripHtml(cell);

    // Skip noise
    if (text.length < 20) continue;
    if (text.startsWith("Gave feedback:")) continue;

    // Extract prompt if present
    const promptMatch = text.match(/Prompted\s+(.+?)(?:\n|$)/);
    const prompt = promptMatch ? promptMatch[1].trim() : "";

    // Try to extract a timestamp
    const dateMatch = cell.match(/(\w+ \d+, \d{4},?\s*\d+:\d+:\d+\s*(?:AM|PM)?)/i);
    const timestamp = dateMatch ? new Date(dateMatch[1]).toISOString() : null;

    const content = prompt ? `Prompted: ${prompt}\n\n${text}` : text;
    entries.push({ content, timestamp, prompt });
  }

  return entries;
}

async function getEmbedding(text) {
  const truncated = text.length > 8000 ? text.substring(0, 8000) : text;
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: truncated }),
  });

  if (!response.ok) {
    const msg = await response.text().catch(() => "");
    throw new Error(`Embedding failed: ${response.status} ${msg}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function upsertThought(content, metadata, embedding, createdAt) {
  const { data, error } = await supabase.rpc("upsert_thought", {
    p_content: content,
    p_payload: {
      type: "reference",
      source_type: "gemini_import",
      importance: 3,
      quality_score: 50,
      sensitivity_tier: "standard",
      metadata: {
        ...metadata,
        source: "gemini_import",
        source_type: "gemini_import",
      },
      embedding: JSON.stringify(embedding),
      created_at: createdAt,
    },
  });

  if (error) throw new Error(`upsert_thought failed: ${error.message}`);
  return data;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Gemini Takeout Import`);
  console.log(`File: ${filePath}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE IMPORT"}`);
  console.log();

  const html = await readFile(filePath, "utf-8");
  console.log(`File size: ${(html.length / 1024 / 1024).toFixed(1)} MB`);

  const entries = parseGeminiEntries(html);
  console.log(`Found ${entries.length} Gemini entries`);

  const toProcess = entries.slice(skip, skip + limit);
  console.log(`Processing ${toProcess.length} entries (skip=${skip}, limit=${limit === Infinity ? "all" : limit})`);
  console.log();

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const entry = toProcess[i];

    try {
      if (entry.content.trim().length < 50) {
        skipped++;
        continue;
      }

      const fingerprint = contentFingerprint(entry.content);
      const createdAt = entry.timestamp || new Date().toISOString();
      const title = entry.prompt
        ? `Gemini: ${entry.prompt.substring(0, 80)}`
        : `Gemini entry (${createdAt.slice(0, 10)})`;

      if (dryRun) {
        console.log(`[${i + 1}/${toProcess.length}] Would import: "${title}" (${entry.content.length} chars)`);
        imported++;
        continue;
      }

      const embedding = await getEmbedding(entry.content);
      const result = await upsertThought(
        entry.content,
        { title, content_fingerprint: fingerprint },
        embedding,
        createdAt
      );

      console.log(`[${i + 1}/${toProcess.length}] ${result.action}: #${result.thought_id} "${title}"`);
      imported++;
    } catch (err) {
      console.error(`[${i + 1}/${toProcess.length}] Error: ${err.message}`);
      errors++;
    }
  }

  console.log();
  console.log(`Done! Imported: ${imported}, Skipped: ${skipped}, Errors: ${errors}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
