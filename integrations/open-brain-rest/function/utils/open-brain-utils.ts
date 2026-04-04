// Shared utilities for Open Brain Edge Functions.
// Both ingest-thought and open-brain-mcp import from here.

import {
  DEFAULT_TYPE,
  DEFAULT_IMPORTANCE,
  DEFAULT_QUALITY_SCORE,
  DEFAULT_SENSITIVITY_TIER,
  DEFAULT_CONFIDENCE,
  STRUCTURED_CAPTURE_CONFIDENCE,
  STRUCTURED_CAPTURE_IMPORTANCE,
  SENSITIVITY_TIERS,
  MAX_SUMMARY_LENGTH,
  EXTRACTION_PROMPT,
} from "./ingest-config.ts";

export type ThoughtMetadata = {
  type: string;
  summary: string;
  topics: string[];
  tags: string[];
  people: string[];
  action_items: string[];
  confidence: number;
};

/** Dimension count for text-embedding-3-small vectors. */
export const EMBEDDING_DIMENSIONS = 1536;

/** Returns the embedding if it has the correct dimension count, otherwise undefined. */
export const safeEmbedding = (emb: number[] | null | undefined): number[] | undefined =>
  Array.isArray(emb) && emb.length === EMBEDDING_DIMENSIONS ? emb : undefined;

export const ALLOWED_TYPES = new Set([
  "idea",
  "task",
  "person_note",
  "reference",
  "decision",
  "lesson",
  "meeting",
  "journal",
]);

type ProviderEnv = {
  openAiApiKey: string;
  openAiEmbeddingModel: string;
  anthropicApiKey: string;
  anthropicClassifierModel: string;
  // Fallback: OpenRouter key for embeddings if OPENAI_API_KEY not set
  openRouterApiKey: string;
  openRouterEmbeddingModel: string;
};

export type EmbeddingProvider = "openai";
export type MetadataProvider = "anthropic" | "openai";

function readProviderEnv(): ProviderEnv {
  return {
    openAiApiKey: Deno.env.get("OPENAI_API_KEY") ?? "",
    openAiEmbeddingModel: Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small",
    anthropicApiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
    anthropicClassifierModel: Deno.env.get("ANTHROPIC_CLASSIFIER_MODEL") ?? "claude-3-5-haiku-20241022",
    openRouterApiKey: Deno.env.get("OPENROUTER_API_KEY") ?? "",
    openRouterEmbeddingModel: Deno.env.get("OPENROUTER_EMBEDDING_MODEL") ?? "openai/text-embedding-3-small",
  };
}

export function detectEmbeddingProvider(): EmbeddingProvider {
  return "openai";
}

export function detectMetadataProvider(): MetadataProvider {
  const env = readProviderEnv();
  return env.anthropicApiKey ? "anthropic" : "openai";
}

export async function embedText(input: string, _provider?: EmbeddingProvider): Promise<number[]> {
  const env = readProviderEnv();

  // Prefer OpenAI direct, fall back to OpenRouter (which proxies to OpenAI)
  if (env.openAiApiKey) {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: openAIHeaders(env.openAiApiKey),
      body: JSON.stringify({ model: env.openAiEmbeddingModel, input }),
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

  // Fallback: use OpenRouter to proxy OpenAI embeddings
  if (env.openRouterApiKey) {
    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.openRouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: env.openRouterEmbeddingModel, input }),
    });

    if (!response.ok) {
      throw new Error(`Embedding via proxy failed (${response.status}): ${await response.text()}`);
    }

    const payload = await response.json();
    const embedding = payload?.data?.[0]?.embedding;

    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("Embedding proxy response missing vector data");
    }

    return embedding as number[];
  }

  throw new Error("No embedding API key configured. Set OPENAI_API_KEY or OPENROUTER_API_KEY.");
}

// Classifier prompt is now in ingest-config.ts — imported as EXTRACTION_PROMPT
const CLASSIFIER_PROMPT = EXTRACTION_PROMPT;

export async function extractMetadata(input: string, provider?: MetadataProvider): Promise<ThoughtMetadata> {
  const fallback = fallbackMetadata(input);
  const resolved = provider ?? detectMetadataProvider();

  // Try primary provider
  try {
    const raw = resolved === "anthropic"
      ? await fetchAnthropicMetadata(input)
      : await fetchOpenAIMetadata(input);

    if (raw.trim()) {
      const parsed = JSON.parse(raw);
      return sanitizeMetadata(parsed, input);
    }
  } catch (err) {
    console.warn("Primary metadata classification failed", resolved, err);
  }

  // Fallback: try the other provider
  const fallbackProvider = resolved === "anthropic" ? "openai" : "anthropic";
  try {
    const raw = fallbackProvider === "anthropic"
      ? await fetchAnthropicMetadata(input)
      : await fetchOpenAIMetadata(input);

    if (raw.trim()) {
      const parsed = JSON.parse(raw);
      return sanitizeMetadata(parsed, input);
    }
  } catch (err) {
    console.warn("Fallback metadata classification failed", fallbackProvider, err);
  }

  return fallback;
}

