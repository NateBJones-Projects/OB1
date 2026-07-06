/**
 * Shared helper functions for the Enhanced MCP integration.
 *
 * Ported from ExoCortex open-brain-utils.ts with OB1 adaptations:
 * - OpenRouter is the primary provider (reversed from ExoCortex).
 * - All env reads use Deno.env.get().
 */

import {
  EXTRACTION_PROMPT,
  CLASSIFIER_MODEL_OPENROUTER,
  CLASSIFIER_MODEL_OPENAI,
  CLASSIFIER_MODEL_ANTHROPIC,
  DEFAULT_TYPE,
  DEFAULT_IMPORTANCE,
  DEFAULT_QUALITY_SCORE,
  DEFAULT_SENSITIVITY_TIER,
  DEFAULT_CONFIDENCE,
  STRUCTURED_CAPTURE_CONFIDENCE,
  STRUCTURED_CAPTURE_IMPORTANCE,
  SENSITIVITY_TIERS,
  MAX_SUMMARY_LENGTH,
  ENRICHMENT_RETRY_DELAY_MS,
  ALLOWED_TYPES,
  RESTRICTED_PATTERNS,
  PERSONAL_PATTERNS,
  EMBEDDING_DIMENSION,
  type ThoughtMetadata,
  type SensitivityResult,
  type PreparedPayload,
  type PrepareThoughtOpts,
  type StructuredCapture,
} from "./config.ts";

// ── Type coercion helpers ──────────────────────────────────────────────────

export function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function asInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(asNumber(value, fallback, min, max));
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function asOptionalInteger(value: unknown, min: number, max: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  return asInteger(value, min, min, max);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── Array helpers ──────────────────────────────────────────────────────────

/** Deduplicate, filter empty strings, and cap at 12 items. */
export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0)
      .slice(0, 12),
  )];
}

/** Combine two string arrays with dedup via normalizeStringArray. */
export function mergeUniqueStrings(base: unknown, extras: string[]): string[] {
  return normalizeStringArray([
    ...normalizeStringArray(base),
    ...normalizeStringArray(extras),
  ]);
}

// ── Embedding helpers ──────────────────────────────────────────────────────

/** Returns the embedding only if it has the correct dimension count, otherwise undefined. */
export function safeEmbedding(emb: number[] | null | undefined): number[] | undefined {
  return Array.isArray(emb) && emb.length === EMBEDDING_DIMENSION ? emb : undefined;
}

/**
 * Generate a text embedding via OpenRouter (primary) or OpenAI (fallback).
 *
 * OB1 adaptation: OpenRouter is tried first (reversed from ExoCortex).
 */
export async function embedText(text: string): Promise<number[]> {
  const openRouterKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  const openAiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const openRouterModel = Deno.env.get("OPENROUTER_EMBEDDING_MODEL") ?? "openai/text-embedding-3-small";
  const openAiModel = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";

  // Primary: OpenRouter
  if (openRouterKey) {
    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openRouterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: openRouterModel, input: text }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter embedding failed (${response.status}): ${await response.text()}`);
    }

    const payload = await response.json();
    const embedding = payload?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("OpenRouter embedding response missing vector data");
    }
    return embedding as number[];
  }

  // Fallback: OpenAI direct
  if (openAiKey) {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: openAiModel, input: text }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding failed (${response.status}): ${await response.text()}`);
    }

    const payload = await response.json();
    const embedding = payload?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("OpenAI embedding response missing vector data");
    }
    return embedding as number[];
  }

  throw new Error("No embedding API key configured. Set OPENROUTER_API_KEY or OPENAI_API_KEY.");
}

// ── Metadata extraction ────────────────────────────────────────────────────

type MetadataProvider = "openrouter" | "openai" | "anthropic";

/** Read env and return configured providers in OB1 priority order (openrouter first). */
function getConfiguredMetadataProviders(): MetadataProvider[] {
  const providers: MetadataProvider[] = [];
  if (Deno.env.get("OPENROUTER_API_KEY")) providers.push("openrouter");
  if (Deno.env.get("OPENAI_API_KEY")) providers.push("openai");
  if (Deno.env.get("ANTHROPIC_API_KEY")) providers.push("anthropic");
  return providers;
}

