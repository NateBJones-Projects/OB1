#!/usr/bin/env node
/**
 * Weekly Digest for Open Brain
 * -----------------------------
 * Synthesizes the past N days of thoughts into an importance-ranked digest
 * and delivers it to Telegram, stdout, or a local markdown file.
 *
 * This is a "consumption format" — a rhythmic way to read your brain back
 * to yourself. Captures on their own are input; the digest is the loop that
 * turns a pile of thoughts into something you actually revisit.
 *
 * Usage:
 *   node weekly-digest.mjs                         # 7-day window → Telegram
 *   node weekly-digest.mjs --output=stdout         # print to console only
 *   node weekly-digest.mjs --output=file           # write to ./digests/YYYY-MM-DD.md
 *   node weekly-digest.mjs --window=14             # last 14 days
 *   node weekly-digest.mjs --include-personal      # include sensitivity_tier=personal
 *   node weekly-digest.mjs --model=claude-haiku-4-5-20251001
 *   node weekly-digest.mjs --min-importance=3      # lower threshold
 *   node weekly-digest.mjs --dry-run               # synthesize + print, deliver nothing
 *
 * Env vars:
 *   OPEN_BRAIN_URL           Your Supabase project URL (required)
 *   OPEN_BRAIN_SERVICE_KEY   Supabase service role key (required)
 *   ANTHROPIC_API_KEY        Direct Anthropic key (preferred)
 *   OPENROUTER_API_KEY       OpenRouter fallback (used if ANTHROPIC_API_KEY unset)
 *   TELEGRAM_BOT_TOKEN       Required for --output=telegram
 *   TELEGRAM_CHAT_ID         Required for --output=telegram
 *   DIGEST_MODEL             Override default model (default: claude-opus-4-7)
 */

import fs from "node:fs";
import path from "node:path";

// ── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = process.env.DIGEST_MODEL || "claude-opus-4-7";

// Friendly aliases you can pass to --model.
const MODEL_ALIASES = {
  opus: "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
};

// Telegram messages over this many chars get split across multiple sends.
// Telegram's hard limit is 4096 for text messages.
const TELEGRAM_CHUNK_LIMIT = 3800;

// How many thoughts we send to the synthesizer. The script paginates the
// full window above this cap, then ranks, then trims. Bigger = more context
// + more tokens + more cost.
const SYNTHESIZE_INPUT_CAP = 80;

// Hard ceiling on total thoughts pulled from the brain per run, to protect
// against someone with a huge window + heavy capture volume blowing past
// what one LLM call can reasonably digest.
const FETCH_HARD_CAP = 400;

// Page size for PostgREST pagination.
const PAGE_SIZE = 100;

