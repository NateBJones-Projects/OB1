// supabase/functions/weekly-summary/index.ts
//
// Weekly-summary synthesis for Open Brain.
//
// What it does (per editorial-policy.md R10.2, R8.1, R6, R7.3):
//   1. Fetches the last N days (default 7) of synthesizable thoughts.
//   2. Calls OpenRouter with a policy-citing prompt -> terse Slack-mrkdwn summary
//      at a structural altitude (decisions, open loops, themes, tensions).
//   3. Stores the summary as a new thought (type=weekly_summary), append-only,
//      with provenance (derived_from + derivation_layer='derived').
//   4. Posts the summary to Slack.
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

// R2.2: a summary must NOT summarise prior syntheses or fragments.
const EXCLUDED_TYPES = new Set([
  "morning_briefing",
  "weekly_summary",
  "audit_report",
  "connection_digest",
  "fragment",
  "dossier",
]);

const MAX_DERIVED_FROM = 200;

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

You are the operator's weekly summary assistant. Compile the supplied captures from the last week into a terse Slack-mrkdwn summary at a structural altitude — what shifted, what was decided, what's unresolved.

Sections (ALL OPTIONAL — see R5.5; include a section ONLY when the data supports it):
*Key decisions:* — explicit choices the operator made this week, each with its captured rationale if present. (R3.4)
*Open loops:* — unresolved tasks, questions, or commitments still live at week's end. Keep the operator's own wording. (R3.5, R4.4)
*Themes:* — subjects where >=3 thoughts converge. (R5.3)
*Tensions:* — where two captures disagree on a fact, date, role, or status. List BOTH sides with their (id: <prefix>) references. Do NOT pick a winner or smooth into one narrative. (R6.1, R6.2)

Hard rules:
- HARD LENGTH LIMIT: 250 words for the ENTIRE summary. This is a ceiling, not a target — prefer fewer. A tight 120-word summary beats a complete 400-word one. (R4.5, R9.4)
- At most 5 bullets per section. If more qualify, keep only the 5 most decision-relevant and drop the rest — do NOT add an "and more" / "others include" line. (R4.5)
- If space is tight, prioritise sections in this order and cut from the bottom: Tensions > Key decisions > Open loops > Themes. A whole section may be omitted.
- One line per bullet. Compress; do not let a bullet run to a second sentence unless a contradiction genuinely needs both sides.
- Surface contradictions, do NOT resolve them — the gap is the signal. (R6)
- When referencing a specific capture, cite it inline as (id: <first 8 chars of the uuid>). Copy ids verbatim from the [id=...] tags; never invent one. (R3.4, R7.1)
- Tasks/reminders stay literal; never inflate a single task into a theme. (R3.5, R5.3)
- No narrative arc, no editorial glue. Bullets over prose. (R4.2, R4.3)
- Thin input -> thin output. Empty sections are correct. (R5.1, R5.5)
- Slack mrkdwn only: *bold*, _italic_, • bullets. No # headers, no tables, no code fences. (R9.1)
- Direct, informational voice. No greetings, closings, or second-person address. (R9.2)
- Never invent people, dates, topics, or claims not present in the source. (R3.1)
- The corpus already excludes fragments and prior synthesis outputs (R2.2).

Output ONLY the summary text (no preamble, no JSON, no commentary). Start with the header line exactly:
*Weekly summary — week of {DATE}*
using the DATE provided in the user message. If there is nothing substantive, output only the header plus:
_No substantive captures this week._`;
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

function buildUserMessage(corpus: Thought[], days: number, weekOf: string): string {
  return `Week of: ${weekOf}
Window: last ${days} day(s)
Corpus size: ${corpus.length} thoughts (fragments and prior syntheses already excluded)

# Captured thoughts (chronological)
${corpusBlock(corpus) || "(empty corpus)"}

Produce the weekly summary now. Use exactly "${weekOf}" in the header.`;
}

// ── LLM ──────────────────────────────────────────────────────────────────
async function synthesize(system: string, user: string): Promise<string> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": SUPABASE_URL,
      "X-Title": "Open Brain Weekly Summary",
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
  let out = text.trim();
  if (out.startsWith("```")) {
    out = out.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return out;
}

// ── Store ────────────────────────────────────────────────────────────────
async function storeSummary(
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
        type: "weekly_summary",
        source: "weekly-summary-function",
        generator: "weekly-summary",
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
    throw new Error(`weekly_summary insert failed: ${error?.message ?? "unknown"}`);
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
    const days: number = Number.isFinite(body.days) ? body.days : 7;
    const postSlackFlag: boolean = body.post_to_slack ?? true;
    const dryRun: boolean = body.dry_run ?? false;

    const now = new Date();
    const windowEnd = now.toISOString();
    const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const weekOf = windowStart.slice(0, 10);

    const corpus = await fetchCorpus(days);

    let content: string;
    if (corpus.length === 0) {
      content = `*Weekly summary — week of ${weekOf}*\n_No substantive captures this week._`;
    } else {
      content = await synthesize(buildSystemPrompt(), buildUserMessage(corpus, days, weekOf));
    }

    let storedId: string | null = null;
    if (!dryRun) storedId = await storeSummary(content, corpus, windowStart, windowEnd);

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
    console.error("weekly-summary error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
