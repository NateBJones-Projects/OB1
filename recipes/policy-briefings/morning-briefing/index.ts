// supabase/functions/morning-briefing/index.ts
//
// Daily morning-briefing synthesis for Open Brain.
//
// What it does (per editorial-policy.md R10.2, R8.1, R7.3):
//   1. Fetches the last N days (default 1) of synthesizable thoughts.
//   2. Calls OpenRouter with a policy-citing prompt -> terse Slack-mrkdwn briefing.
//   3. Stores the briefing as a new thought (type=morning_briefing), append-only,
//      with provenance (derived_from + derivation_layer='derived').
//   4. Posts the briefing to Slack.
//
// Required env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   OPENROUTER_API_KEY
//   SLACK_BOT_TOKEN, SLACK_CAPTURE_CHANNEL (or SLACK_DIGEST_CHANNEL to override)
//   SYNTHESIS_ACCESS_KEY (random secret; gates the function URL)
//   POLICY_VERSION (optional; defaults to "1.3")

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Env ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN")!;
const SLACK_CAPTURE_CHANNEL = Deno.env.get("SLACK_CAPTURE_CHANNEL")!;
const SLACK_DIGEST_CHANNEL =
  Deno.env.get("SLACK_DIGEST_CHANNEL") ?? SLACK_CAPTURE_CHANNEL;
const SYNTHESIS_ACCESS_KEY = Deno.env.get("SYNTHESIS_ACCESS_KEY")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const POLICY_VERSION = Deno.env.get("POLICY_VERSION") ?? "1.3";
const MODEL = "anthropic/claude-haiku-4-5";

// R2.2: a briefing must NOT summarise prior syntheses or fragments.
const EXCLUDED_TYPES = new Set([
  "morning_briefing",
  "weekly_summary",
  "audit_report",
  "connection_digest",
  "fragment",
  "dossier",
]);

const MAX_DERIVED_FROM = 200; // cap the provenance array size

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface Thought {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ── Data ─────────────────────────────────────────────────────────────────
async function fetchCorpus(days: number): Promise<Thought[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("thoughts")
    .select("id, content, metadata, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`fetchCorpus failed: ${error.message}`);
  return ((data ?? []) as Thought[]).filter((t) => {
    const type = String((t.metadata as Record<string, unknown> | null)?.type ?? "");
    return !EXCLUDED_TYPES.has(type);
  });
}

// ── Prompt ───────────────────────────────────────────────────────────────
function buildSystemPrompt(): string {
  return `Follow Open Brain Editorial Policy v${POLICY_VERSION}. Specific rules referenced below by number.

You are the operator's morning briefing assistant. Compile the supplied captures from the last day into a terse Slack-mrkdwn briefing.

Sections (ALL OPTIONAL — see R5.5; include a section ONLY when the data supports it):
*Action items:* — every captured task or reminder, VERBATIM in the operator's own words, one bullet each. (R3.5, R4.4)
*Themes:* — appears ONLY when >=3 thoughts converge on the same subject. (R5.3)
*Worth revisiting:* — appears ONLY when an older thought genuinely deserves another look. (R3.5)

Hard rules:
- Tasks/reminders go in Action items VERBATIM. Never promote them to themes, prompts, or framing language, and never restate them across sections. One source = at most one output line. (R3.5, R4.4)
- Thin input -> thin output. Empty sections are correct when the data is thin. Do NOT pad. (R5.1, R5.5)
- No narrative arc, no editorial glue. Bullets over prose. Cap ~250 words. (R4.2, R4.3, R4.5)
- Slack mrkdwn only: *bold*, _italic_, • bullets. No # headers, no tables, no code fences. (R9.1)
- Direct, informational voice. No greetings, closings, or second-person address. (R9.2)
- Never invent people, dates, topics, or claims not present in the source. (R3.1)
- The corpus already excludes fragments and prior synthesis outputs (R2.2).

Output ONLY the briefing text (no preamble, no JSON, no commentary). Start with the header line exactly:
*Morning briefing — {DATE}*
using the DATE provided in the user message. If there is nothing substantive, output only the header plus:
_No substantive captures in the last 24h._`;
}

function corpusBlock(corpus: Thought[]): string {
  return corpus
    .map((t) => {
      const meta = t.metadata as Record<string, unknown> | null;
      const type = String(meta?.type ?? "unknown");
      const topics = Array.isArray(meta?.topics) ? (meta!.topics as string[]) : [];
      const people = Array.isArray(meta?.people) ? (meta!.people as string[]) : [];
      const tags = [
        `type=${type}`,
        topics.length ? `topics=[${topics.join(", ")}]` : "",
        people.length ? `people=[${people.join(", ")}]` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const snippet = (t.content ?? "").slice(0, 300).replace(/\s+/g, " ");
      return `[id=${t.id}, ${t.created_at}, ${tags}]\n${snippet}`;
    })
    .join("\n\n");
}

function buildUserMessage(corpus: Thought[], days: number, dateStr: string): string {
  return `Date: ${dateStr}
Window: last ${days} day(s)
Corpus size: ${corpus.length} thoughts (fragments and prior syntheses already excluded)

# Captured thoughts (chronological)
${corpusBlock(corpus) || "(empty corpus)"}

Produce the morning briefing now. Use exactly "${dateStr}" in the header.`;
}

// ── LLM ──────────────────────────────────────────────────────────────────
async function synthesize(system: string, user: string): Promise<string> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": SUPABASE_URL,
      "X-Title": "Open Brain Morning Briefing",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`OpenRouter error ${r.status}: ${body.slice(0, 500)}`);
  }
  const d = await r.json();
  const text = d?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("OpenRouter returned empty content");
  }
  // Strip a stray ```-fence if the model adds one (mrkdwn, not code).
  let out = text.trim();
  if (out.startsWith("```")) {
    out = out.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return out;
}

