#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Open Brain — Retroactive Metadata Extraction
 *
 * Finds thoughts missing LLM-extracted metadata (type, topics, people, etc.)
 * and backfills them using the same gpt-4o-mini extraction prompt that
 * capture_thought uses.
 *
 * Typical use: email-imported thoughts that were inserted via Supabase direct
 * (skipping the ingest endpoint) have embeddings but no structured metadata.
 *
 * Usage:
 *   deno run --allow-net --allow-env scripts/backfill-metadata.ts [options]
 *
 * Options:
 *   --source=gmail          Only backfill thoughts from this source (default: all)
 *   --limit=100             Max thoughts to process (default: 100)
 *   --dry-run               Show what would be updated without writing
 *   --batch-size=10         Concurrent requests per batch (default: 10)
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENROUTER_API_KEY) {
  console.error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY");
  Deno.exit(1);
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// ─── Args ────────────────────────────────────────────────────────────────────

interface Args {
  source: string | null;
  limit: number;
  dryRun: boolean;
  batchSize: number;
}

function parseArgs(): Args {
  const args: Args = { source: null, limit: 100, dryRun: false, batchSize: 10 };
  for (const arg of Deno.args) {
    if (arg.startsWith("--source=")) args.source = arg.split("=")[1];
    else if (arg.startsWith("--limit=")) args.limit = parseInt(arg.split("=")[1]);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--batch-size=")) args.batchSize = parseInt(arg.split("=")[1]);
  }
  return args;
}

// ─── Metadata Extraction (same prompt as MCP server) ─────────────────────────

const EXTRACT_PROMPT = `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
- "sentiment": one of "positive", "negative", "neutral", "mixed"
Only extract what's explicitly there.`;

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: EXTRACT_PROMPT },
        { role: "user", content: text },
      ],
    }),
  });

  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter failed: ${r.status} ${msg}`);
  }

  const d = await r.json();
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

// ─── Supabase helpers ────────────────────────────────────────────────────────

const headers = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_SERVICE_ROLE_KEY,
  "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

interface Thought {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

async function fetchThoughtsMissingMetadata(source: string | null, limit: number): Promise<Thought[]> {
  // Find thoughts where metadata has no 'type' key (the primary indicator of LLM extraction)
  let url = `${SUPABASE_URL}/rest/v1/thoughts?select=id,content,metadata&order=created_at.desc&limit=${limit}`;

  // metadata->>'type' is null means no LLM extraction was done
  url += `&metadata->>type=is.null`;

  if (source) {
    url += `&metadata->>source=eq.${source}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to fetch thoughts: ${res.status} ${err}`);
  }
  return await res.json();
}

async function updateThoughtMetadata(id: string, metadata: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/thoughts?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ metadata }),
  });
  return res.ok;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  console.log(`\nOpen Brain — Metadata Backfill`);
  console.log(`  Source filter: ${args.source || "all"}`);
  console.log(`  Limit: ${args.limit}`);
  console.log(`  Batch size: ${args.batchSize}`);
  console.log(`  Mode: ${args.dryRun ? "DRY RUN" : "LIVE"}\n`);

  const thoughts = await fetchThoughtsMissingMetadata(args.source, args.limit);
  console.log(`Found ${thoughts.length} thought(s) missing metadata.\n`);

  if (thoughts.length === 0) return;

  let updated = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < thoughts.length; i += args.batchSize) {
    const batch = thoughts.slice(i, i + args.batchSize);
    const batchNum = Math.floor(i / args.batchSize) + 1;
    const totalBatches = Math.ceil(thoughts.length / args.batchSize);
    console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} thoughts)...`);

    const results = await Promise.allSettled(
      batch.map(async (thought) => {
        const extracted = await extractMetadata(thought.content);

        if (args.dryRun) {
          console.log(`  [DRY] ${thought.id}: type=${extracted.type}, topics=${(extracted.topics as string[])?.join(", ")}`);
          return;
        }

        // Merge: keep existing metadata (source, gmail_labels, etc.), add extracted fields
        const merged = { ...thought.metadata, ...extracted };
        const ok = await updateThoughtMetadata(thought.id, merged);

        if (ok) {
          updated++;
          console.log(`  ✓ ${thought.id}: type=${extracted.type}, topics=${(extracted.topics as string[])?.join(", ")}`);
        } else {
          errors++;
          console.error(`  ✗ ${thought.id}: update failed`);
        }
      }),
    );

    for (const r of results) {
      if (r.status === "rejected") {
        errors++;
        console.error(`  ✗ Error: ${r.reason}`);
      }
    }

    // Rate limit between batches
    if (i + args.batchSize < thoughts.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`\nDone.`);
  if (!args.dryRun) {
    console.log(`  Updated: ${updated}`);
    console.log(`  Errors: ${errors}`);
  } else {
    console.log(`  Would update: ${thoughts.length} thoughts`);
  }
}

main();
