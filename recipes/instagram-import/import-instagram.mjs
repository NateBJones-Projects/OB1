#!/usr/bin/env node
/**
 * Instagram Import for Open Brain (OB1-compatible)
 *
 * Parses Instagram data exports — DM conversations, comments, and post captions —
 * and imports them as thoughts with embeddings.
 *
 * Usage:
 *   node import-instagram.mjs /path/to/instagram-export [--dry-run] [--skip N] [--limit N]
 *   node import-instagram.mjs /path/to/instagram-export --types messages,comments,posts
 *
 * Expected: instagram-export/your_instagram_activity/ folder structure
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
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
  : ["messages", "comments", "posts"];

if (!dirPath) {
  console.error("Usage: node import-instagram.mjs /path/to/instagram-export [--dry-run] [--skip N] [--limit N]");
  process.exit(1);
}

function contentFingerprint(text) {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

// Fix Meta's double-encoded UTF-8 (latin1-interpreted)
function fixMetaEncoding(text) {
  try {
    return Buffer.from(text, "latin1").toString("utf-8");
  } catch {
    return text;
  }
}

async function findActivityDir(dir) {
  // Look for your_instagram_activity directory
  async function walk(d, depth) {
    if (depth > 3) return null;
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === "your_instagram_activity") return join(d, e.name);
        const found = await walk(join(d, e.name), depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  return await walk(dir, 0);
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
      source_type: "instagram_import",
      importance: 2,
      quality_score: 40,
      sensitivity_tier: "personal",
      metadata: { ...metadata, source: "instagram_import", source_type: "instagram_import" },
      embedding: JSON.stringify(embedding),
      created_at: createdAt,
    },
  });
  if (error) throw new Error(`upsert_thought failed: ${error.message}`);
  return data;
}

// ── Message Processing ───────────────────────────────────────────────────

async function processMessages(activityDir) {
  const items = [];
  const messagesDir = join(activityDir, "messages", "inbox");

  try {
    const convDirs = await readdir(messagesDir, { withFileTypes: true });

    for (const convDir of convDirs) {
      if (!convDir.isDirectory()) continue;
      const convPath = join(messagesDir, convDir.name);

      // Find all message_*.json files
      const files = await readdir(convPath);
      const messageFiles = files.filter((f) => f.startsWith("message") && f.endsWith(".json"));

      const allMessages = [];
      for (const msgFile of messageFiles) {
        try {
          const raw = await readFile(join(convPath, msgFile), "utf-8");
          const data = JSON.parse(raw);
          const messages = data.messages || [];
          allMessages.push(...messages);
        } catch { /* skip corrupt files */ }
      }

      if (allMessages.length < 3) continue;

      // Sort by timestamp
      allMessages.sort((a, b) => (a.timestamp_ms || 0) - (b.timestamp_ms || 0));

      const participantName = fixMetaEncoding(convDir.name.replace(/_\d+$/, "").replace(/_/g, " "));

      const content = allMessages
        .slice(0, 200) // Cap at 200 messages per conversation
        .map((m) => {
          const sender = fixMetaEncoding(m.sender_name || "unknown");
          const text = fixMetaEncoding(m.content || "");
          return `${sender}: ${text}`;
        })
        .filter((line) => line.length > 5)
        .join("\n");

      const firstDate = allMessages[0]?.timestamp_ms
        ? new Date(allMessages[0].timestamp_ms).toISOString()
        : new Date().toISOString();

      items.push({
        content: `Instagram DM conversation with ${participantName}:\n\n${content}`,
        createdAt: firstDate,
        title: `Instagram DM: ${participantName} (${allMessages.length} messages)`,
      });
    }
  } catch { /* messages dir not found */ }

  return items;
}

// ── Comments Processing ──────────────────────────────────────────────────

async function processComments(activityDir) {
  const items = [];
  const commentsDir = join(activityDir, "comments");

  try {
    const files = await readdir(commentsDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    const allComments = [];
    for (const file of jsonFiles) {
      try {
        const raw = await readFile(join(commentsDir, file), "utf-8");
        const data = JSON.parse(raw);
        const comments = data.comments_media_comments || data || [];
        if (Array.isArray(comments)) {
          for (const c of comments) {
            const text = c.string_map_data?.["Comment"]?.value
              || c.string_map_data?.["comment"]?.value
              || c.value || "";
            const timestamp = c.string_map_data?.["Time"]?.timestamp
              || c.timestamp || 0;
            if (text.length > 10) {
              allComments.push({
                text: fixMetaEncoding(text),
                date: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
              });
            }
          }
        }
      } catch { /* skip */ }
    }

    if (allComments.length > 0) {
      // Group into batches of 50
      for (let i = 0; i < allComments.length; i += 50) {
        const batch = allComments.slice(i, i + 50);
        const content = batch
          .map((c) => `(${c.date.slice(0, 10)}): ${c.text}`)
          .join("\n\n");

        items.push({
          content: `Instagram comments by user:\n\n${content}`,
          createdAt: batch[0].date,
          title: `Instagram comments (batch ${Math.floor(i / 50) + 1})`,
        });
      }
    }
  } catch { /* comments dir not found */ }

  return items;
}

// ── Posts/Captions Processing ────────────────────────────────────────────

async function processPosts(activityDir) {
  const items = [];
  const postsDir = join(activityDir, "content", "posts_1.json");

  try {
    const raw = await readFile(postsDir, "utf-8");
    const posts = JSON.parse(raw);

    const captions = [];
    for (const post of (Array.isArray(posts) ? posts : [])) {
      const title = fixMetaEncoding(post.title || "");
      const timestamp = post.creation_timestamp || 0;
      if (title.length > 10) {
        captions.push({
          text: title,
          date: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
        });
      }
    }

    if (captions.length > 0) {
      // Group into batches of 30
      for (let i = 0; i < captions.length; i += 30) {
        const batch = captions.slice(i, i + 30);
        const content = batch.map((c) => c.text).join("\n\n");

        items.push({
          content: `Instagram post captions:\n\n${content}`,
          createdAt: batch[0].date,
          title: `Instagram captions (batch ${Math.floor(i / 30) + 1})`,
        });
      }
    }
  } catch { /* posts file not found */ }

  return items;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Instagram Import`);
  console.log(`Directory: ${dirPath}`);
  console.log(`Types: ${typesArg.join(", ")}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE IMPORT"}`);
  console.log();

  const activityDir = await findActivityDir(dirPath);
  if (!activityDir) {
    console.error("Could not find 'your_instagram_activity' directory. Check your export path.");
    process.exit(1);
  }
  console.log(`Activity dir: ${activityDir}`);

  const allItems = [];

  if (typesArg.includes("messages")) {
    const msgs = await processMessages(activityDir);
    allItems.push(...msgs);
    console.log(`Messages: ${msgs.length} conversations`);
  }

  if (typesArg.includes("comments")) {
    const comments = await processComments(activityDir);
    allItems.push(...comments);
    console.log(`Comments: ${comments.length} batches`);
  }

  if (typesArg.includes("posts")) {
    const posts = await processPosts(activityDir);
    allItems.push(...posts);
    console.log(`Posts: ${posts.length} batches`);
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
        item.createdAt
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
