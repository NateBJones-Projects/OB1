/**
 * Universal Thought Payload Preparation
 *
 * A shared contract that normalizes raw input into a consistent payload shape
 * before writing to the thoughts table. All ingest paths (MCP capture, REST
 * endpoint, smart-ingest, import scripts) should use this function to ensure
 * consistent metadata, type resolution, and precedence handling.
 *
 * This is a PURE, PORTABLE implementation:
 *   - No network calls (no embedding, no LLM classification)
 *   - No provider-specific env lookups
 *   - No sensitivity detection policy
 *   - Accepts optional precomputed inputs (embedding, extracted metadata, fingerprint)
 *
 * Callers are responsible for:
 *   - Computing embeddings (via their preferred provider)
 *   - Running LLM classification (if desired)
 *   - Computing content fingerprints (see content-fingerprint-dedup primitive)
 *   - Detecting sensitivity tiers (if applicable)
 */

import {
  parseStructuredCapture,
  normalizeTypeHint,
} from "./parse-structured-capture.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export type PreparedPayload = {
  /** Normalized thought content (structured hints removed). */
  content: string;
  /** Embedding vector (empty array if not provided). */
  embedding: number[];
  /** Merged metadata object. */
  metadata: Record<string, unknown>;
  /** Resolved thought type. */
  type: string;
  /** Importance score (1-5). */
  importance: number;
  /** Quality score (0-100). */
  quality_score: number;
  /** Source type identifier. */
  source_type: string;
  /** Content fingerprint (empty string if not provided). */
  content_fingerprint: string;
};

export type PrepareOpts = {
  /** Source identifier (e.g. "mcp", "rest", "smart_ingest"). */
  source?: string;
  /** Source type for categorization. */
  source_type?: string;
  /** Caller-supplied metadata overrides. */
  metadata?: Record<string, unknown>;
  /** Pre-computed embedding vector. */
  embedding?: number[];
  /** Pre-computed content fingerprint. */
  content_fingerprint?: string;
  /** Pre-extracted metadata from LLM classification. */
  extracted?: {
    type?: string;
    summary?: string;
    topics?: string[];
    tags?: string[];
    people?: string[];
    action_items?: string[];
    confidence?: number;
  };
};

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TYPE = "idea";
const DEFAULT_IMPORTANCE = 3;
const DEFAULT_QUALITY_SCORE = 50;
const DEFAULT_CONFIDENCE = 0.55;
const STRUCTURED_CAPTURE_IMPORTANCE = 4;
const STRUCTURED_CAPTURE_CONFIDENCE = 0.82;
const MAX_SUMMARY_LENGTH = 160;