// ── Args ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    window: 7,
    minImportance: 4,
    model: DEFAULT_MODEL,
    output: "telegram",
    outputExplicit: false,
    includePersonal: false,
    dryRun: false,
    noSensitivityFilter: false,
  };
  for (const raw of argv) {
    if (raw === "--dry-run") {
      args.dryRun = true;
    } else if (raw === "--include-personal") {
      args.includePersonal = true;
    } else if (raw === "--no-sensitivity-filter") {
      args.noSensitivityFilter = true;
    } else if (raw.startsWith("--window=")) {
      const n = Number(raw.slice("--window=".length));
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--window must be a positive number, got: ${raw}`);
      }
      args.window = n;
    } else if (raw.startsWith("--min-importance=")) {
      const n = Number(raw.slice("--min-importance=".length));
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`--min-importance must be >= 0, got: ${raw}`);
      }
      args.minImportance = n;
    } else if (raw.startsWith("--model=")) {
      const val = raw.slice("--model=".length).trim();
      args.model = MODEL_ALIASES[val] ?? val;
    } else if (raw.startsWith("--output=")) {
      const val = raw.slice("--output=".length).trim();
      if (!["telegram", "stdout", "file"].includes(val)) {
        throw new Error(`--output must be telegram|stdout|file, got: ${val}`);
      }
      args.output = val;
      args.outputExplicit = true;
    } else if (raw === "--help" || raw === "-h") {
      printHelp();
      process.exit(0);
    } else if (raw.startsWith("--")) {
      throw new Error(`Unknown flag: ${raw}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(
    [
      "Weekly Digest — importance-ranked synthesis of recent thoughts",
      "",
      "Usage: node weekly-digest.mjs [options]",
      "",
      "Options:",
      "  --window=<days>           Lookback window in days (default: 7)",
      "  --min-importance=<n>      Minimum importance threshold (default: 4)",
      "  --model=<id|alias>        LLM model (default: claude-opus-4-7)",
      "                            Aliases: opus, sonnet, haiku",
      "  --output=<mode>           telegram | stdout | file (default: telegram)",
      "  --include-personal        Include sensitivity_tier=personal thoughts",
      "  --no-sensitivity-filter   UNSAFE: run without sensitivity_tier filter.",
      "                            Use only when you accept that restricted/personal",
      "                            thoughts will be sent to the LLM + delivery target.",
      "  --dry-run                 Synthesize + print, deliver nothing",
      "  -h, --help                Show this help",
    ].join("\n"),
  );
}

// ── Env validation ──────────────────────────────────────────────────────────

function loadConfig(args) {
  const openBrainUrl = process.env.OPEN_BRAIN_URL;
  const openBrainKey = process.env.OPEN_BRAIN_SERVICE_KEY;
  if (!openBrainUrl) throw new Error("Missing OPEN_BRAIN_URL env var");
  if (!openBrainKey) throw new Error("Missing OPEN_BRAIN_SERVICE_KEY env var");

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!anthropicKey && !openrouterKey) {
    throw new Error(
      "Missing LLM credentials: set ANTHROPIC_API_KEY or OPENROUTER_API_KEY",
    );
  }

  const llmProvider = anthropicKey ? "anthropic" : "openrouter";
  const llmKey = anthropicKey || openrouterKey;

  let telegramBotToken = null;
  let telegramChatId = null;
  if (args.output === "telegram") {
    telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    telegramChatId = process.env.TELEGRAM_CHAT_ID;
    if (!telegramBotToken || !telegramChatId) {
      throw new Error(
        "--output=telegram requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars. " +
          "Use --output=stdout or --output=file if you don't have Telegram configured.",
      );
    }
  }

  // Normalize the base URL: strip trailing slashes so we can concat cleanly.
  const baseUrl = openBrainUrl.replace(/\/+$/, "");

  return {
    baseUrl,
    serviceKey: openBrainKey,
    llmProvider,
    llmKey,
    telegramBotToken,
    telegramChatId,
  };
}

// ── Thoughts fetch via PostgREST ────────────────────────────────────────────

/**
 * Fetches thoughts from public.thoughts for the last `windowDays` days,
 * excluding restricted (always) and personal (unless --include-personal).
 *
 * Why PostgREST direct vs. an edge function: the core Open Brain install
 * ships public.thoughts as a PostgREST-reachable table. Going direct keeps
 * this recipe runnable on a stock Open Brain without requiring a custom
 * REST gateway edge function.
 */
