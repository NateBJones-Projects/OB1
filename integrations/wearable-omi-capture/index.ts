/**
 * wearable-omi-capture — Omi pendant adapter for the wearable-capture-core engine.
 *
 * Omi (https://omi.me) is an always-on wearable that records spoken
 * conversations and returns them already structured: a title, an overview, a
 * category, a list of action items and events, plus the raw transcript segments.
 * This adapter atomizes that device-native structure into Open Brain thoughts —
 * NO LLM call of its own:
 *
 *   - one `meeting` atom from title + overview (machine-generated),
 *   - one `task` atom per action item (machine-generated),
 *   - one `meeting` atom per event (machine-generated),
 *   - one `meeting` atom per ~60s / ~600-char transcript CHUNK, attributed to its
 *     speakers (self / other / mixed / unknown) — the detail a summary loses.
 *
 * It also captures Omi's distilled **memories** (`GET /v1/dev/user/memories`) as a
 * separate `omi_memory` stream with edit-aware dedup (re-import when Omi edits a
 * memory). The shared core (`_shared/wearable-sync.ts`) owns the conversation
 * write path: per-atom dedup on a salted fingerprint, provenance metadata,
 * embedding via OpenRouter, and the insert into `thoughts`.
 *
 * Deploy this file to `supabase/functions/wearable-omi-capture/index.ts`. It
 * imports the core from `../_shared/wearable-sync.ts`, so install
 * wearable-capture-core FIRST (see this integration's README). The `_shared/`
 * copy in this folder is a vendored copy of that same engine, present so the
 * function typechecks standalone; the deno.json import map points the deploy
 * path at it for local `deno check`.
 *
 * Omi API facts this adapter relies on:
 *   - Auth: `Authorization: Bearer <OMI_API_KEY>` (personal key, `omi_dev_...`).
 *   - Base: https://api.omi.me/v1/dev
 *   - Conversations: GET /user/conversations?include_transcript=true&limit&offset
 *           -> a BARE JSON array (not wrapped). No `since` param: page recent and
 *           filter to the window. Segment fields: speaker_id/speaker_name/start/end.
 *   - Memories: GET /user/memories?limit=500 -> a BARE JSON array of distilled facts.
 */
import {
  atomFingerprint,
  type Attribution,
  fetchWithRetry,
  runWearableSync,
  type SyncResult,
  type WearableAdapter,
  type WearableAtom,
} from "../_shared/wearable-sync.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const OMI_BASE = "https://api.omi.me/v1/dev";
const PAGE_SIZE = 50;
/** Safety cap on pages, so a far-back window can't loop forever. */
const MAX_PAGES = 20;
/** Transcript chunk shape — the device's segments are flat, so we window them. */
const CHUNK_MAX_SECONDS = 60;
const CHUNK_MAX_CHARS = 600;
/** Soft cap: a conversation past this many chunks is logged, never truncated. */
const CHUNK_SOFT_WARN = 80;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// ── types ─────────────────────────────────────────────────────────────────────

/** A single Omi transcript line. */
interface OmiSegment {
  speaker_id?: string | number;
  speaker_name?: string;
  start?: number;
  end?: number;
  text?: string;
}

/** Omi's device-native structured summary of a conversation. */
interface OmiStructured {
  title?: string;
  overview?: string;
  category?: string;
  emoji?: string;
  /** Each item is either a plain string or an object with `description`/`content`. */
  action_items?: Array<string | { description?: string; content?: string }>;
  /** Each event is either a plain string or an object with `title`/`description`. */
  events?: Array<string | { title?: string; description?: string }>;
}

/** One Omi conversation as returned by the list endpoint. */
interface OmiConversation {
  id: string;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
  discarded?: boolean;
  structured?: OmiStructured;
  transcript_segments?: OmiSegment[];
}

/** One Omi memory (distilled fact) as returned by the memories endpoint. */
interface OmiMemory {
  id: string;
  content?: string;
  category?: string;
  tags?: string[];
  scoring?: unknown;
  reviewed?: boolean;
  manually_added?: boolean;
  edited?: boolean;
  visibility?: string;
  created_at?: string;
  updated_at?: string;
}

// ── speaker classification (generic — no hardcoded personal names) ─────────────

/** Device-generic labels for the wearer. Add your own (e.g. your name) via the
 *  `WEARABLE_SELF_LABELS` env var (comma-separated) — never hardcode a name. */
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

