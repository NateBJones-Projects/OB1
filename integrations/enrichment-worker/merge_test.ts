import { assertEquals, assert, assertFalse } from "jsr:@std/assert";
import {
  buildCompletePatch,
  buildFallbackPatch,
  buildClaimClearPatch,
  RUN_LEVEL_ERRORS,
  type ClaimedRow,
  type Extracted,
} from "./merge.ts";

const readwiseRow: ClaimedRow = {
  id: "00000000-0000-0000-0000-000000000001",
  content: "Some highlight text",
  source_type: "readwise",
  type: "reference",
  needs_embedding: false,
  metadata: {
    source: "readwise",
    readwise_highlight_id: 12345,
    readwise_book_id: 678,
    book_title: "The Book",
    book_author: "A. Author",
    highlighted_at: "2025-01-01T00:00:00Z",
    location: 42,
    color: "yellow",
    tags: ["curated-native-tag"],
    enrichment_status: "pending",
    enrichment_attempts: 0,
    enrichment_claimed_at: "2026-07-15T00:00:00Z",
  },
};

const extracted: Extracted = {
  type: "lesson",
  summary: "An LLM summary",
  topics: ["topic-a"],
  tags: ["llm-tag", "curated-native-tag"],
  people: ["Jane"],
  action_items: [],
  importance: 3,
  confidence: 0.9,
  _enrichment_status: "complete",
};

Deno.test("complete: readwise-native keys all survive", () => {
  const p = buildCompletePatch(readwiseRow, extracted);
  for (const k of ["readwise_highlight_id", "readwise_book_id", "book_title",
                   "book_author", "highlighted_at", "location", "color", "source"]) {
    assertEquals(p.metadata[k], (readwiseRow.metadata as Record<string, unknown>)[k]);
  }
});

Deno.test("complete: tags are union-never-replace, deduped", () => {
  const p = buildCompletePatch(readwiseRow, extracted);
  const tags = p.metadata.tags as string[];
  assert(tags.includes("curated-native-tag"));
  assert(tags.includes("llm-tag"));
  assertEquals(tags.filter((t) => t === "curated-native-tag").length, 1);
});

Deno.test("complete: base preserved whole; LLM extras fill only remaining room under cap", () => {
  // New semantics: base kept whole always; LLM extras appended only up to
  // max(0, 12 - base.length). 10 native + 10 LLM => 10 native + 2 LLM = 12.
  const bigRow = { ...readwiseRow, metadata: { ...readwiseRow.metadata,
    tags: Array.from({ length: 10 }, (_, i) => `native-${i}`) } };
  const bigExtracted = { ...extracted,
    tags: Array.from({ length: 10 }, (_, i) => `llm-${i}`) };
  const p = buildCompletePatch(bigRow, bigExtracted);
  const tags = p.metadata.tags as string[];
  assertEquals(tags.length, 12);
  for (let i = 0; i < 10; i++) assert(tags.includes(`native-${i}`)); // all native survive
  assertEquals(tags.filter((t) => t.startsWith("llm-")).length, 2);  // room = 12 - 10
});

Deno.test("complete: 15 native tags preserved whole; cap applies to additions only", () => {
  const native = Array.from({ length: 15 }, (_, i) => `native-${i}`);
  const row = { ...readwiseRow, metadata: { ...readwiseRow.metadata, tags: native } };
  const ex = { ...extracted, tags: Array.from({ length: 5 }, (_, i) => `llm-${i}`) };
  const p = buildCompletePatch(row, ex);
  const tags = p.metadata.tags as string[];
  for (const t of native) assert(tags.includes(t)); // ALL 15 native survive
  assertEquals(tags.length, 15);                    // no LLM tag added (room = 0)
  for (let i = 0; i < 5; i++) assertFalse(tags.includes(`llm-${i}`));
});

