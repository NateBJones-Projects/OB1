/**
 * sensitivity.mjs — Local pattern-based sensitivity detection.
 *
 * Two tiers: restricted (highest) and personal. Anything else is standard.
 * Patterns run on plain text — no network calls. This is deliberately simple
 * and conservative: it tags content; the ingest pipeline decides the routing
 * policy (what to send to Supabase, what to keep off-cloud, what to redact).
 *
 * Tiers:
 *   - restricted: structured secrets (SSN, passport, bank, API keys, passwords,
 *     credit cards). Default policy: store in a restricted-only store, never
 *     in a general-query pool.
 *   - personal: personally identifiable info (email addresses, phone numbers,
 *     health signals, financial signals). Default policy: allow but tag.
 *   - standard: everything else.
 *
 * OB1 users: the default OB1 deployment is cloud-first (remote Edge Functions
 * + Supabase), so "restricted-stays-local" requires either a two-store setup
 * (one Supabase project for standard+personal, one local or access-controlled
 * store for restricted) or a policy that simply refuses to import restricted
 * content. See README § "Sensitivity routing" for how to wire this up.
 *
 * To tune patterns for your own data, fork this file — the two arrays below
 * are the only things that matter.
 */

const RESTRICTED_PATTERNS = [
  { reason: "ssn_pattern", regex: /\b\d{3}-?\d{2}-?\d{4}\b/i },
  { reason: "passport_pattern", regex: /\b[A-Z]{1,2}\d{6,9}\b/ },
  { reason: "bank_account", regex: /\b(?:account|routing|iban)\b.*\b\d{8,17}\b/i },
  { reason: "api_key_pattern", regex: /\b(?:sk|pk|rk|or|xai|ghp|gho|sk_live_)-[A-Za-z0-9_\-]{16,}\b/i },
  { reason: "password_value", regex: /\bpassword\s*[:=]\s*\S+/i },
  { reason: "credit_card", regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/ },
];

const PERSONAL_PATTERNS = [
  { reason: "email", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { reason: "phone", regex: /\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/ },
  { reason: "health_signal", regex: /\b(?:diagnosis|medical|medication|therapy|hospital|condition|glucose|a1c|blood pressure)\b/i },
  { reason: "financial_signal", regex: /\b(?:tax return|income|salary|debt|credit score|portfolio|net worth)\b/i },
];

/**
 * Classify a text blob as 'restricted', 'personal', or 'standard'.
 * Restricted wins over personal. Returns matched pattern reasons so callers
 * can log or surface what triggered the classification.
 */
export function detectSensitivity(text) {
  const payload = text || "";
  const restrictedReasons = [];
  for (const c of RESTRICTED_PATTERNS) {
    if (c.regex.test(payload)) restrictedReasons.push(c.reason);
  }
  if (restrictedReasons.length > 0) return { tier: "restricted", reasons: restrictedReasons };
  const personalReasons = [];
  for (const c of PERSONAL_PATTERNS) {
    if (c.regex.test(payload)) personalReasons.push(c.reason);
  }
  if (personalReasons.length > 0) return { tier: "personal", reasons: personalReasons };
  return { tier: "standard", reasons: [] };
}

/**
 * Numeric rank for comparisons / storage. Higher = more sensitive.
 */
export function tierRank(tier) {
  return { standard: 0, personal: 1, restricted: 2 }[tier] ?? 0;
}
