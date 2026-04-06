#!/usr/bin/env node
/**
 * Limitless Lifelog Import for Open Brain (OB1-compatible)
 *
 * Parses Limitless AI lifelog markdown transcripts and imports them as
 * thoughts with embeddings into your Open Brain Supabase instance.
 *
 * Usage:
 *   node import-limitless.mjs /path/to/lifelogs [--dry-run] [--skip N] [--limit N]
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { readdir, readFile, stat } from "fs/promises";
import { join, basename } from "path";
import { config } from "dotenv";

config(); // Load .env

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
const dirPath = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const skipIdx = args.indexOf("--skip");
const skip = skipIdx !== -1 ? parseInt(args[skipIdx + 1]) || 0 : 0;
const limitIdx = args.indexOf("--limit");
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) || Infinity : Infinity;

if (!dirPath) {
  console.error("Usage: node import-limitless.mjs /path/to/lifelogs [--dry-run] [--skip N] [--limit N]\n\nNote: Timestamps are parsed from filenames as UTC. If your Limitless recordings\nuse local time, timestamps will be offset by your timezone difference.");
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function contentFingerprint(text) {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

function parseFilename(fileName) {
  // Pattern: YYYY-MM-DD_HHhMMmSSs_Title.md
  const match = fileName.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})h(\d{2})m(\d{2})s_(.+)\.md$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, titleRaw] = match;
  return {
    createdAt: `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
    title: titleRaw.replace(/-/g, " "),
  };
}

function cleanLifelogContent(content) {
  // Extract title from first H1
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "";

  // Remove speaker attribution: > [timestamp](#startMs=...&endMs=...):
  let cleaned = content.replace(/>\s*\[[\d:]+\]\(#startMs=\d+&endMs=\d+\):\s*/g, "");
  // Remove remaining blockquote markers
  cleaned = cleaned.replace(/^>\s?/gm, "");
  // Remove the H1 title line
  cleaned = cleaned.replace(/^#\s+.+$/m, "").trim();

  return { title, text: cleaned };
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
      source_type: "limitless_import",
      importance: 3,
      quality_score: 50,
      sensitivity_tier: "standard",
      metadata: {
        ...metadata,
        source: "limitless_import",
        source_type: "limitless_import",
      },
      embedding: JSON.stringify(embedding),
      created_at: createdAt,
    },
  });

  if (error) throw new Error(`upsert_thought failed: ${error.message}`);
  return data;
}

// ── File Discovery ───────────────────────────────────────────────────────

async function findMarkdownFiles(dir) {
  const files = [];

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files.sort();
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Limitless Lifelog Import`);
  console.log(`Directory: ${dirPath}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE IMPORT"}`);
  console.log();

  const allFiles = await findMarkdownFiles(dirPath);
  console.log(`Found ${allFiles.length} markdown files`);

  // Apply skip/limit
  const filesToProcess = allFiles.slice(skip, skip + limit);
  console.log(`Processing ${filesToProcess.length} files (skip=${skip}, limit=${limit === Infinity ? "all" : limit})`);
  console.log();

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < filesToProcess.length; i++) {
    const filePath = filesToProcess[i];
    const fileName = basename(filePath);

    try {
      const content = await readFile(filePath, "utf-8");

      // Skip short files (noise)
      if (content.length < 100) {
        skipped++;
        continue;
      }

      // Parse filename for timestamp
      const fileMeta = parseFilename(fileName);
      const { title, text } = cleanLifelogContent(content);
      const createdAt = fileMeta?.createdAt || new Date().toISOString();
      const thoughtTitle = fileMeta?.title || title || fileName;

      // Build the thought content
      const thoughtContent = title
        ? `${title}\n\n${text}`
        : text;

      if (thoughtContent.trim().length < 50) {
        skipped++;
        continue;
      }

      const fingerprint = contentFingerprint(thoughtContent);

      if (dryRun) {
        console.log(`[${i + 1}/${filesToProcess.length}] Would import: "${thoughtTitle}" (${thoughtContent.length} chars)`);
        imported++;
        continue;
      }

      // Generate embedding
      const embedding = await getEmbedding(thoughtContent);

      // Upsert to Supabase
      const result = await upsertThought(
        thoughtContent,
        {
          title: thoughtTitle,
          source_file: fileName,
          content_fingerprint: fingerprint,
        },
        embedding,
        createdAt
      );

      console.log(`[${i + 1}/${filesToProcess.length}] ${result.action}: #${result.thought_id} "${thoughtTitle}"`);
      imported++;
    } catch (err) {
      console.error(`[${i + 1}/${filesToProcess.length}] Error: ${fileName} — ${err.message}`);
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
