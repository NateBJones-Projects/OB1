/**
 * wearable-limitless-capture — Limitless Pendant adapter for wearable-capture-core.
 *
 * Limitless (https://limitless.ai) records spoken life as "lifelogs" and returns
 * each one as Markdown: a title, `##` section headings, and `- Speaker (time):
 * text` transcript bullets. This adapter atomizes that device-native structure —
 * NO LLM call:
 *
 *   - one `title` atom (machine-generated label),
 *   - one `section` atom per `##` heading: the heading label plus its rolled-up
 *     utterances, attributed to the section's speakers (self / other / mixed /
 *     unknown). NO cap on sections — they are Limitless's native unit.
 *
 * The shared core (`_shared/wearable-sync.ts`) owns the write path: per-atom
 * dedup on a salted fingerprint, provenance metadata, embedding via OpenRouter,
 * and the insert into `thoughts`.
 *
 * Deploy this file to `supabase/functions/wearable-limitless-capture/index.ts`.
 * It imports the core from `../_shared/wearable-sync.ts`, so install
 * wearable-capture-core FIRST (see this integration's README). The `_shared/`
 * copy in this folder is a vendored copy of that same engine, present so the
 * function typechecks standalone; the deno.json import map points the deploy
 * path at it for local `deno check`.
 *
 * Limitless API facts this adapter relies on:
 *   - Auth: `X-API-Key: <LIMITLESS_API_KEY>`.
 *   - Base: https://api.limitless.ai/v1
 *   - List: GET /lifelogs?start=&timezone=&limit=&direction=asc&cursor=&includeMarkdown=true
 *           -> { data: { lifelogs: [{ id, title, markdown, startTime, endTime }] },
 *                meta: { lifelogs: { nextCursor } } }. Has a real `start` param.
 */
import {
  type Attribution,
  fetchWithRetry,
  runWearableSync,
  type WearableAdapter,
  type WearableAtom,
} from "../_shared/wearable-sync.ts";

const LIMITLESS_BASE = "https://api.limitless.ai/v1";
/** Safety caps so a wide window or a runaway cursor can't fetch unbounded pages. */
const MAX_RECORDS = 500;
const MAX_PAGES = 30;
/** Cap on a single section atom's content (sections roll up many utterances). */
const SECTION_MAX_CHARS = 4000;

// ── types ─────────────────────────────────────────────────────────────────────

/** A single lifelog as returned by the Limitless API (only the fields we read). */
interface Lifelog {
  id: string;
  title?: string;
  markdown?: string;
  startTime?: string;
  endTime?: string;
}

interface Utterance {
  speaker: string;
  text: string;
}
interface Section {
  label: string | null;
  utterances: Utterance[];
}

// ── speaker classification (generic — no hardcoded personal names) ─────────────

/** Device-generic labels for the wearer. Add your own (e.g. your name) via the
 *  `WEARABLE_SELF_LABELS` env var (comma-separated) — never hardcode a name.
 *  Limitless typically labels the wearer "You". */
const DEFAULT_SELF_LABELS = ["you", "user", "me", "self", "myself"];
const GENERIC_SPEAKER_RE =
  /^(unknown|speaker[\s_]*\d+|spk[\s_]*\d+|user\s*\d+)$/i;

function selfLabelSet(): Set<string> {
  const extra = (Deno.env.get("WEARABLE_SELF_LABELS") ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set([...DEFAULT_SELF_LABELS, ...extra]);
}
const SELF_LABELS = selfLabelSet();

function isSelfSpeaker(name: string): boolean {
  return SELF_LABELS.has(name.trim().toLowerCase());
}
function isGenericSpeaker(name: string): boolean {
  const s = name.trim();
  return !s || GENERIC_SPEAKER_RE.test(s);
}

/** Classify a section's speaker labels into an attribution + self presence + role.
 *  A section with no utterances (just a heading) is a machine-generated label. */
function classifySpeakers(
  speakers: string[],
  hasUtterances: boolean,
): {
  attribution: Attribution;
  selfPresent: boolean;
  role: "author" | "participant" | null;
} {
  if (!hasUtterances) {
    return { attribution: "machine", selfPresent: false, role: null };
  }
  let hasSelf = false, hasNamedOther = false;
  for (const s of speakers) {
    if (isSelfSpeaker(s)) hasSelf = true;
    else if (!isGenericSpeaker(s)) hasNamedOther = true;
  }
  let attribution: Attribution;
  if (hasSelf && hasNamedOther) attribution = "mixed";
  else if (hasSelf) attribution = "self";
  else if (hasNamedOther) attribution = "other";
  else attribution = "unknown";
  const role = hasSelf
    ? (attribution === "self" ? "author" : "participant")
    : null;
  return { attribution, selfPresent: hasSelf, role };
}

const trim = (s: unknown): string =>
  String(s ?? "").replace(/\s+/g, " ").trim();

// ── Markdown -> sections (title -> ## sections -> utterances) ───────────────────

/**
 * Parse Limitless lifelog Markdown into sections. Any heading (`#`..`######`)
 * starts a section; `- Speaker (HH:MM): text` bullets become its utterances.
 * Bullets before the first heading land in a leading label-less section.
 */
function parseSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      cur = { label: h[1].trim(), utterances: [] };
      sections.push(cur);
      continue;
    }
    if (!line.startsWith("- ")) continue;
    const body = line.replace(/^-\s*/, "");
    // "Speaker (HH:MM[:SS] …): text" — the parenthetical holds a clock time.
    const m = body.match(/^(.*?)\s*\([^)]*\d{1,2}:\d{2}[^)]*\)\s*:\s*(.*)$/);
    let speaker: string;
    let text: string;
    if (m) {
      speaker = m[1].trim();
      text = m[2].trim();
    } else {
      const i = body.indexOf(": ");
      if (i > 0) {
        speaker = body.slice(0, i).trim();
        text = body.slice(i + 2).trim();
      } else {
        speaker = "Unknown";
        text = body.trim();
      }
    }
    if (!text) continue;
    if (!cur) {
      cur = { label: null, utterances: [] };
      sections.push(cur);
    }
    cur.utterances.push({ speaker: speaker || "Unknown", text });
  }
  return sections;
}

