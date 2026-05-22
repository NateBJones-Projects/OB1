// supabase/functions/auditor/index.ts
//
// Weekly drift + contradiction auditor for Open Brain.
//
// What it does (per editorial-policy.md R8.3, R10.5):
//   1. Fetches last N days of synthesizable thoughts.
//   2. Fetches the last 4 audit_reports for longitudinal context.
//   3. Calls OpenRouter with a policy-aware prompt that returns structured JSON.
//   4. Stores findings as a new thought (type=audit_report), append-only.
//   5. Posts a Slack-mrkdwn summary to the digest channel ONLY if any
//      severity:critical findings exist (low-noise channel discipline).
//
// Required env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   OPENROUTER_API_KEY
//   SLACK_BOT_TOKEN, SLACK_CAPTURE_CHANNEL (or SLACK_DIGEST_CHANNEL to override)
//   AUDITOR_ACCESS_KEY (random secret you set; gates the function URL)
//   POLICY_VERSION (optional; defaults to "1.3", bump when editorial-policy.md changes)
//
// Schedule: see schedule.sql in this recipe folder.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Env ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN")!;
const SLACK_CAPTURE_CHANNEL = Deno.env.get("SLACK_CAPTURE_CHANNEL")!;
const SLACK_DIGEST_CHANNEL =
  Deno.env.get("SLACK_DIGEST_CHANNEL") ?? SLACK_CAPTURE_CHANNEL;
const AUDITOR_ACCESS_KEY = Deno.env.get("AUDITOR_ACCESS_KEY")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const POLICY_VERSION = Deno.env.get("POLICY_VERSION") ?? "1.3"; // bump when docs/editorial-policy.md changes

