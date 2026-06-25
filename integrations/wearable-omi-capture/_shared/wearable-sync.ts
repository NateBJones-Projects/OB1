/**
 * wearable-sync — generic ATOMIC capture engine for always-on wearables.
 *
 * A small, reusable core that turns ANY polling wearable (Omi, Limitless, and
 * future devices) into Open Brain thoughts — at the granularity of ATOMS, not
 * one summary per recording. A long conversation becomes many searchable rows
 * (its title, each action item, each transcript chunk, …), each carrying its own
 * provenance. Each device supplies a tiny `WearableAdapter`; this engine owns
 * everything the adapters share:
 *
 *   1. pull records since a rolling time window (the adapter makes the call),
 *   2. atomize each record into one or more atoms (the adapter, using the
 *      device's OWN structured output — no per-item LLM cost),
 *   3. skip atoms already captured (idempotent dedup on a SALTED per-atom
 *      content fingerprint, so re-runs and overlapping windows are safe),
 *   4. tag each atom with provenance (attribution / attributed_to / generator),
 *   5. embed the text (OpenRouter, OB1's standard) and insert into `thoughts`.
 *
 * Design rules (per OB1 CONTRIBUTING):
 *   - Never modifies the `thoughts` schema — additive rows only. The atom
 *     fingerprint lives in `metadata.content_fingerprint`, deduped with a GIN-
 *     indexed JSONB containment query, so the engine works on the baseline
 *     `thoughts` schema with no migration. (If you run a schema that adds a
 *     UNIQUE index, a duplicate insert is also caught and treated as a skip.)
 *   - No secrets in code — every credential comes from Deno.env.
 *   - Idempotency lives in the brain, not a local file, so re-runs and
 *     overlapping windows are safe and the engine self-heals after outages.
 *
 * Deploy this file to `supabase/functions/_shared/wearable-sync.ts`; each
 * per-wearable adapter (e.g. `wearable-omi-capture`) imports it.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Who an atom is attributed to.
 *   - `self`     — only the brain owner speaks/authored it.
 *   - `other`    — only other named people.
 *   - `mixed`    — the owner and at least one other named person.
 *   - `machine`  — the device generated it (a title, a summary, an extracted item).
 *   - `unknown`  — speech with no resolvable speaker.
 * `external` is reserved for a future cross-source backfill and is never emitted here.
 */
export type Attribution = "self" | "other" | "machine" | "mixed" | "unknown";

/** One atom produced from a wearable record. The adapter sets the provenance
 *  fields using the device's own structure; the engine merges them into
 *  `metadata` and computes the fingerprint. `type` maps to the thought type
 *  (default 'meeting'). */
export interface WearableAtom {
  /** Stable position of this atom within its record (part of the fingerprint salt). */
  atomIndex: number;
  /** What kind of atom this is, e.g. 'title' | 'overview' | 'action_item' | 'event' | 'transcript_chunk' | 'section' | 'memory'. */
  atomKind: string;
  content: string;
  type?: string;
  importance?: number;
  attribution: Attribution;
  /** Speaker labels / names that contributed to this atom (for `attributed_to`). */
  attributedTo?: string[];
  /** The device that machine-generated this atom (e.g. 'omi'); null for human speech. */
  generator?: string | null;
  /** True when the brain owner is a speaker here — lets an optional later step self-link. */
  selfPresent?: boolean;
  /** The owner's role in a self/mixed atom, for optional self-linking. */
  role?: "author" | "participant" | null;
  createdAt?: string;
  qualityScore?: number;
  /** Atom-specific extras merged into `metadata` (e.g. section_label, speakers). */
  metadata?: Record<string, unknown>;
}

/** The per-wearable contract. Implement these and the engine does the rest.
 *  `Record` is opaque to the engine — whatever the device API returns. */
