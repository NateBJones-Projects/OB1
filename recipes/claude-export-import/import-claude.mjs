#!/usr/bin/env node
/**
 * Claude Export Import for Open Brain (OB1-compatible)
 *
 * Parses Anthropic Claude conversation exports (JSON format) and imports
 * each conversation as a thought with embeddings.
 *
 * Usage:
 *   node import-claude.mjs /path/to/claude-export.json [--dry-run] [--skip N] [--limit N]
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
  console.error("Usage: node import-claude.mjs /path/to/claude-export.json [--dry-run] [--skip N] [--limit N]");
  process.exit(1);
}

function contentFingerprint(text) {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

function extractMessageText(msg) {
  // Claude exports have content as array of {type, text} objects or direct text
  if (typeof msg.text === "string") return msg.text;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((c) => (typeof c === "string" ? c : c.text || ""))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof msg.content === "string") return msg.content;
  return "";
}

function normalizeConversation(conv) {
  const title = conv.name || conv.title || "Untitled";
  const createdAt = conv.created_at || new Date().toISOString();
  const conversationId = conv.uuid || conv.id || "";

  const messages = [];
  const chatMessages = conv.chat_messages || conv.messages || [];

  for (const msg of chatMessages) {
    const role = (msg.sender || msg.role || "unknown").toUpperCase();
    if (role === "SYSTEM") continue;
    const text = extractMessageText(msg).trim();
    if (!text) continue;

    // Dedup consecutive identical messages
    const sig = `${role}|${text}`;
    if (messages.length > 0 && messages[messages.length - 1].sig === sig) continue;

    messages.push({
      role: role === "HUMAN" || role === "USER" ? "USER" : "ASSISTANT",
      text,
      sig,
    });
  }

  const transcript = messages.map((m) => `${m.role}: ${m.text}`).join("\n\n");
  const content = `Conversation title: ${title}\nConversation created at: ${createdAt}\n\n${transcript}`;

  return { title, createdAt, conversationId, content };
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
      source_type: "claude_import",
      importance: 3,
      quality_score: 50,
      sensitivity_tier: "standard",
      metadata: { ...metadata, source: "claude_import", source_type: "claude_import" },
      embedding: JSON.stringify(embedding),
      created_at: createdAt,
    },
  });
  if (error) throw new Error(`upsert_thought failed: ${error.message}`);
  return data;
}

async function main() {
  console.log(`Claude Export Import`);
  console.log(`File: ${filePath}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE IMPORT"}`);
  console.log();

  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  const conversations = Array.isArray(parsed) ? parsed : [parsed];

  console.log(`Found ${conversations.length} conversations`);

  const toProcess = conversations.slice(skip, skip + limit);
  console.log(`Processing ${toProcess.length} (skip=${skip}, limit=${limit === Infinity ? "all" : limit})`);
  console.log();

  let imported = 0, skipped = 0, errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const conv = toProcess[i];
    try {
      const { title, createdAt, conversationId, content } = normalizeConversation(conv);
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
        { title, conversation_id: conversationId, content_fingerprint: fingerprint },
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