/** Classify a set of speaker labels into an attribution + self presence + role. */
function classifySpeakers(
  speakers: string[],
): {
  attribution: Attribution;
  selfPresent: boolean;
  role: "author" | "participant" | null;
} {
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

// ── filler filter (drop all-filler transcript chunks) ──────────────────────────

const FILLER_RE =
  /^(yeah|yep|yup|ok|okay|right|mhmm|mm+|uh+|um+|haha+|ha|wow|woah|whoa|exactly|true|nice|cool|sure|yes|no|nope)[\s.!?,]*$/i;
function isAllFiller(text: string): boolean {
  const t = text.trim();
  return t.length < 25 || FILLER_RE.test(t);
}

const trim = (s: unknown): string =>
  String(s ?? "").replace(/\s+/g, " ").trim();

// ── Omi conversation atomization ───────────────────────────────────────────────

interface OmiChunk {
  segments: Array<{ speaker: string; text: string }>;
  startSec: number;
  speakers: Set<string>;
}

/** Window flat segments into ~maxSeconds / ~maxChars chunks (Omi has no native sections). */
function chunkSegments(segments: OmiSegment[]): OmiChunk[] {
  const chunks: OmiChunk[] = [];
  let cur: (OmiChunk & { chars: number }) | null = null;
  for (const s of segments) {
    const text = trim(s.text);
    if (!text) continue;
    const start = Number(s.start ?? 0);
    if (
      cur &&
      (start - cur.startSec > CHUNK_MAX_SECONDS || cur.chars > CHUNK_MAX_CHARS)
    ) {
      cur = null;
    }
    if (!cur) {
      cur = {
        segments: [],
        startSec: start,
        chars: 0,
        speakers: new Set<string>(),
      };
      chunks.push(cur);
    }
    const speaker = trim(s.speaker_name ?? s.speaker_id) || "Unknown";
    cur.segments.push({ speaker, text });
    cur.chars += text.length;
    cur.speakers.add(speaker);
  }
  return chunks;
}

/** Normalise an action item / event (string OR object) to its text, or "" to skip. */
function itemText(item: unknown, keys: string[]): string {
  if (typeof item === "string") return item.trim();
  if (item && typeof item === "object") {
    for (const k of keys) {
      const v = (item as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

const conversationStart = (c: OmiConversation): string | undefined =>
  c.started_at ?? c.created_at;

/**
 * Atomize one Omi conversation using the device's OWN structure (no LLM):
 *   - title + overview  -> machine `meeting` atom,
 *   - each action item  -> machine `task` atom,
 *   - each event        -> machine `meeting` atom,
 *   - each transcript chunk -> `meeting` atom attributed to its speakers.
 * Discarded conversations produce nothing. The chunk count is soft-warned past
 * CHUNK_SOFT_WARN but never truncated.
 */
function atomizeConversation(c: OmiConversation): WearableAtom[] {
  if (c.discarded === true) return [];
  const atoms: WearableAtom[] = [];
  const st = c.structured ?? {};
  const startedAt = conversationStart(c);
  let idx = 0;

  // title + overview (machine summary)
  const title = trim(st.title) || "Omi conversation";
  const overview = trim(st.overview);
  if (overview || trim(st.title)) {
    atoms.push({
      atomIndex: idx++,
      atomKind: "overview",
      content: `${title}${overview ? " — " + overview : ""}`.slice(0, 2000),
      type: "meeting",
      attribution: "machine",
      generator: "omi",
      createdAt: startedAt,
      qualityScore: 55,
      metadata: { is_overview: true, category: st.category ?? null },
    });
  }

  // action items (machine-extracted tasks)
  for (const raw of st.action_items ?? []) {
    const text = itemText(raw, ["description", "content"]);
    if (text.length < 5) continue;
    atoms.push({
      atomIndex: idx++,
      atomKind: "action_item",
      content: text.slice(0, 500),
      type: "task",
      attribution: "machine",
      generator: "omi",
      createdAt: startedAt,
      qualityScore: 50,
      metadata: { derived_from: "omi_action_item" },
    });
  }

  // events (machine-extracted)
  for (const raw of st.events ?? []) {
    const text = itemText(raw, ["title", "description"]);
    if (text.length < 5) continue;
    atoms.push({
      atomIndex: idx++,
      atomKind: "event",
      content: text.slice(0, 500),
      type: "meeting",
      attribution: "machine",
      generator: "omi",
      createdAt: startedAt,
      qualityScore: 50,
      metadata: { is_event: true },
    });
  }

  // transcript chunks (human speech — the detail a summary-only import loses)
  const chunks = chunkSegments(c.transcript_segments ?? []);
  if (chunks.length > CHUNK_SOFT_WARN) {
    console.warn(
      `[wearable-omi-capture] conversation ${c.id} produced ${chunks.length} chunks (> ${CHUNK_SOFT_WARN}); keeping all`,
    );
  }
  const startMs = startedAt ? Date.parse(startedAt) : NaN;
  for (const ch of chunks) {
    if (isAllFiller(ch.segments.map((u) => u.text).join(" "))) continue;
    const speakers = [...ch.speakers];
    const cls = classifySpeakers(speakers);
    const body = ch.segments.map((u) => `${u.speaker}: ${u.text}`).join("\n");
    const createdAt = Number.isFinite(startMs) && Number.isFinite(ch.startSec)
      ? new Date(startMs + ch.startSec * 1000).toISOString()
      : startedAt;
    atoms.push({
      atomIndex: idx++,
      atomKind: "transcript_chunk",
      content: body.slice(0, 4000),
      type: "meeting",
      attribution: cls.attribution,
      attributedTo: speakers,
      generator: null,
      selfPresent: cls.selfPresent,
      role: cls.role,
      createdAt,
      qualityScore: 50,
      metadata: { speakers, segment_count: ch.segments.length },
    });
  }

  return atoms;
}

// ── the conversation adapter (driven by the shared core) ───────────────────────

function omiKey(): string {
  const key = Deno.env.get("OMI_API_KEY");
  if (!key) throw new Error("OMI_API_KEY is required");
  return key;
}

/** Fetch one page of conversations (newest first), as the bare array Omi returns. */
async function fetchConversationPage(
  offset: number,
): Promise<OmiConversation[]> {
  const url =
    `${OMI_BASE}/user/conversations?include_transcript=true&limit=${PAGE_SIZE}&offset=${offset}`;
  const r = await fetchWithRetry(url, {
    headers: {
      "Authorization": `Bearer ${omiKey()}`,
      "Accept": "application/json",
    },
  });
  if (!r.ok) {
    throw new Error(
      `Omi conversations ${r.status}: ${(await r.text()).slice(0, 200)}`,
    );
  }
  const body = await r.json();
  return Array.isArray(body) ? (body as OmiConversation[]) : [];
}

const omiAdapter: WearableAdapter<OmiConversation> = {
  sourceId: "omi",
  sourceType: "omi",

  /**
   * Omi has no `since` parameter, so page newest-first (limit 50, increasing
   * offset) and keep only conversations started at/after the window. Stop once a
   * page yields an item older than the window — pages are newest-first, so
   * everything beyond it is older too.
   */
  async listSince(sinceISO: string): Promise<OmiConversation[]> {
    const sinceMs = Date.parse(sinceISO);
    const kept: OmiConversation[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await fetchConversationPage(page * PAGE_SIZE);
      if (batch.length === 0) break;
      let reachedOlder = false;
      for (const c of batch) {
        const startedRaw = conversationStart(c);
        const startedMs = startedRaw ? Date.parse(startedRaw) : NaN;
        if (Number.isNaN(startedMs)) continue; // can't window an undated conversation
        if (startedMs >= sinceMs) kept.push(c);
        else {
          reachedOlder = true;
          break;
        }
      }
      if (reachedOlder || batch.length < PAGE_SIZE) break;
    }
    return kept;
  },

  recordId: (c) => c.id,
  recordToAtoms: (c) => atomizeConversation(c),
};

// ── Omi memories (separate stream, edit-aware dedup) ───────────────────────────

interface MemoryResult {
  pulled: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
}

/** Embed text via OpenRouter using the core's retry-aware fetch. Null if no key
 *  (the row inserts without an embedding; a later backfill fills it). */
async function embedText(text: string): Promise<number[] | null> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) return null;
  const r = await fetchWithRetry(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text.slice(0, 8000),
    }),
  });
  if (!r.ok) {
    throw new Error(
      `OpenRouter embeddings ${r.status}: ${(await r.text()).slice(0, 200)}`,
    );
  }
  const d = await r.json();
  return d?.data?.[0]?.embedding ?? null;
}