// Types EXCLUDED from the audit corpus.
// Note: briefings and summaries ARE included — drift in synthesis outputs is
// a high-value failure mode the auditor specifically watches for (R3 + drift
// category). The auditor is the one synthesis layer that DOES audit other
// syntheses, in contrast to R2.2 which forbids briefings from re-summarising
// briefings.
const EXCLUDED_TYPES = new Set([
  "audit_report",      // don't recursively audit audits — previous_audits chain handles this (R8.3)
  "connection_digest", // synthesis output — auditor doesn't audit other syntheses' digests
  "fragment",          // R5.2 — fragments are noise by definition, surfacing them as findings would be repetitive
  "dossier",           // R2.1 read-only; out of scope until wiki layer ships
]);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Types ────────────────────────────────────────────────────────────────
interface Thought {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface PriorAudit {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

type Severity = "critical" | "moderate" | "minor";
type Category =
  | "contradiction"
  | "drift"
  | "staleness"
  | "gap"
  | "confidence_trap";

interface Finding {
  severity: Severity;
  category: Category;
  rule_violated: string | null; // e.g. "R3.3"
  thought_ids: string[];
  description: string;
  suggested_remediation: string;
}

interface AuditResult {
  audit_window: { start: string; end: string; thought_count: number };
  previous_audit_id: string | null;
  policy_version: string;
  findings: Finding[];
  slack_summary: string; // mrkdwn; only surfaced when critical findings exist
  baseline_note: string | null; // first-run context message
}

// ── Data fetching ────────────────────────────────────────────────────────
async function fetchAuditCorpus(days: number): Promise<Thought[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("thoughts")
    .select("id, content, metadata, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`fetchAuditCorpus failed: ${error.message}`);
  return ((data ?? []) as Thought[]).filter((t) => {
    const type = String(
      (t.metadata as Record<string, unknown> | null)?.type ?? "",
    );
    return !EXCLUDED_TYPES.has(type);
  });
}

async function fetchPriorAudits(limit: number): Promise<PriorAudit[]> {
  const { data, error } = await supabase.rpc("get_recent_audit_reports", {
    p_limit: limit,
  });
  if (error) {
    console.warn(`get_recent_audit_reports rpc failed: ${error.message}`);
    return [];
  }
  return (data ?? []) as PriorAudit[];
}

// ── Prompt construction ──────────────────────────────────────────────────
function buildSystemPrompt(): string {
  return `Follow Open Brain Editorial Policy v${POLICY_VERSION}. You are the operator's brain auditor.

Your job: scan the supplied corpus of recent thoughts plus the last few audit reports, and produce a STRUCTURED JSON audit report.

You are skeptical by default. Confident prose is a signal to look harder, not a signal that things are correct. But you NEVER flag something unless you can tie it to a specific numbered rule or a concrete contradiction between thought_ids you can name.

Failure modes to detect (exhaustive list — do not invent new categories):
- "contradiction" — two thoughts disagree on a fact, decision, date, or status. Surface both, do NOT resolve. (R6.1, R6.2)
- "drift" — a synthesis output (or a captured thought that paraphrases earlier captures) deviates from the literal source. Compare against R3.1, R3.2, R3.3.
- "staleness" — a task/reference/observation references time-sensitive info ("currently", "by next week") with timestamps now stale.
- "gap" — a topic appears repeatedly but lacks a coherent compiled view; a connection is implied across multiple thoughts but never made explicit.
- "confidence_trap" — a passage reads with high confidence yet has weak provenance. Cite or skip (R3.4).

Severity rubric (strict — calibrated to a personal brain that doesn't want noise):
- "critical" — ACTIVELY wrong information that the operator would act on this week, OR a contradiction between two thoughts on a fact that matters to a current open commitment. Stale dates and historical context are NEVER critical — they're just history. A task that referenced "by Friday" three weeks ago is not critical, it's at most moderate.
- "moderate" — a contradiction, drift, or gap that distorts current retrieval. Includes: stale references that might still be queried; missing compiled views over recurring topics; inflated metadata on thin captures.
- "minor" — stylistic policy violation that's annoying but harmless. Inflated topics on a single capture; placeholder language; minor R4.x violations.

Default to a LOWER severity when uncertain. Inflating severity is itself a violation of R4 (anti-inflation).

Drift category requires specific evidence:
- A "drift" finding must cite VERBATIM TEXT from a synthesis output (briefing, summary) and the SOURCE thought_id whose claim it distorted.
- "Two summaries focused on different topics" is NOT drift — it's the summaries correctly reflecting different weeks. Do NOT flag this.
- Drift is when a synthesis says X about source Y, but Y doesn't say X. Cite the specific phrase that misrepresents source.

UUID discipline:
- thought_ids in findings MUST be copied VERBATIM from the [id=...] tags in the corpus. Never reformat, abbreviate, or guess. UUIDs are 36 characters with four hyphens.
- If you're unsure about an id, omit the finding rather than guessing.

False-positive guardrail (strict):
- If a finding cannot be tied to a specific numbered rule (R3.x, R4.x, R6.x, R7.x) OR a concrete pair of conflicting thought_ids with verifiable conflicting claims, do NOT include it.
- An empty findings array is the correct answer when nothing meaningful is wrong. The auditor that flags noise is worse than the auditor that flags nothing.
- Do not re-flag findings from previous audit reports unless the underlying issue persists in the current corpus.
- Do not flag captures as drift just because they sound polished. Compile cite-evidence first.
- Do not flag inflation patterns that the extractor's R5.2 fragment classification has already captured (don't re-flag fragments).

Output format (return ONE JSON object, no preamble, no commentary):
{
  "findings": [
    {
      "severity": "critical" | "moderate" | "minor",
      "category": "contradiction" | "drift" | "staleness" | "gap" | "confidence_trap",
      "rule_violated": "R3.3" | "R6.1" | ... | null,
      "thought_ids": ["uuid", ...],
      "description": "1-2 sentence factual statement of the issue. No editorializing.",
      "suggested_remediation": "Concrete action: delete X, add edge Y between A and B, mark Z superseded, etc."
    }
  ],
  "slack_summary": "Slack mrkdwn string. Only used if any finding is severity=critical. If no critical findings, set to empty string."
}

Slack summary format (used ONLY when at least one critical finding exists):
*:mag: Brain audit — {N critical, M moderate, K minor}*
• {one bullet per CRITICAL finding only — max 5. Format: "[Rxxx] {category}: {1-line description}". If rule_violated is null, use the category in brackets like "[contradiction]".}
_See audit_report for full findings._

Do NOT include moderate or minor findings in the Slack summary. They live in the stored audit_report, not in Slack. Slack discipline matters — the operator only wants to be paged on Critical.

If there are zero critical findings, slack_summary MUST be the empty string "". The function will not post anything to Slack in that case.

Few-shot anchors:

INPUT (excerpt, illustrative):
[id=t1, 2026-04-15] "9 Mile feasibility timeline is 12 weeks per engineering."
[id=t2, 2026-04-22] "Promised client we'd deliver 9 Mile feasibility in 8 weeks."
OUTPUT:
{
  "findings": [{
    "severity": "critical",
    "category": "contradiction",
    "rule_violated": "R6.1",
    "thought_ids": ["t1", "t2"],
    "description": "9 Mile feasibility timeline disagreement: engineering 12 weeks vs. client commitment 8 weeks.",
    "suggested_remediation": "Add thought_edges row (t1, t2, relation='contradicts'). Surface the gap to the operator for resolution."
  }],
  "slack_summary": "*:mag: Brain audit — 1 critical, 0 moderate, 0 minor*\\n• [R6.1] 9 Mile feasibility timeline contradiction (engineering 12wk vs client commitment 8wk)\\n_See full audit_report for moderate/minor findings._"
}

INPUT (excerpt):
[id=t3, 2026-05-06] "Plain text capture test"  metadata.topics=["test","capture"]
OUTPUT:
{
  "findings": [{
    "severity": "minor",
    "category": "drift",
    "rule_violated": "R4.1",
    "thought_ids": ["t3"],
    "description": "Topic 'test' is generic placeholder on a thin/test capture. Per R5.2 should have been classified type=fragment with empty topics.",
    "suggested_remediation": "Reclassify as type=fragment or delete via delete_thoughts(type='fragment')."
  }],
  "slack_summary": ""
}

INPUT: corpus is small or unremarkable.
OUTPUT: { "findings": [], "slack_summary": "" }`;
}

function buildUserMessage(
  corpus: Thought[],
  priorAudits: PriorAudit[],
  windowDays: number,
): string {
  const corpusBlock = corpus
    .map((t) => {
      const meta = t.metadata as Record<string, unknown> | null;
      const type = String(meta?.type ?? "unknown");
      const topics = Array.isArray(meta?.topics) ? (meta!.topics as string[]) : [];
      const people = Array.isArray(meta?.people) ? (meta!.people as string[]) : [];
      const confidence = String(meta?.confidence ?? "");
      const tags = [
        `type=${type}`,
        topics.length ? `topics=[${topics.join(", ")}]` : "",
        people.length ? `people=[${people.join(", ")}]` : "",
        confidence ? `confidence=${confidence}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      // Truncate content to keep prompt bounded.
      const snippet = (t.content ?? "").slice(0, 300).replace(/\s+/g, " ");
      return `[id=${t.id}, ${t.created_at}, ${tags}]\n${snippet}`;
    })
    .join("\n\n");

  const priorBlock = priorAudits.length
    ? priorAudits
        .map((a) => {
          const c = (a.content ?? "").slice(0, 1500).replace(/\s+/g, " ");
          return `[prior_audit id=${a.id}, ${a.created_at}]\n${c}`;
        })
        .join("\n\n")
    : "(no prior audit reports — this is the baseline run)";

  return `Audit window: last ${windowDays} days
Corpus size: ${corpus.length} thoughts (excluding fragments, briefings, summaries, and prior audit reports)

# Recent thoughts (chronological)
${corpusBlock || "(empty corpus)"}

# Last few audit reports (for longitudinal context — do not re-flag resolved issues)
${priorBlock}

Produce the structured audit JSON now.`;
}

// ── LLM call ─────────────────────────────────────────────────────────────
async function callAuditor(
  systemPrompt: string,
  userMessage: string,
): Promise<{ findings: Finding[]; slack_summary: string }> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": SUPABASE_URL,
      "X-Title": "Open Brain Auditor",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Auditor returned non-JSON: ${(e as Error).message}`);
  }

  const obj = parsed as Record<string, unknown>;
  const findings = Array.isArray(obj.findings) ? (obj.findings as Finding[]) : [];
  const slack_summary =
    typeof obj.slack_summary === "string" ? obj.slack_summary : "";

  // Light validation pass — drop malformed findings rather than fail the whole audit.
  const VALID_SEVERITIES: Severity[] = ["critical", "moderate", "minor"];
  const VALID_CATEGORIES: Category[] = [
    "contradiction",
    "drift",
    "staleness",
    "gap",
    "confidence_trap",
  ];
  // UUID v4-ish regex (any RFC 4122 UUID — we don't gate on version).
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const cleaned: Finding[] = [];
  let droppedForBadUuid = 0;
  let droppedForNoEvidence = 0;
  for (const f of findings) {
    if (!f || typeof f !== "object") continue;
    if (!VALID_SEVERITIES.includes(f.severity)) continue;
    if (!VALID_CATEGORIES.includes(f.category)) continue;
    if (!Array.isArray(f.thought_ids)) continue;
    if (typeof f.description !== "string" || !f.description.trim()) continue;
    if (
      typeof f.suggested_remediation !== "string" ||
      !f.suggested_remediation.trim()
    ) {
      continue;
    }

    // Filter thought_ids to only well-formed UUIDs. The LLM occasionally
    // truncates or hallucinates IDs; bad IDs break the suggested_remediation.
    const validIds = f.thought_ids.filter(
      (x: unknown) => typeof x === "string" && UUID_RE.test(x),
    );
    const hadIds = f.thought_ids.length > 0;
    if (hadIds && validIds.length === 0) {
      droppedForBadUuid++;
      continue;
    }

    const ruleClean =
      typeof f.rule_violated === "string" && f.rule_violated.trim()
        ? f.rule_violated.trim()
        : null;

    // False-positive guardrail enforced server-side too: a finding without
    // EITHER a rule citation OR concrete thought_ids is noise. Drop it.
    if (!ruleClean && validIds.length === 0) {
      droppedForNoEvidence++;
      continue;
    }

    cleaned.push({
      severity: f.severity,
      category: f.category,
      rule_violated: ruleClean,
      thought_ids: validIds,
      description: f.description.trim(),
      suggested_remediation: f.suggested_remediation.trim(),
    });
  }

  if (droppedForBadUuid > 0 || droppedForNoEvidence > 0) {
    console.warn(
      `auditor dropped findings: ${droppedForBadUuid} bad uuid, ${droppedForNoEvidence} no evidence`,
    );
  }
  return { findings: cleaned, slack_summary };
}

// ── Storage ──────────────────────────────────────────────────────────────
function buildAuditContent(result: AuditResult): string {
  // Markdown-ish summary stored as the thought's content.
  // The structured findings live in metadata; the content is human-scannable.
  const lines: string[] = [];
  lines.push(
    `*:mag: Brain audit — ${result.findings.length} finding${
      result.findings.length === 1 ? "" : "s"
    }*`,
  );
  lines.push(
    `Window: ${result.audit_window.start} → ${result.audit_window.end} (${result.audit_window.thought_count} thoughts)`,
  );
  lines.push(`Policy: v${result.policy_version}`);
  if (result.previous_audit_id) {
    lines.push(`Previous audit: ${result.previous_audit_id}`);
  }
  if (result.baseline_note) {
    lines.push(`_${result.baseline_note}_`);
  }
  lines.push("");

  const bySeverity: Record<Severity, Finding[]> = {
    critical: [],
    moderate: [],
    minor: [],
  };
  for (const f of result.findings) bySeverity[f.severity].push(f);

  for (const sev of ["critical", "moderate", "minor"] as Severity[]) {
    const list = bySeverity[sev];
    if (!list.length) continue;
    const icon = sev === "critical" ? ":red_circle:" : sev === "moderate" ? ":large_yellow_circle:" : ":large_green_circle:";
    lines.push(`${icon} *${sev}* (${list.length})`);
    for (const f of list) {
      const rule = f.rule_violated ? `[${f.rule_violated}] ` : "";
      const ids = f.thought_ids.length
        ? ` (refs: ${f.thought_ids.slice(0, 5).join(", ")})`
        : "";
      lines.push(`• ${rule}${f.category}: ${f.description}${ids}`);
      lines.push(`  _Remediation:_ ${f.suggested_remediation}`);
    }
    lines.push("");
  }

  if (result.findings.length === 0) {
    lines.push("_No findings. Brain looks clean for this window._");
  }

  return lines.join("\n").trim();
}

async function storeAuditReport(result: AuditResult): Promise<string> {
  const content = buildAuditContent(result);
  const { data, error } = await supabase
    .from("thoughts")
    .insert({
      content,
      metadata: {
        type: "audit_report",
        source: "auditor-function",
        generator: "auditor",
        policy_version: result.policy_version,
        generated_at: new Date().toISOString(),
        audit_window_start: result.audit_window.start,
        audit_window_end: result.audit_window.end,
        audit_thought_count: result.audit_window.thought_count,
        previous_audit_id: result.previous_audit_id,
        finding_count: result.findings.length,
        critical_count: result.findings.filter((f) => f.severity === "critical").length,
        moderate_count: result.findings.filter((f) => f.severity === "moderate").length,
        minor_count: result.findings.filter((f) => f.severity === "minor").length,
        findings: result.findings, // structured, queryable
      },
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`audit_report insert failed: ${error?.message ?? "unknown"}`);
  }
  return data.id as string;
}

// ── Slack ────────────────────────────────────────────────────────────────
async function postToSlack(channel: string, text: string): Promise<void> {
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      text,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(`Slack post failed: ${d.error}`);
}

// ── HTTP entrypoint ──────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key") ?? req.headers.get("x-auditor-key");
    if (key !== AUDITOR_ACCESS_KEY) {
      return new Response("unauthorized", { status: 401 });
    }

    const body = req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};

    const days: number = Number.isFinite(body.days) ? body.days : 30;
    const postSlackFlag: boolean = body.post_to_slack ?? true;
    const dryRun: boolean = body.dry_run ?? false;
    const priorAuditCount: number = Number.isFinite(body.prior_audit_count)
      ? body.prior_audit_count
      : 4;

    const corpus = await fetchAuditCorpus(days);
    const priorAudits = await fetchPriorAudits(priorAuditCount);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    if (corpus.length === 0) {
      // Empty window — produce an explicit baseline-style audit.
      const baselineResult: AuditResult = {
        audit_window: { start: since, end: now, thought_count: 0 },
        previous_audit_id: priorAudits[0]?.id ?? null,
        policy_version: POLICY_VERSION,
        findings: [],
        slack_summary: "",
        baseline_note:
          "No synthesizable thoughts in window. Audit skipped LLM call; storing empty report for time-series continuity (R8.3).",
      };
      let storedId: string | null = null;
      if (!dryRun) storedId = await storeAuditReport(baselineResult);
      return new Response(
        JSON.stringify({
          ok: true,
          stored_id: storedId,
          finding_count: 0,
          posted_to_slack: false,
          baseline: true,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    const systemPrompt = buildSystemPrompt();
    const userMessage = buildUserMessage(corpus, priorAudits, days);
    const { findings, slack_summary } = await callAuditor(
      systemPrompt,
      userMessage,
    );

    const result: AuditResult = {
      audit_window: { start: since, end: now, thought_count: corpus.length },
      previous_audit_id: priorAudits[0]?.id ?? null,
      policy_version: POLICY_VERSION,
      findings,
      slack_summary,
      baseline_note:
        priorAudits.length === 0
          ? "First audit run — no prior audits to chain against. This becomes the baseline."
          : null,
    };

    let storedId: string | null = null;
    if (!dryRun) {
      storedId = await storeAuditReport(result);
    }

    const criticalCount = findings.filter((f) => f.severity === "critical").length;
    const shouldPostSlack =
      postSlackFlag && !dryRun && criticalCount > 0 && slack_summary.trim();

    if (shouldPostSlack) {
      await postToSlack(SLACK_DIGEST_CHANNEL, slack_summary);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        stored_id: storedId,
        finding_count: findings.length,
        critical_count: criticalCount,
        moderate_count: findings.filter((f) => f.severity === "moderate").length,
        minor_count: findings.filter((f) => f.severity === "minor").length,
        posted_to_slack: shouldPostSlack,
        dry_run: dryRun,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("auditor error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
