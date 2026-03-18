#!/usr/bin/env node
/**
 * Grok Export Import for Open Brain (OB1-compatible)
 *
 * Parses xAI Grok conversation exports (JSON with MongoDB-style dates) and imports
 * each conversation as a thought with embeddings.
 *
 * Usage:
 *   node import-grok.mjs /path/to/grok-export.json [--dry-run] [--skip N] [--limit N]
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { config } from "dotenv";

config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "openai/text-embedding-3-small";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENROUTER_API_KEY) {
  console.error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const skip = parseInt(args[args.indexOf("--skip") + 1]) || 0;
const limit = parseInt(args[args.indexOf("--limit") + 1]) || Infinity;

if (!filePath) {
  console.error("Usage: node import-grok.mjs /path/to/grok-export.json [--dry-run] [--skip N] [--limit N]");
  process.exit(1);
}

function contentFingerprint(text) {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

function parseMongoDate(dateObj) {
  if (!dateObj) return null;
  if (dateObj.$date) {
    if (typeof dateObj.$date === "string") return dateObj.$date;
    if (dateObj.$date.$numberLong) return new Date(parseInt(dateObj.$date.$numberLong)).toISOString();
  }
  if (typeof dateObj === "string") return dateObj;
  return null;
}

function normalizeConversation(conv) {
  const title = conv.title || conv.name || "Untitled Grok Chat";
  const createdAt = parseMongoDate(conv.create_time || conv.createdAt) || new Date().toISOString();

  // Extract messages — Grok uses nested .conversation and .response structures
  const messages = [];
  const rawMessages = conv.conversation || conv.messages || conv.responses || [];

  for (const msg of rawMessages) {
    const sender = (msg.sender || msg.role || "unknown").toLowerCase();
    const text = (msg.message || msg.text || msg.content || "").trim();
    if (!text) continue;

    messages.push({
      role: sender === "user" || sender === "human" ? "USER" : "ASSISTANT",
      text,
    });
  }

  // Sort by timestamp if available
  if (rawMessages[0]?.timestamp) {
    // Already in order from the file typically
  }

  const transcript = messages.map((m) => `${m.role}: ${m.text}`).join("\n\n");
  const content = `Conversation title: ${title}\nConversation created at: ${createdAt}\n\n${transcript}`;

  return { title, createdAt, content };
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
      source_type: "grok_import",
      importance: 3,
      quality_score: 50,
      sensitivity_tier: "standard",
      metadata: { ...metadata, source: "grok_import", source_type: "grok_import" },
      embedding: JSON.stringify(embedding),
      created_at: createdAt,
    },
  });
  if (error) throw new Error(`upsert_thought failed: ${error.message}`);
  return data;
}

async function main() {
  console.log(`Grok Export Import`);
  console.log(`File: ${filePath}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE IMPORT"}`);
  console.log();

  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw);

  // Grok exports can have conversations at top level or nested
  const conversations = parsed.conversations || (Array.isArray(parsed) ? parsed : [parsed]);
  console.log(`Found ${conversations.length} conversations`);

  const toProcess = conversations.slice(skip, skip + limit);
  console.log(`Processing ${toProcess.length} (skip=${skip}, limit=${limit === Infinity ? "all" : limit})`);
  console.log();

  let imported = 0, skipped = 0, errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const conv = toProcess[i];
    try {
      const { title, createdAt, content } = normalizeConversation(conv);
      if (content.trim().length < 100) { skipped++; continue; }

      const truncated = content.length > 30000
        ? content.substring(0, 30000) + "\n\n[... truncated]"
        : content;
      const fingerprint = contentFingerprint(truncated);

      if (dryRun) {
        console.log(`[${i + 1}/${toProcess.length}] Would import: "${title}" (${truncated.length} chars)`);
        imported++;
        continue;
      }

      const embedding = await getEmbedding(truncated);
      const result = await upsertThought(
        truncated,
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

main().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
