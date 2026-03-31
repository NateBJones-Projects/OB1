/**
 * Structured Capture Parser
 *
 * Parses a bracketed input format that lets users supply type and topic hints
 * inline with their thought content.
 *
 * Format: [type] [topic] thought content + optional next step
 *
 * Examples:
 *   "[decision] [architecture] Use PostgreSQL for analytics + Evaluate pgvector by Friday"
 *   "[lesson] [devops] Never run migrations during peak traffic"
 *   "Plain text without brackets (passes through unchanged)"
 *
 * This is a pure function with no external dependencies.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type StructuredCapture = {
  /** Whether the input matched the bracketed format. */
  matched: boolean;
  /** The thought content with structured hints removed. */
  normalizedText: string;
  /** Recognized thought type (null if unrecognized or not provided). */
  typeHint: string | null;
  /** Topic extracted from the second bracket pair. */
  topicHint: string | null;
  /** Action item extracted from the `+ suffix` portion. */
  nextStep: string | null;
};

// ── Constants ────────────────────────────────────────────────────────────────

/** The 8 canonical Open Brain thought types. */
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

/** Aliases that map shorthand or alternative names to canonical types. */
const TYPE_ALIASES: Record<string, string> = {
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

// ── Implementation ───────────────────────────────────────────────────────────

/**
 * Normalize a raw type hint string into a canonical thought type.
 * Returns null for unrecognized values.
 */
export function normalizeTypeHint(value: string): string | null {
  const key = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (!key) return null;
  return TYPE_ALIASES[key] ?? null;
}

/**
 * Parse structured capture format from user input.
 *
 * Accepts:  `[type] [topic] body text + next step`
 * Returns:  Parsed components or a passthrough result for plain text.
 */
export function parseStructuredCapture(content: string): StructuredCapture {
  const trimmed = content.trim();

  // Pattern: [type] [topic] body + optional next-step
  const match = /^\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.+?)(?:\s*\+\s*(.+))?$/i.exec(
    trimmed
  );

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
