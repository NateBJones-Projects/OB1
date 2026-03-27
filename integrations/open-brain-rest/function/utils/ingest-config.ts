/**
 * Shared configuration constants for the ExoCortex ingestion pipeline.
 *
 * All values are plain constants with no runtime dependencies.
 * Import individual names as needed:
 *   import { EMBEDDING_MODEL, DEFAULT_TYPE } from "../_shared/ingest-config.ts";
 */

// ── Embedding ────────────────────────────────────────────────────────────────

/** OpenAI embedding model used for vector search. */
export const EMBEDDING_MODEL = "text-embedding-3-small";

/** Dimensionality of the embedding vectors stored in pgvector. */
export const EMBEDDING_DIMENSION = 1536;

/** Maximum content length (chars) before truncation for embedding calls. */
export const MAX_CONTENT_LENGTH = 8000;

// ── Classifier models ────────────────────────────────────────────────────────

/** Anthropic model used for metadata classification / enrichment. */
export const CLASSIFIER_MODEL_ANTHROPIC = "claude-3-5-haiku-20241022";

/** OpenAI model used as fallback classifier. */
export const CLASSIFIER_MODEL_OPENAI = "gpt-4o-mini";

// ── Thought defaults ─────────────────────────────────────────────────────────

/** Default thought type when classification is unavailable. */
export const DEFAULT_TYPE = "idea";

/** Default importance score (1-5 scale). */
export const DEFAULT_IMPORTANCE = 3;

/** Default quality score (0-100 scale). */
export const DEFAULT_QUALITY_SCORE = 50;

/** Default sensitivity tier. */
export const DEFAULT_SENSITIVITY_TIER = "standard";

/** Default classifier confidence for unclassified thoughts. */
export const DEFAULT_CONFIDENCE = 0.55;

// ── Structured capture overrides ─────────────────────────────────────────────

/**
 * Confidence assigned to thoughts captured via structured input (MCP, REST,
 * Telegram) where the caller supplies explicit type/topic metadata.
 */
export const STRUCTURED_CAPTURE_CONFIDENCE = 0.82;

/** Importance assigned to structured captures (slightly elevated). */
export const STRUCTURED_CAPTURE_IMPORTANCE = 4;

// ── Sensitivity ──────────────────────────────────────────────────────────────

/** Ordered sensitivity tiers — index 0 is least restrictive. */
export const SENSITIVITY_TIERS = ["standard", "personal", "restricted"] as const;

// ── Field length limits ──────────────────────────────────────────────────────

/** Maximum character length for thought summaries. */
export const MAX_SUMMARY_LENGTH = 160;

/** Maximum character length for topic hint strings. */
export const MAX_TOPIC_HINT_LENGTH = 80;

/** Maximum character length for next-step / action-item strings. */
export const MAX_NEXT_STEP_LENGTH = 180;

/** Maximum number of tags that can be attached to a single thought. */
export const MAX_TAGS_PER_THOUGHT = 12;

// ── Classifier prompt ────────────────────────────────────────────────────────

/**
 * System prompt sent to the classifier model when extracting metadata
 * (type, summary, topics, tags, people, action_items, confidence) from
 * raw thought content.
 */
export const EXTRACTION_PROMPT = [
  "You classify personal notes for a second-brain.",
  "Return STRICT JSON with keys: type, summary, topics, tags, people, action_items, confidence.",
  "",
  "type must be one of: idea, task, person_note, reference, decision, lesson, meeting, journal.",
  "summary: max 160 chars. topics: 1-3 short lowercase tags. tags: additional freeform labels.",
  "people: names mentioned. action_items: implied to-dos. confidence: 0-1.",
  "",
  "CONFIDENCE CALIBRATION:",
  "- 0.9+: Clearly personal — user's own decision, preference, lesson, health data",
  "- 0.7-0.89: Probably personal but could be generic advice",
  "- 0.5-0.69: Borderline — reads more like general knowledge than personal context",
  "- Below 0.5: Generic advice, encyclopedia-grade facts, or vague filler",
  "",
  "Examples:",
  "",
  'Input: "Met with Sarah about the API redesign. She wants GraphQL instead of REST. We\'ll prototype both by Friday."',
  'Output: {"type":"meeting","summary":"API redesign meeting with Sarah — prototyping GraphQL vs REST","topics":["api-design","graphql"],"tags":["architecture"],"people":["Sarah"],"action_items":["Prototype GraphQL API","Prototype REST API","Compare by Friday"],"confidence":0.95}',
  "",
  'Input: "I\'m going to use Supabase instead of Firebase. Better SQL support and the pgvector extension is critical for embeddings."',
  'Output: {"type":"decision","summary":"Chose Supabase over Firebase for SQL and pgvector support","topics":["database","infrastructure"],"tags":["architecture"],"people":[],"action_items":[],"confidence":0.92}',
  "",
  'Input: "Never run database migrations during peak traffic hours. Learned this the hard way last Tuesday."',
  'Output: {"type":"lesson","summary":"Avoid running DB migrations during peak traffic","topics":["devops","database"],"tags":["best-practice"],"people":[],"action_items":[],"confidence":0.90}',
  "",
  'Input: "The boiling point of water is 100\u00B0C at sea level."',
  'Output: {"type":"reference","summary":"Boiling point of water at sea level","topics":["science"],"tags":["general-knowledge"],"people":[],"action_items":[],"confidence":0.3}',
].join("\n");