export interface WearableAdapter<Record = unknown> {
  /** Stable short id for the device, e.g. "omi", "limitless". Used for dedup + provenance. */
  sourceId: string;
  /** The brain `source_type` to tag thoughts with, e.g. "omi", "limitless_lifelog". */
  sourceType: string;
  /** Pull records created/started at or after `sinceISO` (UTC ISO 8601). */
  listSince(sinceISO: string): Promise<Record[]>;
  /** The device's own stable id for a record (idempotency salt — survives content edits). */
  recordId(record: Record): string;
  /** Atomize a record using the device's OWN structure (no LLM call). */
  recordToAtoms(record: Record): WearableAtom[];
}

export interface SyncOptions {
  /** Rolling lookback window in hours (default 12). A wider window self-heals longer outages. */
  sinceHours?: number;
  /** Don't write — just report what would be captured. */
  dryRun?: boolean;
  /** Embed atom text via OpenRouter before insert (default true; false leaves NULL embeddings
   *  for a later backfill). */
  embed?: boolean;
  /** Optional pre-built client (tests). Defaults to a service-role client from env. */
  client?: SupabaseClient;
}

export interface SyncResult {
  source: string;
  /** Records pulled from the device this pass. */
  pulled: number;
  /** Records that produced at least one NEW atom. */
  recordsImported: number;
  /** Atoms written (or, in a dry run, that would be written). */
  atomsInserted: number;
  /** Atoms already present (deduped) or empty. */
  atomsSkipped: number;
  /** Records that errored mid-pass. */
  failed: number;
  /** Count of atoms by attribution, for at-a-glance provenance. */
  attribution: Record<string, number>;
  dryRun: boolean;
}

