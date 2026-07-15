/** Shared configuration constants for the Enhanced MCP integration. */

// ── Embedding ────────────────────────────────────────────────────────────────

/** OpenAI embedding model via OpenRouter (OB1 standard). */
export const EMBEDDING_MODEL = "openai/text-embedding-3-small";

/** Dimensionality of the embedding vectors stored in pgvector. */
export const EMBEDDING_DIMENSION = 1536;

/** Maximum content length (chars) before truncation for embedding calls. */
export const MAX_CONTENT_LENGTH = 8000;

// ── Classifier models ────────────────────────────────────────────────────────
// Order reversed from ExoCortex — OpenRouter is primary for OB1 deployments.

/** OpenRouter model used as the primary classifier. */
export const CLASSIFIER_MODEL_OPENROUTER = "anthropic/claude-haiku-4-5";

/** OpenAI model used as secondary classifier fallback. */
export const CLASSIFIER_MODEL_OPENAI = "gpt-4o-mini";

/** Anthropic model used as tertiary classifier fallback. */
export const CLASSIFIER_MODEL_ANTHROPIC = "claude-haiku-4-5-20251001";

// ── Thought defaults ─────────────────────────────────────────────────────────

/** Default thought type when classification is unavailable. */
export const DEFAULT_TYPE = "idea";

/**
 * Default importance score (0-6 scale).
 *
 * 0 = Noise — information we don't want
 * 1 = Trivial
 * 2 = Low
 * 3 = Normal (center of bell curve — most thoughts land here)
 * 4 = Notable
 * 5 = Important
 * 6 = User-flagged only — never assigned automatically by LLM
 */
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

// ── Enrichment retry ────────────────────────────────────────────────────────

/** Delay (ms) before retrying the primary classifier on transient failure. */
export const ENRICHMENT_RETRY_DELAY_MS = 1500;

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

// ── Allowed types ────────────────────────────────────────────────────────────

/** Canonical set of thought types accepted by the system. */
export const ALLOWED_TYPES = new Set([
  "idea", "task", "person_note", "reference", "decision", "lesson", "meeting", "journal",
]);

// ── Classifier prompt ────────────────────────────────────────────────────────

/**
 * System prompt sent to the classifier model when extracting metadata
 * (type, summary, topics, tags, people, action_items, confidence) from
 * raw thought content.
 */
export const EXTRACTION_PROMPT = [
  "You classify personal notes for a second-brain.",
  "Return STRICT JSON with keys: type, summary, topics, tags, people, action_items, importance, confidence.",
  "",
  "IMPORTANCE (0-6 scale):",
  "Rate importance 0-6. 0=noise/not useful. 1=trivial. 2=low. 3=normal. 4=notable. 5=important.",
  "6 is reserved for user-flagged critical items — never assign 6 automatically.",
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

// ── Sensitivity patterns ────────────────────────────────────────────────────

/** Patterns that trigger "restricted" sensitivity tier. */
export const RESTRICTED_PATTERNS: [RegExp, string][] = [
  [/\b\d{3}-?\d{2}-?\d{4}\b/, "ssn_pattern"],
  [/\b[A-Z]{1,2}\d{6,9}\b/, "passport_pattern"],
  [/\b\d{8,17}\b.*\b(account|routing|iban)\b/i, "bank_account"],
  [/\b(account|routing)\b.*\b\d{8,17}\b/i, "bank_account"],
  [/\b(sk-|pk_live_|sk_live_|ghp_|gho_|AKIA)[A-Za-z0-9]{10,}/i, "api_key"],
  [/\bpassword\s*[:=]\s*\S+/i, "password_value"],
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, "credit_card"],
];

/** Patterns that trigger "personal" sensitivity tier. */
export const PERSONAL_PATTERNS: [RegExp, string][] = [
  [/\b\d+\s*mg\b(?!\s*\/\s*(dL|kg|L|ml))/i, "medication_dosage"],
  [/\b(pregabalin|metoprolol|losartan|lisinopril|aspirin|atorvastatin|sertraline|metformin|gabapentin|prednisone|insulin|warfarin)\b/i, "drug_name"],
  [/\b(glucose|a1c|cholesterol|blood pressure|bp|hrv|bmi)\b.*\b\d+/i, "health_measurement"],
  [/\b(diagnosed|diagnosis|prediabetic|diabetic|arrhythmia|ablation)\b/i, "medical_condition"],
  [/\b(salary|income|net worth|401k|ira|portfolio)\b.*\b\$?\d/i, "financial_detail"],
  [/\b\$\d{3,}[,\d]*\b/i, "financial_amount"],
];

// ── Type definitions ────────────────────────────────────────────────────────

export type ThoughtMetadata = {
  type: string;
  summary: string;
  topics: string[];
  tags: string[];
  people: string[];
  action_items: string[];
  importance: number | null;
  confidence: number;
};

export type SensitivityResult = {
  tier: "standard" | "personal" | "restricted";
  reasons: string[];
};

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

export type PrepareThoughtOpts = {
  source?: string;
  source_type?: string;
  metadata?: Record<string, unknown>;
  skip_embedding?: boolean;
  embedding?: number[];
  skip_classification?: boolean;
};

export type StructuredCapture = {
  matched: boolean;
  normalizedText: string;
  typeHint: string | null;
  topicHint: string | null;
  nextStep: string | null;
};
