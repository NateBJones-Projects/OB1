#!/usr/bin/env node
/**
 * daily-digest.mjs — Daily brain digest
 *
 * 1. Fetches thoughts captured in the last N days
 * 2. Summarizes them into a daily digest via GPT-4o-mini
 * 3. Captures the digest back as a thought
 * 4. Prints the digest for review
 *
 * Usage:
 *   node daily-digest.mjs
 *   node daily-digest.mjs --days 3
 *
 * Env: OPEN_BRAIN_URL, OPEN_BRAIN_SERVICE_KEY, OPENAI_API_KEY
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local
const envPath = resolve(process.cwd(), ".env.local");
try {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const URL = process.env.OPEN_BRAIN_URL;
const KEY = process.env.OPEN_BRAIN_SERVICE_KEY;
const OAI = process.env.OPENAI_API_KEY;
const DAYS = parseInt(process.argv[process.argv.indexOf("--days") + 1] || "1") || 1;

if (!URL || !KEY || !OAI) {
  console.error("Missing env vars: OPEN_BRAIN_URL, OPEN_BRAIN_SERVICE_KEY, OPENAI_API_KEY");
  process.exit(1);
}

async function sbFetch(table, queryParams) {
  const parts = [];
  for (const [k, v] of Object.entries(queryParams)) {
    if (k === "select") parts.push(`select=${v}`);
    else if (k === "gte") parts.push(`created_at=gte.${v}`);
    else if (k === "order") parts.push(`order=${v}`);
    else if (k === "limit") parts.push(`limit=${v}`);
  }
  const r = await fetch(`${URL}/rest/v1/${table}?${parts.join("&")}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  return r.json();
}

async function oaiEmbed(text) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${OAI}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 2000) }),
  });
  const d = await r.json();
  return d.data?.[0]?.embedding;
}

async function oaiChat(prompt) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OAI}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
    }),
  });
  const d = await r.json();
  return d.choices?.[0]?.message?.content || "Failed to generate digest";
}

async function sbInsert(body) {
  await fetch(`${URL}/rest/v1/thoughts`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
}

async function main() {
  const since = new Date(Date.now() - DAYS * 86400000).toISOString();
  console.log(`[digest] Fetching thoughts since ${since}...`);

  const thoughts = await sbFetch("thoughts", {
    select: "content,source_type,metadata,created_at",
    gte: since,
    order: "created_at.desc",
    limit: "500",
  });

  console.log(`[digest] Found ${thoughts.length} thoughts in the last ${DAYS} day(s)`);

  if (thoughts.length === 0) {
    console.log("[digest] Nothing new. Done.");
    return;
  }

  const bySource = {};
  for (const t of thoughts) {
    const src = t.source_type || "unknown";
    bySource[src] = (bySource[src] || 0) + 1;
  }
  console.log("[digest] By source:");
  for (const [src, n] of Object.entries(bySource)) console.log(`  ${src}: ${n}`);

  // Build sample (max ~3000 chars)
  let sample = [], chars = 0;
  for (const t of thoughts) {
    if (chars > 3000) break;
    const line = `[${t.source_type}] ${String(t.content || "").replace(/\s+/g, " ").slice(0, 200)}`;
    sample.push(line);
    chars += line.length;
  }

  const prompt = `Summarize these ${thoughts.length} captured thoughts from the last ${DAYS} day(s) into a concise daily digest for Bill Gleeson.

Group by theme (customer activity, internal projects, financial metrics, personal notes, etc.).
Highlight: key decisions, action items, notable numbers, anything that needs follow-up.
Be specific — use names, numbers, dates from the content.
Keep it under 400 words. Use bullet points for readability.

<thoughts>
${sample.join("\n")}
</thoughts>`;

  const digest = await oaiChat(prompt);

  console.log("\n" + "=".repeat(60));
  console.log(`DAILY DIGEST — Last ${DAYS} day(s) — ${new Date().toISOString().split("T")[0]}`);
  console.log("=".repeat(60));
  console.log(digest);
  console.log("=".repeat(60));

  const digestContent = `Daily Digest (${new Date().toISOString().split("T")[0]}): ${thoughts.length} thoughts from the last ${DAYS} day(s).\n\n${digest}`;
  const embedding = await oaiEmbed(digestContent);

  if (embedding) {
    await sbInsert({
      content: digestContent,
      embedding,
      source_type: "daily_digest",
      metadata: { source: "daily_digest", thought_count: thoughts.length, days: DAYS, sources: Object.keys(bySource) },
    });
    console.log("[digest] Saved to brain as daily_digest");
  }
}

main().catch(console.error);