async function fetchMemories(): Promise<OmiMemory[]> {
  const r = await fetchWithRetry(`${OMI_BASE}/user/memories?limit=500`, {
    headers: {
      "Authorization": `Bearer ${omiKey()}`,
      "Accept": "application/json",
    },
  });
  if (r.status === 429) {
    console.warn(
      "[wearable-omi-capture] memories rate-limited (429); skipping this pass",
    );
    return [];
  }
  if (!r.ok) {
    throw new Error(
      `Omi memories ${r.status}: ${(await r.text()).slice(0, 200)}`,
    );
  }
  const body = await r.json();
  return Array.isArray(body) ? (body as OmiMemory[]) : [];
}

/** Map one memory to its provenance. A manually-added memory is `self`-authored;
 *  a device-inferred one is `machine`-generated. */
function memoryAttribution(mem: OmiMemory): {
  attribution: Attribution;
  generator: string | null;
  selfPresent: boolean;
  role: "author" | null;
} {
  const manual = mem.manually_added === true;
  return {
    attribution: manual ? "self" : "machine",
    generator: manual ? null : "omi",
    selfPresent: manual,
    role: manual ? "author" : null,
  };
}

/**
 * Capture Omi memories as their own `omi_memory` stream. Edit-aware: one BATCH
 * lookup of existing memory rows (never a per-memory `metadata->>id` scan), then
 * insert new memories and patch ones Omi has edited since we last saw them.
 */