async function fetchThoughts(cfg, { windowDays, includePersonal, noSensitivityFilter }) {
  const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  // Build the sensitivity exclusion list. sensitivity_tier is a TEXT column
  // added by the sensitivity-tiers primitive; if a given Open Brain install
  // doesn't have it, PostgREST will 400 and we FAIL CLOSED by default to
  // protect the privacy boundary the README promises ("restricted never
  // leaves the database"). The user can opt out with --no-sensitivity-filter
  // if they accept the leakage risk and explicitly want to run unfiltered.
  const excluded = includePersonal ? ["restricted"] : ["restricted", "personal"];
  // When --no-sensitivity-filter is set, skip the filter entirely so a missing
  // column won't trip the 400. Otherwise, apply the exclusion filter.
  //
  // NOTE on importance: stock OB1 `public.thoughts` does NOT have an
  // `importance` column. This recipe reads it from `metadata->>'importance'`
  // on the client side (see `thoughtImportance()` below), so we do not select
  // a bare `importance` column here. Installs that do add a native
  // `importance` column can expose it via `metadata.importance` in their
  // capture pipeline, or future work can add a COALESCE path that prefers
  // the native column when present.
  const selectCols = noSensitivityFilter
    ? "id,content,created_at,metadata"
    : "id,content,created_at,metadata,sensitivity_tier";
  const excludeFilter = noSensitivityFilter
    ? ""
    : `&sensitivity_tier=not.in.(${excluded.join(",")})`;

  if (noSensitivityFilter) {
    console.warn(
      "[weekly-digest] WARNING: --no-sensitivity-filter is set. " +
        "ALL thoughts (including any that would be tagged restricted/personal) " +
        "will be sent to the LLM and delivery target. You have accepted the " +
        "data-leakage risk. Do NOT use this flag on a brain that contains " +
        "secrets, health data, or other material you don't want exfiltrated.",
    );
  }

  const headers = {
    apikey: cfg.serviceKey,
    Authorization: `Bearer ${cfg.serviceKey}`,
  };

  const all = [];

  for (let offset = 0; offset < FETCH_HARD_CAP; offset += PAGE_SIZE) {
    const limit = Math.min(PAGE_SIZE, FETCH_HARD_CAP - offset);
    const url =
      `${cfg.baseUrl}/rest/v1/thoughts` +
      `?select=${selectCols}` +
      `&created_at=gte.${sinceIso}` +
      `&order=created_at.desc` +
      `&limit=${limit}&offset=${offset}` +
      excludeFilter;

    const res = await fetch(url, { headers });

    // If sensitivity_tier column doesn't exist on this install, PostgREST
    // returns 400 with "column does not exist". FAIL CLOSED: do not retry
    // unfiltered, because that would silently leak restricted/personal
    // thoughts on a brain that relies on the primitive's promise. Print a
    // clear error and instruct the user how to proceed.
    if (!res.ok && !noSensitivityFilter && res.status === 400) {
      const text = await res.text();
      if (/sensitivity_tier/.test(text)) {
        console.error(
          "[weekly-digest] FATAL: sensitivity_tier column not found on public.thoughts.\n" +
            "\n" +
            "This recipe refuses to run unfiltered because the README promises\n" +
            "that restricted thoughts never leave the database. Running without\n" +
            "the column would silently send every row — including anything you\n" +
            "would have tagged restricted/personal — to the LLM and delivery target.\n" +
            "\n" +
            "You have two options:\n" +
            "  1. (Recommended) Install a sensitivity-tiers migration that adds the\n" +
            "     `sensitivity_tier TEXT` column to public.thoughts, then re-run.\n" +
            "  2. Pass --no-sensitivity-filter to explicitly accept that ALL thoughts\n" +
            "     in the window will be exfiltrated. Do NOT do this on a brain that\n" +
            "     holds secrets, credentials, health data, or private correspondence.\n" +
            "\n" +
            "PostgREST error detail: " + text,
        );
        process.exit(1);
      }
      throw new Error(`thoughts fetch failed: ${res.status} ${text}`);
    }

    if (!res.ok) {
      throw new Error(`thoughts fetch failed: ${res.status} ${await res.text()}`);
    }

    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < limit) break;
  }

  return all;
}

/**
 * Read the importance score for a thought. Stock OB1 has no `importance`
 * column on public.thoughts; capture pipelines that score importance stash
 * it under `metadata.importance`. We prefer a native top-level `importance`
 * if a given install happens to have one (via COALESCE-style logic), then
 * fall back to `metadata.importance`, then 0.
 *
 * Accepts number or numeric string in metadata (JSON round-trip safety).
 */