// ── Store ────────────────────────────────────────────────────────────────
async function storeBriefing(
  content: string,
  corpus: Thought[],
  windowStart: string,
  windowEnd: string,
): Promise<string> {
  const derivedFrom = corpus.slice(0, MAX_DERIVED_FROM).map((t) => t.id);
  const { data, error } = await supabase
    .from("thoughts")
    .insert({
      content,
      derived_from: derivedFrom,
      derivation_method: "synthesis",
      derivation_layer: "derived",
      metadata: {
        type: "morning_briefing",
        source: "morning-briefing-function",
        generator: "morning-briefing",
        model: MODEL,
        policy_version: POLICY_VERSION,
        generated_at: new Date().toISOString(),
        window_start: windowStart,
        window_end: windowEnd,
        source_count: corpus.length,
        derived_from: derivedFrom,
      },
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`morning_briefing insert failed: ${error?.message ?? "unknown"}`);
  }
  return data.id as string;
}

async function postToSlack(channel: string, text: string): Promise<void> {
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(`Slack post failed: ${d.error}`);
}

// ── Entrypoint ───────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key") ?? req.headers.get("x-synthesis-key");
    if (key !== SYNTHESIS_ACCESS_KEY) {
      return new Response("unauthorized", { status: 401 });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const days: number = Number.isFinite(body.days) ? body.days : 1;
    const postSlackFlag: boolean = body.post_to_slack ?? true;
    const dryRun: boolean = body.dry_run ?? false;

    const now = new Date();
    const windowEnd = now.toISOString();
    const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const dateStr = windowEnd.slice(0, 10);

    const corpus = await fetchCorpus(days);

    let content: string;
    if (corpus.length === 0) {
      // R5.1 thin output — do not invent activity (R5.4).
      content = `*Morning briefing — ${dateStr}*\n_No substantive captures in the last 24h._`;
    } else {
      content = await synthesize(buildSystemPrompt(), buildUserMessage(corpus, days, dateStr));
    }

    let storedId: string | null = null;
    if (!dryRun) storedId = await storeBriefing(content, corpus, windowStart, windowEnd);

    const shouldPost = postSlackFlag && !dryRun;
    if (shouldPost) await postToSlack(SLACK_DIGEST_CHANNEL, content);

    return new Response(
      JSON.stringify({
        ok: true,
        stored_id: storedId,
        source_count: corpus.length,
        posted_to_slack: shouldPost,
        dry_run: dryRun,
        content_length: content.length,
        content_words: content.split(/\s+/).filter(Boolean).length,
        preview: content.slice(0, 400),
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("morning-briefing error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