/**
 * Atomize one lifelog using the device's OWN structure (no LLM): a `title` atom
 * plus one `section` atom per heading (label + rolled-up utterances). No cap on
 * sections — they are Limitless's native unit.
 */
function atomizeLifelog(ll: Lifelog): WearableAtom[] {
  const atoms: WearableAtom[] = [];
  const startedAt = ll.startTime;
  let idx = 0;

  const title = trim(ll.title);
  if (title) {
    atoms.push({
      atomIndex: idx++,
      atomKind: "title",
      content: title,
      type: "meeting",
      attribution: "machine",
      generator: "limitless",
      createdAt: startedAt,
      qualityScore: 45,
      metadata: {},
    });
  }

  const sections = parseSections(ll.markdown ?? "");
  let sectionIndex = 0;
  for (const sec of sections) {
    const speakers = [...new Set(sec.utterances.map((u) => u.speaker))];
    const body = sec.utterances.map((u) => `${u.speaker}: ${u.text}`).join(
      "\n",
    );
    const content = [sec.label, body].filter(Boolean).join("\n");
    if (!trim(content)) continue;
    const cls = classifySpeakers(speakers, sec.utterances.length > 0);
    atoms.push({
      atomIndex: idx++,
      atomKind: "section",
      content: content.slice(0, SECTION_MAX_CHARS),
      type: "meeting",
      attribution: cls.attribution,
      attributedTo: speakers,
      // A section with no utterances is just a heading Limitless generated.
      generator: sec.utterances.length ? null : "limitless",
      selfPresent: cls.selfPresent,
      role: cls.role,
      createdAt: startedAt,
      qualityScore: 55,
      metadata: {
        section_label: sec.label,
        section_index: sectionIndex++,
        speakers,
        utterance_count: sec.utterances.length,
      },
    });
  }

  return atoms;
}

// ── the adapter (driven by the shared core) ────────────────────────────────────

function limitlessKey(): string {
  const key = Deno.env.get("LIMITLESS_API_KEY");
  if (!key) throw new Error("LIMITLESS_API_KEY is required");
  return key;
}

/**
 * Pull lifelogs started at/after `sinceISO`, paging forward (ascending) by
 * following `meta.lifelogs.nextCursor` until it's empty, a page is empty, or a
 * cap is hit. Limitless has a real `start` param, so the window is server-side.
 */
async function listSince(sinceISO: string): Promise<Lifelog[]> {
  const apiKey = limitlessKey();
  const out: Lifelog[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      start: sinceISO,
      timezone: "UTC",
      limit: "50",
      direction: "asc",
      includeMarkdown: "true",
      includeHeadings: "true",
    });
    if (cursor) params.set("cursor", cursor);

    const r = await fetchWithRetry(
      `${LIMITLESS_BASE}/lifelogs?${params.toString()}`,
      {
        headers: { "X-API-Key": apiKey },
      },
    );
    if (!r.ok) {
      throw new Error(
        `Limitless lifelogs ${r.status}: ${(await r.text()).slice(0, 200)}`,
      );
    }

    const body = await r.json();
    const lifelogs: Lifelog[] = body?.data?.lifelogs ?? [];
    if (lifelogs.length === 0) break;

    out.push(...lifelogs);
    if (out.length >= MAX_RECORDS) return out.slice(0, MAX_RECORDS);

    cursor = body?.meta?.lifelogs?.nextCursor ?? undefined;
    if (!cursor) break;
  }

  return out;
}

const limitlessAdapter: WearableAdapter<Lifelog> = {
  sourceId: "limitless",
  sourceType: "limitless_lifelog",
  listSince,
  recordId: (ll) => ll.id,
  recordToAtoms: (ll) => atomizeLifelog(ll),
};

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "1";
    const sinceHours = Number(url.searchParams.get("since_hours")) || 12;
    const result = await runWearableSync(limitlessAdapter, {
      sinceHours,
      dryRun,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[wearable-limitless-capture]", (err as Error).message);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
