// merge.ts — pure merge-policy functions. NORMATIVE section 4 of the spec.
// No I/O here: everything is unit-testable without a network or database.
import { normalizeStringArray } from "./_shared/helpers.ts";
import type { ThoughtMetadata } from "./_shared/config.ts";

export type ClaimedRow = {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  source_type: string | null;
  type: string | null;
  needs_embedding: boolean;
};

export type Extracted = ThoughtMetadata & {
  _enrichment_status: "complete" | "fallback";
  _enrichment_error?: string;
};

/** Errors that mean "this run cannot classify anything" — the tick must
 * abort and clear claims WITHOUT consuming row attempts. */
export const RUN_LEVEL_ERRORS: Set<string> = new Set([
  "no_provider_configured",
  "call_budget_exhausted",
  "classifier_disabled",
]);

const LIST_CAP = 12;

/**
 * Coerce a raw list-shaped value into a string[] WITHOUT dropping anything.
 *
 *  - string            -> [string]                  (lone tag, e.g. "solo-tag")
 *  - string[]          -> as-is                     (native curated tags)
 *  - {name}/{tag}[]    -> [.name | .tag, ...]        (Readwise object shape)
 *  - null / undefined  -> []                        (nothing to preserve)
 *  - anything else, or any array element that is neither a string nor an
 *    object with a string .name/.tag  ->  null      (FAIL CLOSED)
 *
 * A null return is the signal to leave the caller's raw value completely
 * untouched — we would rather keep an unrecognizable native list verbatim
 * than silently discard curation we don't understand.
 */
export function coerceStringList(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) return [];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const el of raw) {
      if (typeof el === "string") {
        out.push(el);
        continue;
      }
      if (typeof el === "object" && el !== null && !Array.isArray(el)) {
        const rec = el as Record<string, unknown>;
        if (typeof rec.name === "string") { out.push(rec.name); continue; }
        if (typeof rec.tag === "string") { out.push(rec.tag); continue; }
      }
      return null; // unrecognizable element -> fail closed on the whole list
    }
    return out;
  }
  return null; // some other non-null scalar (number, boolean, …) -> fail closed
}

/**
 * Union policy: the native base is preserved WHOLE (never capped, never
 * dropped) and LLM `extras` are appended only into the room left under
 * LIST_CAP — i.e. up to max(0, LIST_CAP - base.length) new items, deduped
 * against the base and each other. If the base can't be understood
 * (coerceStringList returns null) we fail closed and hand back the raw base
 * untouched, doing no merge for that key.
 */
function unionPreserveBase(rawBase: unknown, extras: unknown): unknown {
  const base = coerceStringList(rawBase);
  if (base === null) return rawBase; // fail closed: keep curation verbatim
  const room = Math.max(0, LIST_CAP - base.length);
  const seen = new Set(base);
  const result = [...base];
  let added = 0;
  for (const e of normalizeStringArray(extras)) {
    if (added >= room) break;
    if (seen.has(e)) continue;
    seen.add(e);
    result.push(e);
    added++;
  }
  return result;
}

export function buildCompletePatch(
  row: ClaimedRow,
  extracted: Extracted,
): { type: string; metadata: Record<string, unknown> } {
  const existing = { ...(row.metadata ?? {}) };
  delete existing.enrichment_claimed_at;
  delete existing.enrichment_last_error;
  delete existing.enrichment_attempts;

  const isReadwise = row.source_type === "readwise";
  // Readwise highlights are decontextualized quotes: type stays pinned to
  // 'reference'; the classifier's opinion is preserved but not promoted.
  const type = isReadwise ? "reference" : extracted.type;

  const metadata: Record<string, unknown> = {
    ...existing,
    type,
    summary: extracted.summary,
    topics: unionPreserveBase(existing.topics, extracted.topics),
    tags: unionPreserveBase(existing.tags, extracted.tags),
    people: unionPreserveBase(existing.people, extracted.people),
    action_items: unionPreserveBase(existing.action_items, extracted.action_items),
    confidence: extracted.confidence,
    enrichment_status: "complete",
    enrichment_attempted_at: new Date().toISOString(),
  };
  if (isReadwise) metadata.classified_type = extracted.type;

  return { type, metadata };
}

export function buildFallbackPatch(
  row: ClaimedRow,
  errorReason: string,
): { metadata: Record<string, unknown> } {
  const existing = { ...(row.metadata ?? {}) };
  delete existing.enrichment_claimed_at;
  const attempts =
    (Number.parseInt(String(existing.enrichment_attempts ?? "0"), 10) || 0) + 1;
  return {
    metadata: {
      ...existing,
      enrichment_status: "fallback",
      enrichment_attempts: attempts,
      enrichment_last_error: errorReason.slice(0, 300),
      enrichment_attempted_at: new Date().toISOString(),
    },
  };
}

export function buildClaimClearPatch(
  row: ClaimedRow,
): { metadata: Record<string, unknown> } {
  const existing = { ...(row.metadata ?? {}) };
  delete existing.enrichment_claimed_at;
  return { metadata: existing };
}