async function syncMemories(
  client: SupabaseClient,
  opts: { dryRun: boolean; embed: boolean },
): Promise<MemoryResult> {
  const result: MemoryResult = {
    pulled: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
  const memories = await fetchMemories();
  result.pulled = memories.length;
  if (memories.length === 0) return result;

  // ONE batch fetch of existing omi_memory rows (GIN-indexed containment) ->
  // map by Omi's memory id. Per-memory filtering on a JSONB key is unindexed and
  // would scan the whole table once per memory.
  const existingById = new Map<string, { id: string; updatedAt?: string }>();
  if (!opts.dryRun) {
    const { data, error } = await client
      .from("thoughts")
      .select("id, metadata")
      .contains("metadata", { wearable_source: "omi", source: "omi_memory" });
    if (error) throw error;
    for (const row of data ?? []) {
      const md =
        (row as { id: string; metadata?: Record<string, unknown> }).metadata ??
          {};
      const mid = md.omi_memory_id;
      if (typeof mid === "string") {
        existingById.set(mid, {
          id: (row as { id: string }).id,
          updatedAt: md.omi_updated_at as string,
        });
      }
    }
  }

  for (const mem of memories) {
    if (!mem.id) continue;
    const content = trim(mem.content);
    if (!content) {
      result.skipped++;
      continue;
    }
    const attr = memoryAttribution(mem);
    const isPrivate = String(mem.visibility ?? "").toLowerCase() === "private";
    const fingerprint = await atomFingerprint("omi_memory", mem.id, 0, content);
    const metadata: Record<string, unknown> = {
      source: "omi_memory",
      wearable_source: "omi",
      provider_event_id: mem.id,
      omi_memory_id: mem.id,
      atom_index: 0,
      atom_kind: "memory",
      attribution: attr.attribution,
      generator: attr.generator,
      content_fingerprint: fingerprint,
      captured_via: "wearable-atomic",
      type: "reference",
      importance: 3,
      category: mem.category ?? null,
      tags: mem.tags ?? null,
      scoring: mem.scoring ?? null,
      reviewed: mem.reviewed ?? null,
      manually_added: mem.manually_added ?? false,
      edited: mem.edited ?? null,
      visibility: mem.visibility ?? null,
      omi_updated_at: mem.updated_at ?? null,
      // The baseline `thoughts` schema has no sensitivity column, so a private
      // memory is flagged in metadata (additive) for downstream filtering.
      ...(isPrivate ? { sensitivity_tier: "restricted" } : {}),
    };
    if (attr.selfPresent) metadata.self_present = true;

    if (opts.dryRun) {
      result.inserted++;
      continue;
    }

    const existing = existingById.get(mem.id);
    if (existing) {
      // Re-import only when Omi has edited the memory since we captured it.
      if (
        mem.updated_at && existing.updatedAt &&
        mem.updated_at > existing.updatedAt
      ) {
        const patch: Record<string, unknown> = { content, metadata };
        if (opts.embed) {
          const emb = await embedText(content);
          if (emb) patch.embedding = emb;
        }
        const { error } = await client.from("thoughts").update(patch).eq(
          "id",
          existing.id,
        );
        if (error) {
          result.failed++;
          console.error(
            `[wearable-omi-capture] memory ${mem.id} update failed: ${error.message}`,
          );
        } else result.updated++;
      } else result.skipped++;
      continue;
    }

    const row: Record<string, unknown> = { content, metadata };
    if (mem.created_at) row.created_at = mem.created_at;
    if (opts.embed) {
      const emb = await embedText(content);
      if (emb) row.embedding = emb;
    }
    const { error } = await client.from("thoughts").insert(row);
    if (error) {
      if (/duplicate key|23505/i.test(error.message ?? "")) result.skipped++;
      else {
        result.failed++;
        console.error(
          `[wearable-omi-capture] memory ${mem.id} insert failed: ${error.message}`,
        );
      }
    } else result.inserted++;
  }
  return result;
}

// ── entry point ────────────────────────────────────────────────────────────────

function supabaseClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(url, key);
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "1";
    const sinceHours = Number(url.searchParams.get("since_hours")) || 12;
    const noMemories = url.searchParams.get("no_memories") === "1";
    const embed = Deno.env.get("OPENROUTER_API_KEY") != null;

    const client = supabaseClient();
    const conversations: SyncResult = await runWearableSync(omiAdapter, {
      sinceHours,
      dryRun,
      embed,
      client,
    });
    const memories = noMemories
      ? null
      : await syncMemories(client, { dryRun, embed });

    return new Response(JSON.stringify({ conversations, memories, dryRun }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`[wearable-omi-capture] ${(err as Error).message}`);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