export interface FetchRetryOptions {
  /** Max 429 retries before giving up and returning the 429 response (default 3). */
  maxRetries?: number;
  /** Per-attempt timeout in ms (default 30000). */
  timeoutMs?: number;
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/**
 * `fetch()` with a per-attempt timeout and Retry-After-aware, capped backoff on
 * HTTP 429. Adapters use this for their device API calls so a transient rate
 * limit slows a pass instead of aborting it. Non-429 responses (including other
 * errors) are returned as-is for the caller to handle.
 */
export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit = {},
  opts: FetchRetryOptions = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30000;
  for (let attempt = 0;; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...init, signal: ctrl.signal });
      if (resp.status === 429 && attempt < maxRetries) {
        const retryAfter = Number(resp.headers.get("retry-after")) || 0;
        const wait = Math.min(
          Math.max(retryAfter * 1000, 2000 * (attempt + 1)),
          15000,
        );
        await resp.body?.cancel().catch(() => {}); // free the connection before backing off
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      return resp;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Salted per-atom identity: `sha256(source|provider_event_id|atom_index|content)`.
 * Salting with the recording id and the atom's position means two atoms with
 * identical text still get distinct fingerprints, while a re-run of the same
 * atom is stable — which is exactly what makes overlapping windows idempotent.
 */
export async function atomFingerprint(
  source: string,
  providerEventId: string,
  atomIndex: number,
  content: string,
): Promise<string> {
  const data = new TextEncoder().encode(
    `${source}|${providerEventId}|${atomIndex}|${content}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Embed text via OpenRouter (openai/text-embedding-3-small — OB1's default).
 *  Returns null if no key is set, so the engine still inserts (embedding backfilled later). */
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

function defaultClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(url, key);
}

/**
 * Run one capture pass for a wearable. Idempotent + additive: safe to call on a
 * tight schedule (e.g. every 5 minutes via cron). Each record is atomized, and
 * each atom is deduped on its salted fingerprint before insert.
 */
export async function runWearableSync<R>(
  adapter: WearableAdapter<R>,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const supabase = opts.client ?? defaultClient();
  const sinceHours = opts.sinceHours ?? 12;
  const sinceISO = new Date(Date.now() - sinceHours * 3600 * 1000)
    .toISOString();
  const dryRun = opts.dryRun ?? false;
  const doEmbed = opts.embed ?? true;

  const records = await adapter.listSince(sinceISO);
  let recordsImported = 0, atomsInserted = 0, atomsSkipped = 0, failed = 0;
  const attribution: Record<string, number> = {};

  for (const record of records) {
    const providerEventId = adapter.recordId(record);
    if (!providerEventId) continue;
    try {
      const atoms = adapter.recordToAtoms(record);
      if (atoms.length === 0) continue;

      // ONE indexed lookup per recording for the atoms already captured for THIS
      // record (the metadata GIN index serves the containment match). Batching
      // here — instead of a query per atom — follows the brain's "never per-row
      // filter on a JSONB key" rule.
      const seen = new Set<string>();
      if (!dryRun) {
        const { data: existing, error: selErr } = await supabase
          .from("thoughts")
          .select("metadata")
          .contains("metadata", {
            wearable_source: adapter.sourceId,
            provider_event_id: providerEventId,
          });
        if (selErr) throw selErr;
        for (const row of existing ?? []) {
          const fp = (row as { metadata?: Record<string, unknown> }).metadata
            ?.content_fingerprint;
          if (typeof fp === "string") seen.add(fp);
        }
      }

      let newAtoms = 0;
      for (const atom of atoms) {
        attribution[atom.attribution] = (attribution[atom.attribution] ?? 0) +
          1;
        const content = atom.content?.trim();
        if (!content) {
          atomsSkipped++;
          continue;
        }

        const fingerprint = await atomFingerprint(
          adapter.sourceType,
          providerEventId,
          atom.atomIndex,
          content,
        );
        if (seen.has(fingerprint)) {
          atomsSkipped++;
          continue;
        }
        seen.add(fingerprint);

        const metadata: Record<string, unknown> = {
          ...(atom.metadata ?? {}),
          source: adapter.sourceType,
          wearable_source: adapter.sourceId,
          provider_event_id: providerEventId,
          atom_index: atom.atomIndex,
          atom_kind: atom.atomKind,
          attribution: atom.attribution,
          generator: atom.generator ?? null,
          content_fingerprint: fingerprint,
          captured_via: "wearable-atomic",
          type: atom.type ?? "meeting",
          importance: atom.importance ?? 3,
        };
        if (atom.attributedTo?.length) {
          metadata.attributed_to = atom.attributedTo;
        }
        if (atom.selfPresent) {
          metadata.self_present = true;
          if (atom.role) metadata.role = atom.role;
        }
        if (typeof atom.qualityScore === "number") {
          metadata.quality_score = atom.qualityScore;
        }

        if (dryRun) {
          atomsInserted++;
          newAtoms++;
          continue;
        }

        const row: Record<string, unknown> = { content, metadata };
        if (atom.createdAt) row.created_at = atom.createdAt;
        if (doEmbed) {
          const emb = await embedText(content);
          if (emb) row.embedding = emb;
        }
        const { error: insErr } = await supabase.from("thoughts").insert(row);
        if (insErr) {
          // A unique violation only happens if you run a schema with a UNIQUE
          // index on the fingerprint — it means a concurrent/overlapping pass
          // beat us to this atom. Treat as a skip, not a failure.
          if (/duplicate key|23505/i.test(insErr.message ?? "")) {
            atomsSkipped++;
            continue;
          }
          throw insErr;
        }
        atomsInserted++;
        newAtoms++;
      }
      if (newAtoms > 0) recordsImported++;
    } catch (e) {
      failed++;
      console.error(
        `[wearable-sync:${adapter.sourceId}] ${providerEventId}: ${
          (e as Error).message
        }`,
      );
    }
  }

  return {
    source: adapter.sourceId,
    pulled: records.length,
    recordsImported,
    atomsInserted,
    atomsSkipped,
    failed,
    attribution,
    dryRun,
  };
}
