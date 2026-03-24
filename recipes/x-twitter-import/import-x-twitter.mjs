#!/usr/bin/env node
/**
 * X/Twitter Import for Open Brain (OB1-compatible)
 *
 * Parses X (Twitter) data exports — tweets, DMs, and Grok chats — and imports
 * them as thoughts with embeddings.
 *
 * Usage:
 *   node import-x-twitter.mjs /path/to/twitter-export [--dry-run] [--skip N] [--limit N]
 *   node import-x-twitter.mjs /path/to/twitter-export --types tweets,dms
 *
 * Expected directory structure:
 *   twitter-export/
 *   └── data/
 *       ├── tweets.js (or tweet.js)
 *       ├── direct-messages.js
 *       └── grok-conversations.js
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { readFile, readdir, stat } from "fs/promises";
import { join, basename } from "path";
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
const dirPath = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const skip = parseInt(args[args.indexOf("--skip") + 1]) || 0;
const limit = parseInt(args[args.indexOf("--limit") + 1]) || Infinity;
const typesArg = args.indexOf("--types") !== -1
  ? args[args.indexOf("--types") + 1].split(",")
  : ["tweets", "dms", "grok"];

if (!dirPath) {
  console.error("Usage: node import-x-twitter.mjs /path/to/twitter-export [--dry-run] [--skip N] [--limit N] [--types tweets,dms,grok]");
  process.exit(1);
}

function contentFingerprint(text) {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

function parseTwitterJsFile(content) {
  // Twitter JS files start with "window.YTD.tweets.part0 = " or similar
  const jsonStart = content.indexOf("[");
  if (jsonStart === -1) return [];
  return JSON.parse(content.substring(jsonStart));
}

async function findDataDir(dir) {
  // Look for data/ subdirectory
  const dataDir = join(dir, "data");
  try {
    await stat(dataDir);
    return dataDir;
  } catch {
    return dir; // Maybe files are in the root
  }
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

async function upsertThought(content, metadata, embedding, createdAt, sourceType) {
  const { data, error } = await supabase.rpc("upsert_thought", {
    p_content: content,
    p_payload: {
      type: "reference",
      source_type: sourceType,
      importance: 2,
      quality_score: 40,
      sensitivity_tier: "standard",
      metadata: { ...metadata, source: "x_twitter_import", source_type: sourceType },
      embedding: JSON.stringify(embedding),
      created_at: createdAt,
    },
  });
  if (error) throw new Error(`upsert_thought failed: ${error.message}`);
  return data;
}

// ── Tweet Processing ─────────────────────────────────────────────────────

function processTweets(rawTweets) {
  const tweets = rawTweets
    .map((t) => t.tweet || t)
    .filter((t) => {
      const text = t.full_text || t.text || "";
      if (text.length < 30) return false;
      if (text.startsWith("RT @")) return false; // Skip retweets
      return true;
    })
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

  // Group tweets into batches of 20 by date range
  const batches = [];
  for (let i = 0; i < tweets.length; i += 20) {
    const batch = tweets.slice(i, i + 20);
    const first = batch[0];
    const last = batch[batch.length - 1];
    const firstDate = first.created_at ? new Date(first.created_at).toISOString().slice(0, 10) : "unknown";
    const lastDate = last.created_at ? new Date(last.created_at).toISOString().slice(0, 10) : "unknown";

    const content = batch
      .map((t) => {
        const text = t.full_text || t.text || "";
        const date = t.created_at ? new Date(t.created_at).toISOString().slice(0, 10) : "";
        return `Tweet (${date}): ${text}`;
      })
      .join("\n\n");

    batches.push({
      content: `X/Twitter tweets from ${firstDate} to ${lastDate}:\n\n${content}`,
      createdAt: first.created_at ? new Date(first.created_at).toISOString() : new Date().toISOString(),
      title: `Tweets ${firstDate} to ${lastDate}`,
    });
  }

  return batches;
}

// ── DM Processing ────────────────────────────────────────────────────────

function processDMs(rawDMs) {
  const conversations = rawDMs
    .map((dm) => dm.dmConversation || dm)
    .filter((conv) => {
      const messages = conv.messages || [];
      return messages.length >= 3; // Skip very short conversations
    });

  return conversations.map((conv) => {
    const messages = (conv.messages || [])
      .map((m) => m.messageCreate || m)
      .filter((m) => m.text)
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

    const content = messages
      .map((m) => `${m.senderId || "sender"}: ${m.text}`)
      .join("\n");

    const firstDate = messages[0]?.createdAt
      ? new Date(messages[0].createdAt).toISOString()
      : new Date().toISOString();

    return {
      content: `X/Twitter DM conversation:\n\n${content}`,
      createdAt: firstDate,
      title: `Twitter DM (${messages.length} messages)`,
    };
  });
}

// ── Grok Chat Processing ─────────────────────────────────────────────────

function processGrokChats(rawGrok) {
  const chats = {};

  for (const entry of rawGrok) {
    const chatId = entry.chatId || "default";
    if (!chats[chatId]) chats[chatId] = [];
    chats[chatId].push(entry);
  }

  return Object.entries(chats).map(([chatId, messages]) => {
    messages.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

    const content = messages
      .map((m) => {
        const role = (m.sender || "user").toUpperCase() === "USER" ? "USER" : "ASSISTANT";
        return `${role}: ${m.message || m.text || ""}`;
      })
      .filter((line) => line.length > 10)
      .join("\n\n");

    const firstDate = messages[0]?.createdAt
      ? new Date(messages[0].createdAt).toISOString()
      : new Date().toISOString();

    return {
      content: `Grok chat conversation:\n\n${content}`,
      createdAt: firstDate,
      title: `Grok chat (${messages.length} messages)`,
    };
  });
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`X/Twitter Import`);
  console.log(`Directory: ${dirPath}`);
  console.log(`Types: ${typesArg.join(", ")}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE IMPORT"}`);
  console.log();

  const dataDir = await findDataDir(dirPath);
  const allItems = [];

  // Process tweets
  if (typesArg.includes("tweets")) {
    for (const name of ["tweets.js", "tweet.js"]) {
      try {
        const raw = await readFile(join(dataDir, name), "utf-8");
        const tweets = parseTwitterJsFile(raw);
        const batches = processTweets(tweets);
        allItems.push(...batches.map((b) => ({ ...b, sourceType: "x_twitter_import" })));
        console.log(`Tweets: ${tweets.length} tweets → ${batches.length} batched thoughts`);
      } catch { /* file not found */ }
    }
  }

  // Process DMs
  if (typesArg.includes("dms")) {
    for (const name of ["direct-messages.js", "direct-message.js"]) {
      try {
        const raw = await readFile(join(dataDir, name), "utf-8");
        const dms = parseTwitterJsFile(raw);
        const convs = processDMs(dms);
        allItems.push(...convs.map((c) => ({ ...c, sourceType: "x_twitter_import" })));
        console.log(`DMs: ${dms.length} conversations → ${convs.length} thoughts`);
      } catch { /* file not found */ }
    }
  }

  // Process Grok chats
  if (typesArg.includes("grok")) {
    for (const name of ["grok-conversations.js", "grokConversations.js"]) {
      try {
        const raw = await readFile(join(dataDir, name), "utf-8");
        const grok = parseTwitterJsFile(raw);
        const chats = processGrokChats(grok);
        allItems.push(...chats.map((c) => ({ ...c, sourceType: "x_twitter_import" })));
        console.log(`Grok chats: ${grok.length} messages → ${chats.length} thoughts`);
      } catch { /* file not found */ }
    }
  }

  console.log(`\nTotal items: ${allItems.length}`);

  const toProcess = allItems.slice(skip, skip + limit);
  console.log(`Processing ${toProcess.length} (skip=${skip}, limit=${limit === Infinity ? "all" : limit})`);
  console.log();

  let imported = 0, skipped = 0, errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i];
    try {
      if (item.content.trim().length < 50) { skipped++; continue; }

      const truncated = item.content.length > 30000
        ? item.content.substring(0, 30000) + "\n\n[... truncated]"
        : item.content;
      const fingerprint = contentFingerprint(truncated);

      if (dryRun) {
        console.log(`[${i + 1}/${toProcess.length}] Would import: "${item.title}" (${truncated.length} chars)`);
        imported++;
        continue;
      }

      const embedding = await getEmbedding(truncated);
      const result = await upsertThought(
        truncated,
        { title: item.title, content_fingerprint: fingerprint },
        embedding,
        item.createdAt,
        item.sourceType
      );
      console.log(`[${i + 1}/${toProcess.length}] ${result.action}: #${result.thought_id} "${item.title}"`);
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