export function fallbackMetadata(input: string): ThoughtMetadata {
  return {
    type: "idea",
    summary: input.slice(0, 160),
    topics: [],
    tags: [],
    people: [],
    action_items: [],
    confidence: 0.2,
  };
}

export function sanitizeMetadata(value: unknown, sourceText: string): ThoughtMetadata {
  const fallback = fallbackMetadata(sourceText);

  if (!isRecord(value)) {
    return fallback;
  }

  const typeCandidate = asString(value.type, fallback.type);
  const type = ALLOWED_TYPES.has(typeCandidate) ? typeCandidate : fallback.type;

  const summary = asString(value.summary, fallback.summary).trim().slice(0, 160) || fallback.summary;
  const confidence = asNumber(value.confidence, fallback.confidence, 0, 1);

  return {
    type,
    summary,
    topics: normalizeStringArray(value.topics),
    tags: normalizeStringArray(value.tags),
    people: normalizeStringArray(value.people),
    action_items: normalizeStringArray(value.action_items),
    confidence,
  };
}

export function applyEvergreenTag(content: string, metadata: Record<string, unknown>): Record<string, unknown> {
  const result = { ...metadata };
  const tags = normalizeStringArray(result.tags);

  if (containsEvergreen(content)) {
    const hasEvergreen = tags.some((tag) => tag.toLowerCase() === "evergreen");
    if (!hasEvergreen) {
      tags.push("evergreen");
    }
  }

  result.tags = tags;
  return result;
}

export function containsEvergreen(content: string): boolean {
  return /\bevergreen\b/i.test(content);
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0)
      .slice(0, 12),
  )];
}

async function fetchAnthropicMetadata(input: string): Promise<string> {
  const env = readProviderEnv();
  if (!env.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.anthropicClassifierModel,
      max_tokens: 1024,
      temperature: 0.1,
      system: CLASSIFIER_PROMPT,
      messages: [
        { role: "user", content: input },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic classification failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json();
  return readAnthropicText(payload);
}

async function fetchOpenAIMetadata(input: string): Promise<string> {
  const env = readProviderEnv();
  if (!env.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: openAIHeaders(env.openAiApiKey),
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CLASSIFIER_PROMPT },
        { role: "user", content: input },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI classification failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json();
  return readChatCompletionText(payload);
}

function readAnthropicText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.content) || payload.content.length === 0) {
    return "";
  }

  return payload.content
    .map((block: unknown) => {
      if (!isRecord(block) || asString(block.type, "") !== "text") {
        return "";
      }
      return asString(block.text, "");
    })
    .join("");
}

function readChatCompletionText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return "";
  }

  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return "";
  }

  const content = firstChoice.message.content;
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!isRecord(part) || asString(part.type, "") !== "text") {
        return "";
      }

      return asString(part.text, "");
    })
    .join("");
}

function openAIHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

// --- Sensitivity detection ---
// Patterns loaded from shared config: config/sensitivity-patterns.json
import { RESTRICTED_PATTERNS, PERSONAL_PATTERNS } from "./sensitivity-patterns.ts";

export type SensitivityResult = {
  tier: "standard" | "personal" | "restricted";
  reasons: string[];
};

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

  if (reasons.length > 0) {
    return { tier: "personal", reasons };
  }

  return { tier: "standard", reasons: [] };
}

// --- Structured capture parsing ---

export type StructuredCapture = {
  matched: boolean;
  normalizedText: string;
  typeHint: string | null;
  topicHint: string | null;
  nextStep: string | null;
};

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

export function normalizeTypeHint(value: string): string | null {
  const key = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (!key) {
    return null;
  }

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
    reflection: "journal",
  };

  return aliases[key] ?? null;
}

export function mergeUniqueStrings(base: unknown, extras: string[]): string[] {
  return normalizeStringArray([
    ...normalizeStringArray(base),
    ...normalizeStringArray(extras),
  ]);
}

// --- Generic helpers ---

export function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export function asInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(asNumber(value, fallback, min, max));
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function asOptionalInteger(value: unknown, min: number, max: number): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return asInteger(value, min, min, max);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- Content fingerprint ---