const VALID_TYPES = new Set([
  "idea",
  "task",
  "person_note",
  "reference",
  "decision",
  "lesson",
  "meeting",
  "journal",
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeType(t: unknown): string {
  const s = typeof t === "string" ? t.trim().toLowerCase() : "";
  return VALID_TYPES.has(s) ? s : DEFAULT_TYPE;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function asInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  return Math.round(asNumber(value, fallback, min, max));
}

/** Normalize a value to a deduplicated, sorted string array. */
function normalizeStringArray(value: unknown): string[] {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of arr) {
    const s = typeof item === "string" ? item.trim().toLowerCase() : "";
    if (s && !seen.has(s)) {
      seen.add(s);
      result.push(s);
    }
  }
  return result;
}

function mergeUniqueStrings(base: unknown, extras: string[]): string[] {
  return normalizeStringArray([...normalizeStringArray(base), ...extras]);
}

// ── Main Function ────────────────────────────────────────────────────────────

/**
 * Prepare a normalized thought payload from raw input.
 *
 * Override precedence (highest to lowest):
 *   1. Structured capture hint (parsed from content)
 *   2. Explicit caller override (opts.metadata.type, etc.)
 *   3. Extracted metadata (from LLM classification, passed via opts.extracted)
 *   4. Defaults (type: 'idea', importance: 3, quality_score: 50)
 */
export function prepareThoughtPayload(
  content: string,
  opts?: PrepareOpts
): PreparedPayload {
  const source = opts?.source ?? "mcp";
  const sourceType = opts?.source_type ?? source;
  const extraMetadata = opts?.metadata ?? {};
  const extracted = opts?.extracted ?? null;

  // Step 1: Parse structured capture format
  const structured = parseStructuredCapture(content);
  const normalizedText = structured.normalizedText.trim();

  if (!normalizedText) {
    throw new Error("content is required");
  }

  // Step 2: Resolve type (precedence: structured > caller > extracted > default)
  const callerType = asString(
    extraMetadata.memory_type,
    asString(extraMetadata.type as string, "")
  );
  const resolvedType = sanitizeType(
    structured.typeHint || callerType || extracted?.type || DEFAULT_TYPE
  );

  // Step 3: Merge topics, tags, people, action_items
  const baseTopics = normalizeStringArray(extraMetadata.topics);
  const baseTags = normalizeStringArray(extraMetadata.tags);
  const basePeople = normalizeStringArray(extraMetadata.people);
  const baseActionItems = normalizeStringArray(extraMetadata.action_items);

  const extractedTopics = extracted
    ? normalizeStringArray(extracted.topics)
    : [];
  const extractedTags = extracted ? normalizeStringArray(extracted.tags) : [];
  const extractedPeople = extracted
    ? normalizeStringArray(extracted.people)
    : [];
  const extractedActionItems = extracted
    ? normalizeStringArray(extracted.action_items)
    : [];

  let topics = mergeUniqueStrings(
    baseTopics.length > 0 ? baseTopics : extractedTopics,
    []
  );
  let tags = mergeUniqueStrings(
    baseTags.length > 0 ? baseTags : extractedTags,
    []
  );
  const people = mergeUniqueStrings(
    basePeople.length > 0 ? basePeople : extractedPeople,
    []
  );
  let actionItems = mergeUniqueStrings(
    baseActionItems.length > 0 ? baseActionItems : extractedActionItems,
    []
  );

  // Add structured capture hints
  if (structured.topicHint) {
    topics = mergeUniqueStrings(topics, [structured.topicHint]);
    tags = mergeUniqueStrings(tags, [structured.topicHint]);
  }
  if (structured.nextStep) {
    actionItems = mergeUniqueStrings(actionItems, [structured.nextStep]);
  }

  // Step 4: Resolve importance
  const callerImportance =
    extraMetadata.importance !== undefined
      ? asInteger(extraMetadata.importance, DEFAULT_IMPORTANCE, 1, 5)
      : null;
  const structuredImportance = structured.matched
    ? STRUCTURED_CAPTURE_IMPORTANCE
    : null;
  const importance =
    callerImportance ?? structuredImportance ?? DEFAULT_IMPORTANCE;

  // Step 5: Resolve confidence
  const callerConfidence =
    extraMetadata.confidence !== undefined
      ? asNumber(extraMetadata.confidence, DEFAULT_CONFIDENCE, 0, 1)
      : null;
  const structuredConfidence = structured.matched
    ? STRUCTURED_CAPTURE_CONFIDENCE
    : null;
  const confidence =
    callerConfidence ??
    structuredConfidence ??
    extracted?.confidence ??
    DEFAULT_CONFIDENCE;

  // Step 6: Resolve quality score
  const callerQuality =
    extraMetadata.quality_score !== undefined
      ? asNumber(extraMetadata.quality_score, DEFAULT_QUALITY_SCORE, 0, 100)
      : null;
  const quality_score =
    callerQuality ?? Math.round(confidence * 70 + 20);

  // Step 7: Resolve summary
  const callerSummary = asString(extraMetadata.summary as string, "");
  const extractedSummary = extracted?.summary ?? "";
  const summary = (callerSummary || extractedSummary || normalizedText)
    .trim()
    .slice(0, MAX_SUMMARY_LENGTH);

  // Step 8: Assemble metadata object
  const metadata: Record<string, unknown> = {
    ...extraMetadata,
    type: resolvedType,
    summary,
    topics,
    tags,
    people,
    action_items: actionItems,
    confidence,
    source,
    source_type: asString(extraMetadata.source_type as string, sourceType),
    capture_format: structured.matched ? "structured_v1" : "freeform",
    structured_capture: structured.matched
      ? {
          type: structured.typeHint,
          topic: structured.topicHint,
          next_step: structured.nextStep,
        }
      : null,
    captured_at: new Date().toISOString(),
  };

  return {
    content: normalizedText,
    embedding: opts?.embedding ?? [],
    metadata,
    type: resolvedType,
    importance,
    quality_score,
    source_type: asString(extraMetadata.source_type as string, sourceType),
    content_fingerprint: opts?.content_fingerprint ?? "",
  };
}