/** Fetch metadata from OpenRouter chat completions endpoint. */
async function fetchOpenRouterMetadata(text: string): Promise<string> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const model = Deno.env.get("OPENROUTER_CLASSIFIER_MODEL") ?? CLASSIFIER_MODEL_OPENROUTER;
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: `${EXTRACTION_PROMPT}\nReturn only the JSON object.` },
        { role: "user", content: text },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter classification failed (${response.status}): ${await response.text()}`);
  }

  return readChatCompletionText(await response.json());
}

/** Fetch metadata from OpenAI chat completions endpoint. */
async function fetchOpenAIMetadata(text: string): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const model = Deno.env.get("OPENAI_CLASSIFIER_MODEL") ?? CLASSIFIER_MODEL_OPENAI;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        { role: "user", content: text },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI classification failed (${response.status}): ${await response.text()}`);
  }

  return readChatCompletionText(await response.json());
}

/** Fetch metadata from Anthropic Messages API. */
async function fetchAnthropicMetadata(text: string): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const model = Deno.env.get("ANTHROPIC_CLASSIFIER_MODEL") ?? CLASSIFIER_MODEL_ANTHROPIC;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature: 0.1,
      system: EXTRACTION_PROMPT,
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic classification failed (${response.status}): ${await response.text()}`);
  }

  return readAnthropicText(await response.json());
}

/** Extract text content from an OpenAI/OpenRouter chat completion response. */
function readChatCompletionText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return "";
  }
  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) return "";

  const content = firstChoice.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!isRecord(part) || asString(part.type, "") !== "text") return "";
      return asString(part.text, "");
    })
    .join("");
}

/** Extract text content from an Anthropic Messages response. */
function readAnthropicText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.content) || payload.content.length === 0) {
    return "";
  }
  return payload.content
    .map((block: unknown) => {
      if (!isRecord(block) || asString(block.type, "") !== "text") return "";
      return asString(block.text, "");
    })
    .join("");
}

/** Strip markdown code fences (```json ... ```) that LLMs sometimes wrap around JSON output. */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return match ? match[1].trim() : trimmed;
}

/** True for errors worth retrying: network failures, 429, and 5xx statuses. */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  if (/fetch failed|network|ECONNRESET|ETIMEDOUT|UND_ERR/i.test(msg)) return true;
  if (/\b(429|500|502|503|529)\b/.test(msg)) return true;
  return false;
}

/**
 * Multi-provider metadata extraction with retry and fallback logic.
 *
 * OB1 adaptation: provider priority is openrouter > openai > anthropic.
 */
export async function extractMetadata(
  text: string,
): Promise<ThoughtMetadata & { _enrichment_status: "complete" | "fallback" }> {
  const fallback = fallbackMetadata(text);
  const configuredProviders = getConfiguredMetadataProviders();
  const primary = configuredProviders[0];

  if (!primary) {
    console.warn("No metadata provider configured, returning fallback");
    return { ...fallback, _enrichment_status: "fallback" };
  }

  const fetchProvider = (p: MetadataProvider) =>
    p === "openrouter"
      ? fetchOpenRouterMetadata(text)
      : p === "openai"
      ? fetchOpenAIMetadata(text)
      : fetchAnthropicMetadata(text);

  const parseResult = (raw: string): ThoughtMetadata | null => {
    if (!raw.trim()) return null;
    const parsed = JSON.parse(stripCodeFences(raw));
    return sanitizeMetadata(parsed, text);
  };

  // Attempt 1: primary provider
  let lastError: unknown;
  try {
    const result = parseResult(await fetchProvider(primary));
    if (result) return { ...result, _enrichment_status: "complete" };
  } catch (err) {
    lastError = err;
    console.warn("Primary metadata classification failed (attempt 1)", primary, err);
  }

  // Attempt 2: retry primary after delay for transient failures only
  if (isTransientError(lastError)) {
    try {
      await new Promise((r) => setTimeout(r, ENRICHMENT_RETRY_DELAY_MS));
      const result = parseResult(await fetchProvider(primary));
      if (result) return { ...result, _enrichment_status: "complete" };
    } catch (err) {
      console.warn("Primary metadata classification failed (attempt 2)", primary, err);
    }
  }

  // Attempt 3: fall through to other configured providers
  for (const fallbackProvider of configuredProviders.filter((p) => p !== primary)) {
    try {
      const result = parseResult(await fetchProvider(fallbackProvider));
      if (result) return { ...result, _enrichment_status: "complete" };
    } catch (err) {
      console.warn("Fallback metadata classification failed", fallbackProvider, err);
    }
  }

  return { ...fallback, _enrichment_status: "fallback" };
}

// ── Fallback & sanitization ────────────────────────────────────────────────

/** Minimal metadata when all classifiers fail. */
export function fallbackMetadata(input: string): ThoughtMetadata {
  return {
    type: "idea",
    summary: input.slice(0, 160),
    topics: [],
    tags: [],
    people: [],
    action_items: [],
    importance: null,
    confidence: 0.2,
  };
}

/** Validate and bounds-check LLM-produced metadata. */
export function sanitizeMetadata(value: unknown, sourceText: string): ThoughtMetadata {
  const fallback = fallbackMetadata(sourceText);

  if (!isRecord(value)) return fallback;

  const typeCandidate = asString(value.type, fallback.type);
  const type = ALLOWED_TYPES.has(typeCandidate) ? typeCandidate : fallback.type;

  const summary = asString(value.summary, fallback.summary).trim().slice(0, 160) || fallback.summary;
  const confidence = asNumber(value.confidence, fallback.confidence, 0, 1);

  // Extract LLM-assigned importance (0-5 range; 6 is user-only, never auto-assigned)
  const rawImportance =
    value.importance !== undefined && value.importance !== null
      ? asInteger(value.importance, DEFAULT_IMPORTANCE, 0, 5)
      : null;

  return {
    type,
    summary,
    topics: normalizeStringArray(value.topics),
    tags: normalizeStringArray(value.tags),
    people: normalizeStringArray(value.people),
    action_items: normalizeStringArray(value.action_items),
    importance: rawImportance,
    confidence,
  };
}

// ── Sensitivity detection ──────────────────────────────────────────────────

/** Test text against restricted and personal patterns. */
export function detectSensitivity(text: string): SensitivityResult {
  const reasons: string[] = [];

  for (const [pattern, reason] of RESTRICTED_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push(reason);
      return { tier: "restricted", reasons };
    }
  }

  for (const [pattern, reason] of PERSONAL_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push(reason);
    }
  }

  if (reasons.length > 0) return { tier: "personal", reasons };
  return { tier: "standard", reasons: [] };
}

// ── Content fingerprint ────────────────────────────────────────────────────

/**
 * Compute SHA-256 fingerprint of normalized content.
 * Algorithm: lowercase -> collapse whitespace -> trim -> SHA-256 hex.
 * Uses Web Crypto API (available in Deno and modern browsers).
 */
export async function computeContentFingerprint(content: string): Promise<string> {
  const normalized = content.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return "";
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Structured capture parsing ─────────────────────────────────────────────

/** Parse `[type] [topic] body text + next step` format. */
export function parseStructuredCapture(content: string): StructuredCapture {
  const trimmed = content.trim();
  const match = /^\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.+?)(?:\s*\+\s*(.+))?$/i.exec(trimmed);

  if (!match) {
    return {
      matched: false,
      normalizedText: trimmed,
      typeHint: null,
      topicHint: null,
      nextStep: null,
    };
  }

  const typeHint = normalizeTypeHint(match[1] ?? "");
  const topicHint = (match[2] ?? "").trim().slice(0, 80) || null;
  const thoughtBody = (match[3] ?? "").trim();
  const nextStep = (match[4] ?? "").trim().slice(0, 180) || null;
  const normalizedText = nextStep
    ? `${thoughtBody} Next step: ${nextStep}`
    : thoughtBody;

  return {
    matched: true,
    normalizedText,
    typeHint,
    topicHint,
    nextStep,
  };
}

/** Map common aliases to canonical thought types. */
export function normalizeTypeHint(value: string): string | null {
  const key = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (!key) return null;

  const aliases: Record<string, string> = {
    idea: "idea",
    task: "task",
    person: "person_note",
    person_note: "person_note",
    reference: "reference",
    ref: "reference",
    note: "reference",
    decision: "decision",
    lesson: "lesson",
    meeting: "meeting",
    event: "meeting",
    journal: "journal",
  };

  return aliases[key] ?? null;
}

// ── Evergreen tagging ──────────────────────────────────────────────────────

/** Add "evergreen" tag if the content contains the word. */
export function applyEvergreenTag(
  content: string,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...metadata };
  const tags = normalizeStringArray(result.tags);

  if (/\bevergreen\b/i.test(content)) {
    const hasEvergreen = tags.some((tag) => tag.toLowerCase() === "evergreen");
    if (!hasEvergreen) tags.push("evergreen");
  }

  result.tags = tags;
  return result;
}

// ── Sensitivity tier resolution ────────────────────────────────────────────

/**
 * Resolve sensitivity tier with escalation-only semantics.
 * Can only escalate (standard -> personal -> restricted), never downgrade.
 * Unrecognized values normalize to "personal" (safe default).
 */
export function resolveSensitivityTier(
  detected: typeof SENSITIVITY_TIERS[number],
  override?: string,
): typeof SENSITIVITY_TIERS[number] {
  if (!override) return detected;

  const normalized = override.trim().toLowerCase();
  const validTiers: readonly string[] = SENSITIVITY_TIERS;
  const overrideIndex = validTiers.indexOf(normalized);
  const detectedIndex = validTiers.indexOf(detected);

  if (overrideIndex < 0) {
    // Unrecognized value -> normalize to "personal" (safe default)
    const personalIndex = validTiers.indexOf("personal");
    return SENSITIVITY_TIERS[Math.max(detectedIndex, personalIndex)];
  }

  // Only escalate, never downgrade
  return SENSITIVITY_TIERS[Math.max(detectedIndex, overrideIndex)];
}

// ── Master ingest pipeline ─────────────────────────────────────────────────

/** Validate type against ALLOWED_TYPES, returning DEFAULT_TYPE on mismatch. */
function sanitizeType(value: string): string {
  const normalized = value.trim().toLowerCase();
  return ALLOWED_TYPES.has(normalized) ? normalized : DEFAULT_TYPE;
}

/**
 * Canonical thought preparation pipeline.
 *
 * Override precedence (highest to lowest):
 *   1. Structured capture hint (from parseStructuredCapture)
 *   2. Explicit caller override (opts.metadata.type, opts.metadata.importance, etc.)
 *   3. Extracted metadata (from LLM classification via extractMetadata)
 *   4. Defaults (type: 'idea', importance: 3, quality_score: 50, sensitivity: 'standard')
 *
 * All ingest paths (MCP capture_thought, REST /capture, smart-ingest) call this.
 */
export async function prepareThoughtPayload(
  content: string,
  opts?: PrepareThoughtOpts,
): Promise<PreparedPayload> {
  const source = opts?.source ?? "mcp";
  const sourceType = opts?.source_type ?? source;
  const extraMetadata = opts?.metadata ?? {};
  const warnings: string[] = [];

  // Step 1: Parse structured capture format
  const structuredCapture = parseStructuredCapture(content);
  const normalizedText = structuredCapture.normalizedText.trim();

  if (!normalizedText) {
    throw new Error("content is required");
  }

  const isOversized = normalizedText.length > 30000;
  if (isOversized) {
    warnings.push("oversized_content");
    console.warn(
      `prepareThoughtPayload received oversized content (${normalizedText.length} chars); consider routing through smart-ingest for atomization.`,
    );
  }

  // Step 2: Detect sensitivity
  const sensitivity = detectSensitivity(normalizedText);

  // Step 3: Resolve type (precedence: structured > caller > extracted > default)
  const callerType = asString(extraMetadata.memory_type, asString(extraMetadata.type, ""));

  // Step 4: Extract metadata via LLM (if not skipped)
  let extracted: ThoughtMetadata | null = null;
  let enrichmentStatus: "complete" | "fallback" | "skipped" = "skipped";
  if (!opts?.skip_classification) {
    try {
      const result = await extractMetadata(normalizedText);
      enrichmentStatus = result._enrichment_status;
      extracted = result;
      if (enrichmentStatus === "fallback") {
        warnings.push("metadata_fallback");
      }
    } catch (err) {
      console.warn("Metadata extraction failed, using defaults", err);
      warnings.push("metadata_fallback");
      enrichmentStatus = "fallback";
    }
  }

  // Step 5: Apply precedence rules for type
  const resolvedType = sanitizeType(
    structuredCapture.typeHint || callerType || extracted?.type || DEFAULT_TYPE,
  );

  // Step 6: Merge topics, tags, people, action_items
  const baseTags = normalizeStringArray(extraMetadata.tags);
  const baseTopics = normalizeStringArray(extraMetadata.topics);
  const basePeople = normalizeStringArray(extraMetadata.people);
  const baseActionItems = normalizeStringArray(extraMetadata.action_items);

  const extractedTopics = extracted ? normalizeStringArray(extracted.topics) : [];
  const extractedTags = extracted ? normalizeStringArray(extracted.tags) : [];
  const extractedPeople = extracted ? normalizeStringArray(extracted.people) : [];
  const extractedActionItems = extracted ? normalizeStringArray(extracted.action_items) : [];

  let topics = mergeUniqueStrings(baseTopics.length > 0 ? baseTopics : extractedTopics, []);
  let tags = mergeUniqueStrings(baseTags.length > 0 ? baseTags : extractedTags, []);
  const people = mergeUniqueStrings(basePeople.length > 0 ? basePeople : extractedPeople, []);
  let actionItems = mergeUniqueStrings(
    baseActionItems.length > 0 ? baseActionItems : extractedActionItems,
    [],
  );

  // Add structured capture hints
  if (structuredCapture.topicHint) {
    topics = mergeUniqueStrings(topics, [structuredCapture.topicHint]);
    tags = mergeUniqueStrings(tags, [structuredCapture.topicHint]);
  }
  if (structuredCapture.nextStep) {
    actionItems = mergeUniqueStrings(actionItems, [structuredCapture.nextStep]);
  }

  // Step 7: Resolve importance (precedence: caller > structured > LLM-extracted > default)
  const callerImportance =
    extraMetadata.importance !== undefined
      ? asInteger(extraMetadata.importance, DEFAULT_IMPORTANCE, 0, 6)
      : null;
  const structuredImportance = structuredCapture.matched ? STRUCTURED_CAPTURE_IMPORTANCE : null;
  const extractedImportance = extracted?.importance ?? null;
  const importance =
    callerImportance ?? structuredImportance ?? extractedImportance ?? DEFAULT_IMPORTANCE;

  // Step 8: Resolve confidence
  const callerConfidence =
    extraMetadata.confidence !== undefined
      ? asNumber(extraMetadata.confidence, DEFAULT_CONFIDENCE, 0, 1)
      : null;
  const structuredConfidence = structuredCapture.matched ? STRUCTURED_CAPTURE_CONFIDENCE : null;
  const confidence =
    callerConfidence ?? structuredConfidence ?? extracted?.confidence ?? DEFAULT_CONFIDENCE;

  // Step 9: Resolve quality score
  const callerQuality =
    extraMetadata.quality_score !== undefined
      ? asNumber(extraMetadata.quality_score, DEFAULT_QUALITY_SCORE, 0, 100)
      : null;
  const quality_score = callerQuality ?? Math.round(confidence * 70 + 20);

  // Step 10: Resolve summary
  const callerSummary = asString(extraMetadata.summary, "");
  const extractedSummary = extracted?.summary ?? "";
  const summary = (callerSummary || extractedSummary || normalizedText)
    .trim()
    .slice(0, MAX_SUMMARY_LENGTH);

  // Step 11: Resolve sensitivity tier (escalation only)
  const callerSensitivity = asString(
    extraMetadata.sensitivity_tier,
    asString(extraMetadata.sensitivity, ""),
  );
  const sensitivity_tier = resolveSensitivityTier(
    sensitivity.tier,
    callerSensitivity || undefined,
  );

  // Step 12: Compute embedding
  let embedding: number[] = [];
  if (opts?.embedding) {
    embedding = opts.embedding;
  } else if (!opts?.skip_embedding) {
    try {
      embedding = await embedText(normalizedText);
    } catch (err) {
      console.warn("Embedding failed, will be null", err);
      warnings.push("embedding_unavailable");
    }
  }

  // Step 13: Compute content fingerprint
  const content_fingerprint = await computeContentFingerprint(normalizedText);

  // Step 14: Assemble metadata object with evergreen tag
  const metadata = applyEvergreenTag(normalizedText, {
    ...extraMetadata,
    type: resolvedType,
    summary,
    topics,
    tags,
    people,
    action_items: actionItems,
    confidence,
    source,
    source_type: asString(extraMetadata.source_type, sourceType),
    capture_format: structuredCapture.matched ? "structured_v1" : "freeform",
    structured_capture: structuredCapture.matched
      ? {
          type: structuredCapture.typeHint,
          topic: structuredCapture.topicHint,
          next_step: structuredCapture.nextStep,
        }
      : null,
    oversized: isOversized || extraMetadata.oversized === true,
    captured_at: asString(extraMetadata.captured_at, new Date().toISOString()),
    sensitivity_reasons: sensitivity.reasons,
    agent_name: asString(extraMetadata.agent_name, "mcp"),
    provider: asString(extraMetadata.provider, "mcp"),
    enrichment_status: enrichmentStatus,
    enrichment_attempted_at: enrichmentStatus !== "skipped" ? new Date().toISOString() : null,
    ...(warnings.length > 0 ? { enrichment_warnings: warnings } : {}),
  });

  return {
    content: normalizedText,
    embedding,
    metadata,
    type: resolvedType,
    importance,
    quality_score,
    sensitivity_tier,
    source_type: asString(extraMetadata.source_type, sourceType),
    content_fingerprint,
    warnings,
  };
}

// ── Supabase utility ───────────────────────────────────────────────────────

/** Quick existence check: returns true if the table can be queried without error. */
export async function tableExists(
  supabase: { from: (name: string) => { select: (cols: string) => { limit: (n: number) => Promise<{ error: unknown }> } } },
  tableName: string,
): Promise<boolean> {
  const { error } = await supabase.from(tableName).select("id").limit(0);
  return !error;
}