Deno.test("complete: object-shaped base (Readwise .name/.tag) coerced + preserved + unioned", () => {
  const row = { ...readwiseRow, metadata: { ...readwiseRow.metadata,
    tags: [{ name: "kindle-tag" }, { tag: "tagged" }, "plain"] } };
  const ex = { ...extracted, tags: ["llm-tag"] };
  const p = buildCompletePatch(row, ex);
  const tags = p.metadata.tags as string[];
  assert(tags.includes("kindle-tag")); // object .name
  assert(tags.includes("tagged"));     // object .tag
  assert(tags.includes("plain"));      // bare string
  assert(tags.includes("llm-tag"));    // LLM extra unioned in
});

Deno.test("complete: lone string base treated as single-element list", () => {
  const row = { ...readwiseRow, metadata: { ...readwiseRow.metadata, tags: "solo-tag" } };
  const ex = { ...extracted, tags: ["llm-tag"] };
  const p = buildCompletePatch(row, ex);
  const tags = p.metadata.tags as string[];
  assert(tags.includes("solo-tag"));
  assert(tags.includes("llm-tag"));
});

Deno.test("complete: unrecognizable base fails closed — kept exactly as-is, no LLM merge", () => {
  const row = { ...readwiseRow, metadata: { ...readwiseRow.metadata, tags: [1, 2] } };
  const ex = { ...extracted, tags: ["llm-tag"] };
  const p = buildCompletePatch(row, ex);
  assertEquals(p.metadata.tags, [1, 2]); // raw base untouched, no coercion, no union
});

Deno.test("complete: readwise type pinned to reference, opinion in classified_type", () => {
  const p = buildCompletePatch(readwiseRow, extracted);
  assertEquals(p.type, "reference");
  assertEquals(p.metadata.type, "reference");
  assertEquals(p.metadata.classified_type, "lesson");
});

Deno.test("complete: non-readwise rows take the classifier type", () => {
  const row = { ...readwiseRow, source_type: "mcp" };
  const p = buildCompletePatch(row, extracted);
  assertEquals(p.type, "lesson");
  assertEquals(p.metadata.classified_type, undefined);
});

Deno.test("complete: status set, claim + last_error cleared, attempts removed", () => {
  const row = { ...readwiseRow, metadata: { ...readwiseRow.metadata,
    enrichment_last_error: "old", enrichment_attempts: 2 } };
  const p = buildCompletePatch(row, extracted);
  assertEquals(p.metadata.enrichment_status, "complete");
  assertFalse("enrichment_claimed_at" in p.metadata);
  assertFalse("enrichment_last_error" in p.metadata);
  assertFalse("enrichment_attempts" in p.metadata);
  assert(typeof p.metadata.enrichment_attempted_at === "string");
});

Deno.test("fallback: writes ONLY tracking keys, no content fields, increments attempts", () => {
  const p = buildFallbackPatch(readwiseRow, "transient_failures_exhausted: 502");
  assertEquals(p.metadata.enrichment_status, "fallback");
  assertEquals(p.metadata.enrichment_attempts, 1);
  assertEquals(p.metadata.enrichment_last_error, "transient_failures_exhausted: 502");
  assertFalse("enrichment_claimed_at" in p.metadata);
  // content fields untouched (fallbackMetadata junk must never land):
  assertEquals(p.metadata.tags, ["curated-native-tag"]);
  assertEquals(p.metadata.summary, undefined);
  assertEquals(p.metadata.book_title, "The Book");
});

Deno.test("claim clear: removes only the lease key", () => {
  const p = buildClaimClearPatch(readwiseRow);
  assertFalse("enrichment_claimed_at" in p.metadata);
  assertEquals(p.metadata.enrichment_status, "pending");
  assertEquals(p.metadata.enrichment_attempts, 0);
});

Deno.test("run-level errors are classified as such", () => {
  assert(RUN_LEVEL_ERRORS.has("no_provider_configured"));
  assert(RUN_LEVEL_ERRORS.has("call_budget_exhausted"));
  assert(RUN_LEVEL_ERRORS.has("classifier_disabled"));
  assertFalse(RUN_LEVEL_ERRORS.has("all_providers_failed"));
});