/**
 * Compute SHA-256 fingerprint matching the SQL `compute_thought_content_fingerprint()`.
 * Algorithm: lowercase → collapse whitespace → trim → SHA-256 hex.
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

// --- Sensitivity tier resolution ---

/**
 * Resolve sensitivity tier with escalation-only semantics.
 * Can only escalate (standard → personal → restricted), never downgrade.
 * Unrecognized values normalize to "personal".
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
    // Unrecognized value → normalize to "personal" (safe default)
    const personalIndex = validTiers.indexOf("personal");
    return SENSITIVITY_TIERS[Math.max(detectedIndex, personalIndex)];
  }

  // Only escalate, never downgrade
  return SENSITIVITY_TIERS[Math.max(detectedIndex, overrideIndex)];
}

// --- Canonical ingest pipeline ---

export type PreparedPayload = {
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  type: string;
  importance: number;
  quality_score: number;
  sensitivity_tier: string;
  source_type: string;
  content_fingerprint: string;
  warnings: string[];
};

/** Ambient capture provenance fields — threaded through smart-ingest into thought metadata. */
export type SourceMetadata = {
  source_client?: string;     // "claude_code" | "claude_ai" | "chatgpt" | etc.
  capture_mode?: string;      // "ambient_session_end" | "manual" | "bulk_import"
  session_id?: string;        // External session UUID
  source_title?: string;      // Human-readable session name
  captured_at?: string;       // ISO 8601 timestamp
  project_path?: string;      // Working directory from transcript
  git_branch?: string;        // Branch name if available
  import_key?: string;        // Idempotency key for session-level dedup
};

export type PrepareThoughtOpts = {
  source?: string;
  source_type?: string;
  metadata?: Record<string, unknown>;
  /** Skip embedding computation (for dry-run or when caller provides embedding) */
  skip_embedding?: boolean;
  /** Pre-computed embedding to use instead of calling embedText */
  embedding?: number[];
  /** Skip LLM metadata extraction (use only structured capture + defaults) */
  skip_classification?: boolean;
};

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

  // Step 2: Detect sensitivity
  const sensitivity = detectSensitivity(normalizedText);

  // Step 3: Resolve type (precedence: structured > caller > extracted > default)
  const callerType = asString(extraMetadata.memory_type, asString(extraMetadata.type, ""));

  // Step 4: Extract metadata via LLM (if not skipped)
  let extracted: ThoughtMetadata | null = null;
  if (!opts?.skip_classification) {
    try {
      extracted = await extractMetadata(normalizedText);
    } catch (err) {
      console.warn("Metadata extraction failed, using defaults", err);
      warnings.push("metadata_fallback");
    }
  }

  // Step 5: Apply precedence rules for type
  const resolvedType = sanitizeType(
    structuredCapture.typeHint || callerType || extracted?.type || DEFAULT_TYPE
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
    baseActionItems.length > 0 ? baseActionItems : extractedActionItems, []
  );

  // Add structured capture hints
  if (structuredCapture.topicHint) {
    topics = mergeUniqueStrings(topics, [structuredCapture.topicHint]);
    tags = mergeUniqueStrings(tags, [structuredCapture.topicHint]);
  }
  if (structuredCapture.nextStep) {
    actionItems = mergeUniqueStrings(actionItems, [structuredCapture.nextStep]);
  }

  // Step 7: Resolve importance (precedence: caller > structured > extracted-confidence > default)
  const callerImportance = extraMetadata.importance !== undefined
    ? asInteger(extraMetadata.importance, DEFAULT_IMPORTANCE, 1, 5)
    : null;
  const structuredImportance = structuredCapture.matched ? STRUCTURED_CAPTURE_IMPORTANCE : null;
  const importance = callerImportance ?? structuredImportance ?? DEFAULT_IMPORTANCE;

  // Step 8: Resolve confidence
  const callerConfidence = extraMetadata.confidence !== undefined
    ? asNumber(extraMetadata.confidence, DEFAULT_CONFIDENCE, 0, 1)
    : null;
  const structuredConfidence = structuredCapture.matched ? STRUCTURED_CAPTURE_CONFIDENCE : null;
  const confidence = callerConfidence ?? structuredConfidence ?? extracted?.confidence ?? DEFAULT_CONFIDENCE;

  // Step 9: Resolve quality score
  const callerQuality = extraMetadata.quality_score !== undefined
    ? asNumber(extraMetadata.quality_score, DEFAULT_QUALITY_SCORE, 0, 100)
    : null;
  const quality_score = callerQuality ?? Math.round((confidence * 70) + 20);

  // Step 10: Resolve summary
  const callerSummary = asString(extraMetadata.summary, "");
  const extractedSummary = extracted?.summary ?? "";
  const summary = (callerSummary || extractedSummary || normalizedText).trim().slice(0, MAX_SUMMARY_LENGTH);

  // Step 11: Resolve sensitivity tier (only escalates)
  const callerSensitivity = asString(extraMetadata.sensitivity_tier, asString(extraMetadata.sensitivity, ""));
  const sensitivity_tier = resolveSensitivityTier(sensitivity.tier, callerSensitivity || undefined);

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

  // Step 14: Assemble metadata object
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
    captured_at: new Date().toISOString(),
    sensitivity_reasons: sensitivity.reasons,
    agent_name: asString(extraMetadata.agent_name, "mcp"),
    provider: asString(extraMetadata.provider, "mcp"),
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

function sanitizeType(value: string): string {
  const normalized = value.trim().toLowerCase();
  return ALLOWED_TYPES.has(normalized) ? normalized : DEFAULT_TYPE;
}
