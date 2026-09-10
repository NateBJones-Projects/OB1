// supabase/functions/daily-digest/index.ts
//
// Daily digest of recent Open Brain thoughts, delivered by email via Resend.
// This is Approach B of the daily-digest recipe: fully automated — no Claude
// session or local machine required. Formatting is pure template code, so no
// LLM key is needed either.
//
// What it does:
//   1. Fetches thoughts captured in the last N hours (default 24).
//   2. Skips personal/restricted sensitivity tiers unless asked not to.
//   3. Groups them by type with a summary header (counts, top topics).
//   4. Emails the digest through Resend (or returns it with dry_run: true).
//
// Required secrets (supabase secrets set KEY=value):
//   RESEND_API_KEY      Resend API key (https://resend.com — free tier is fine)
//   DIGEST_TO_EMAIL     Where the digest goes
//   DIGEST_ACCESS_KEY   Random secret gating the function URL (?key=...)
// Optional:
//   DIGEST_FROM_EMAIL   Verified Resend sender (default: onboarding@resend.dev,
//                       which can only deliver to your own Resend account email)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Edge Function runtime.
//
// Request body (all optional):
//   { "hours": 24, "dry_run": false, "include_personal": false }
//
// Schedule: see schedule.sql in this recipe folder.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const DIGEST_TO_EMAIL = Deno.env.get("DIGEST_TO_EMAIL")!;
const DIGEST_ACCESS_KEY = Deno.env.get("DIGEST_ACCESS_KEY")!;
const DIGEST_FROM_EMAIL =
  Deno.env.get("DIGEST_FROM_EMAIL") ?? "Open Brain <onboarding@resend.dev>";

// Hard cap on thoughts per digest — one day of heavy capture stays readable.
const FETCH_LIMIT = 200;
// Per-thought preview length in the email.
const PREVIEW_CHARS = 200;

// Sensitivity tiers excluded by default (enhanced-thoughts schema). Rows
// without the column are always included.
const PRIVATE_TIERS = new Set(["personal", "restricted"]);

interface ThoughtRow {
  id: string;
  content: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
  // Optional columns from the enhanced-thoughts schema:
  type?: string | null;
  sensitivity_tier?: string | null;
  [key: string]: unknown;
}

function thoughtType(t: ThoughtRow): string {
  return (
    t.type ??
    (t.metadata?.type as string | undefined) ??
    "uncategorized"
  );
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + "…";
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function fetchRecentThoughts(hours: number): Promise<ThoughtRow[]> {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const url =
    `${SUPABASE_URL}/rest/v1/thoughts` +
    `?select=*&created_at=gte.${encodeURIComponent(since)}` +
    `&order=created_at.desc&limit=${FETCH_LIMIT}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`thoughts query failed: ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

function buildDigest(thoughts: ThoughtRow[], hours: number) {
  const today = new Date().toISOString().slice(0, 10);
  const subject = `Open Brain Daily Digest — ${today}`;

  if (thoughts.length === 0) {
    const empty = `No new thoughts captured in the last ${hours} hours.`;
    return { subject, text: empty, html: `<p>${empty}</p>` };
  }

  // Group by type, count topics for the summary header
  const byType = new Map<string, ThoughtRow[]>();
  const topicCounts = new Map<string, number>();
  for (const t of thoughts) {
    const type = thoughtType(t);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(t);
    for (const topic of stringList(t.metadata?.topics)) {
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
  }
  const topTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic, n]) => `${topic} (${n})`);
  const typeBreakdown = [...byType.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([type, rows]) => `${type}: ${rows.length}`);

  const textParts: string[] = [
    `${thoughts.length} thought${thoughts.length === 1 ? "" : "s"} captured in the last ${hours} hours.`,
    `By type: ${typeBreakdown.join(" · ")}`,
  ];
  if (topTopics.length > 0) textParts.push(`Top topics: ${topTopics.join(", ")}`);
  textParts.push("");

  const htmlParts: string[] = [
    `<p><strong>${thoughts.length}</strong> thought${thoughts.length === 1 ? "" : "s"} captured in the last ${hours} hours.<br>`,
    `By type: ${escapeHtml(typeBreakdown.join(" · "))}` +
      (topTopics.length > 0 ? `<br>Top topics: ${escapeHtml(topTopics.join(", "))}` : "") +
      `</p>`,
  ];

  for (const [type, rows] of byType) {
    textParts.push(`## ${type} (${rows.length})`, "");
    htmlParts.push(`<h3>${escapeHtml(type)} (${rows.length})</h3><ul>`);
    for (const t of rows) {
      const preview = truncate(t.content, PREVIEW_CHARS);
      const tags = [
        ...stringList(t.metadata?.topics),
        ...stringList(t.metadata?.people),
      ];
      const suffix = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
      textParts.push(`- ${preview}${suffix}`);
      htmlParts.push(
        `<li>${escapeHtml(preview)}${suffix ? ` <em>${escapeHtml(suffix)}</em>` : ""}</li>`
      );
    }
    textParts.push("");
    htmlParts.push("</ul>");
  }

  return { subject, text: textParts.join("\n"), html: htmlParts.join("\n") };
}

async function sendEmail(digest: { subject: string; text: string; html: string }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: DIGEST_FROM_EMAIL,
      to: [DIGEST_TO_EMAIL],
      subject: digest.subject,
      text: digest.text,
      html: digest.html,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

Deno.serve(async (req) => {
  // Gate: the URL must carry the shared secret (?key=...)
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== DIGEST_ACCESS_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body =
      req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const hours = Math.min(Math.max(Number(body.hours) || 24, 1), 168);
    const dryRun = body.dry_run === true;
    const includePersonal = body.include_personal === true;

    let thoughts = await fetchRecentThoughts(hours);
    if (!includePersonal) {
      thoughts = thoughts.filter(
        (t) => !PRIVATE_TIERS.has(t.sensitivity_tier ?? "")
      );
    }

    const digest = buildDigest(thoughts, hours);

    if (dryRun) {
      return new Response(
        JSON.stringify({ sent: false, thought_count: thoughts.length, ...digest }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const sendResult = await sendEmail(digest);
    return new Response(
      JSON.stringify({
        sent: true,
        thought_count: thoughts.length,
        subject: digest.subject,
        resend_id: sendResult.id ?? null,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("daily-digest failed:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
