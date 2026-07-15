// merge.ts — pure merge-policy functions. NORMATIVE section 4 of the spec.
// No I/O here: everything is unit-testable without a network or database.
import { mergeUniqueStrings } from "./_shared/helpers.ts";
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

function unionCapped(base: unknown, extras: string[]): string[] {
  return mergeUniqueStrings(base, extras).slice(0, LIST_CAP);
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
    topics: unionCapped(existing.topics, extracted.topics),
    tags: unionCapped(existing.tags, extracted.tags),
    people: unionCapped(existing.people, extracted.people),
    action_items: unionCapped(existing.action_items, extracted.action_items),
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