function thoughtImportance(t) {
  const native = t?.importance;
  if (typeof native === "number" && Number.isFinite(native)) return native;
  const m = t?.metadata?.importance;
  if (typeof m === "number" && Number.isFinite(m)) return m;
  if (typeof m === "string") {
    const n = Number(m);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Ranks the fetched pool by importance, falling back to recency when
 * importance ties or is missing. If there aren't enough thoughts at or above
 * the minImportance threshold we widen the pool so the digest doesn't come
 * out thin — a week with few high-importance thoughts should still produce
 * something worth reading.
 */
function rankAndTrim(thoughts, minImportance) {
  const sorted = [...thoughts].sort((a, b) => {
    const ai = thoughtImportance(a);
    const bi = thoughtImportance(b);
    if (bi !== ai) return bi - ai;
    return String(b.created_at).localeCompare(String(a.created_at));
  });

  const highImportance = sorted.filter((t) => thoughtImportance(t) >= minImportance);
  if (highImportance.length < 10) {
    console.warn(
      `[weekly-digest] only ${highImportance.length} thought(s) at or above ` +
        `--min-importance=${minImportance}; widening pool to top 60 by importance+recency. ` +
        `If your brain doesn't score importance (stock OB1 has no importance column ` +
        `and this recipe reads metadata.importance), pass --min-importance=0.`,
    );
  }
  const pool = highImportance.length >= 10 ? highImportance : sorted.slice(0, 60);
  return pool.slice(0, 200);
}

// ── LLM synthesis ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "You write tight weekly digests for a personal second brain. " +
  "Output plain text formatted for a Telegram chat (NOT markdown). " +
  "Use section headers with emoji, short bullets. Max 1500 characters total. " +
  "Sections: Wins, Key decisions, Open loops, Themes. " +
  "Be specific — name projects and tasks. Skip filler.";

function buildUserPrompt(thoughts, startDate, endDate) {
  const fmt = (d) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const rows = thoughts.slice(0, SYNTHESIZE_INPUT_CAP).map((t) => ({
    id: t.id,
    date: String(t.created_at || "").slice(0, 10),
    type: t.metadata?.type ?? null,
    importance: thoughtImportance(t) || null,
    content: String(t.content || "").slice(0, 280),
    topics: (t.metadata?.topics ?? []).slice(0, 5),
    tags: (t.metadata?.tags ?? []).slice(0, 5),
  }));

  return (
    `Weekly digest for ${fmt(startDate)} – ${fmt(endDate)}.\n` +
    `Source: ${rows.length} high-signal thoughts.\n\n` +
    `INPUT:\n${JSON.stringify(rows)}\n\n` +
    `Produce the digest now.`
  );
}

async function synthesizeAnthropic(cfg, model, systemPrompt, userPrompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": cfg.llmKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic call failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body?.content?.[0]?.text?.trim() || "";
}

async function synthesizeOpenRouter(cfg, model, systemPrompt, userPrompt) {
  // OpenRouter uses the OpenAI chat/completions shape. For Claude models we
  // prefix "anthropic/" unless the caller already passed a slash-namespaced
  // model id (e.g. "anthropic/claude-opus-4-7" or "openai/gpt-4o").
  const namespacedModel = model.includes("/") ? model : `anthropic/${model}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.llmKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: namespacedModel,
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter call failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body?.choices?.[0]?.message?.content?.trim() || "";
}

async function synthesize(cfg, thoughts, windowDays, model) {
  const endDate = new Date();
  const startDate = new Date(Date.now() - (windowDays - 1) * 86_400_000);
  const userPrompt = buildUserPrompt(thoughts, startDate, endDate);

  const text =
    cfg.llmProvider === "anthropic"
      ? await synthesizeAnthropic(cfg, model, SYSTEM_PROMPT, userPrompt)
      : await synthesizeOpenRouter(cfg, model, SYSTEM_PROMPT, userPrompt);

  if (!text) throw new Error("LLM returned empty digest");
  return { text, startDate, endDate };
}

// ── Delivery ────────────────────────────────────────────────────────────────

/**
 * Telegram text messages cap at 4096 chars. If the digest goes over, split
 * on paragraph boundaries so we don't chop mid-bullet.
 */
function chunkForTelegram(text, limit = TELEGRAM_CHUNK_LIMIT) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    // Prefer to break on a double newline (paragraph), else single newline.
    let cut = remaining.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.5) cut = remaining.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function deliverTelegram(cfg, text) {
  const url = `https://api.telegram.org/bot${cfg.telegramBotToken}/sendMessage`;
  const messageIds = [];
  for (const chunk of chunkForTelegram(text)) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: cfg.telegramChatId,
        text: chunk,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Telegram sendMessage failed: ${res.status} ${await res.text()}`,
      );
    }
    const body = await res.json();
    if (body?.result?.message_id) messageIds.push(body.result.message_id);
  }
  return messageIds;
}

function deliverFile(text, startDate, endDate, model, sourceCount) {
  const dir = path.resolve(process.cwd(), "digests");
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${endDate.toISOString().slice(0, 10)}.md`;
  const filepath = path.join(dir, filename);

  const frontmatter = [
    "---",
    `title: Weekly Digest ${endDate.toISOString().slice(0, 10)}`,
    "type: weekly-digest",
    `period_start: ${startDate.toISOString().slice(0, 10)}`,
    `period_end: ${endDate.toISOString().slice(0, 10)}`,
    `generated_at: ${new Date().toISOString()}`,
    `generated_by_model: ${model}`,
    `source_thought_count: ${sourceCount}`,
    "tags: [weekly-digest, synthesis]",
    "---",
    "",
  ].join("\n");

  fs.writeFileSync(filepath, frontmatter + text + "\n", "utf8");
  return filepath;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(args);

  console.log(
    `[weekly-digest] window=${args.window}d min_importance=${args.minImportance} ` +
      `model=${args.model} output=${args.output} include_personal=${args.includePersonal}`,
  );

  const pool = await fetchThoughts(cfg, {
    windowDays: args.window,
    includePersonal: args.includePersonal,
    noSensitivityFilter: args.noSensitivityFilter,
  });
  console.log(`[weekly-digest] fetched ${pool.length} thoughts from window`);

  if (pool.length === 0) {
    console.log("[weekly-digest] no thoughts in window; nothing to digest");
    return;
  }

  const ranked = rankAndTrim(pool, args.minImportance);
  console.log(`[weekly-digest] ranked pool: ${ranked.length} thoughts`);

  const { text: digest, startDate, endDate } = await synthesize(
    cfg,
    ranked,
    args.window,
    args.model,
  );
  console.log(`[weekly-digest] synthesized ${digest.length} chars`);
  console.log("───── DIGEST ─────");
  console.log(digest);
  console.log("───── END ─────");

  if (args.dryRun) {
    console.log("[weekly-digest] --dry-run set; skipping delivery");
    return;
  }

  if (args.output === "stdout") {
    // Digest already printed above; nothing more to do.
    return;
  }

  if (args.output === "file") {
    const filepath = deliverFile(
      digest,
      startDate,
      endDate,
      args.model,
      ranked.length,
    );
    console.log(`[weekly-digest] wrote ${filepath}`);
    return;
  }

  if (args.output === "telegram") {
    const ids = await deliverTelegram(cfg, digest);
    console.log(
      `[weekly-digest] posted to Telegram (${ids.length} message${ids.length === 1 ? "" : "s"}): ${ids.join(", ")}`,
    );
    return;
  }
}

main().catch((err) => {
  console.error("[weekly-digest] FAILED:", err?.message || err);
  process.exit(1);
});
