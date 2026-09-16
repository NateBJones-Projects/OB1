/**
 * entity-resolver.mjs — RFC 2822 address parsing for email correspondents.
 *
 * Scope for this recipe: parsing only. Promoting correspondents to a Supabase
 * entities table is handled by downstream import pipelines (see README §
 * "Email correspondents as first-class entities" and the accompanying
 * migration at ../supabase/migrations/).
 *
 * One email address = one canonical_email. Multi-address identity resolution
 * (alice@personal vs alice@work) is intentionally out of scope — leave that to
 * a dedicated entity-resolution pass.
 */

const EMAIL_RE = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

/**
 * Split a header value on commas, respecting quoted strings and <> brackets.
 * Handles the common forms:
 *   "Alice Example" <alice@example.com>
 *   Alice Example <alice@example.com>
 *   alice@example.com
 *   Alice <alice@example.com>, Bob <bob@example.com>   (comma list)
 *   "Doe, Alice" <alice@example.com>                   (quoted comma)
 */
function splitAddressList(raw) {
  if (!raw || typeof raw !== "string") return [];
  const parts = [];
  let buf = "";
  let inQuote = false;
  let inAngle = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"' && raw[i - 1] !== "\\") inQuote = !inQuote;
    else if (c === "<" && !inQuote) inAngle = true;
    else if (c === ">" && !inQuote) inAngle = false;
    if (c === "," && !inQuote && !inAngle) {
      if (buf.trim()) parts.push(buf.trim());
      buf = "";
    } else {
      buf += c;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

/**
 * Parse a single address into {displayName, email}. Returns null when no
 * plausible email could be extracted (group syntax, garbage).
 */
export function parseAddress(part) {
  if (!part) return null;
  const s = part.trim();
  if (!s || s.endsWith(":;")) return null; // group syntax like "recipients:;"

  const angleMatch = s.match(/^(.*?)<([^>]+)>\s*$/);
  let displayName = "";
  let email = "";
  if (angleMatch) {
    displayName = angleMatch[1].trim().replace(/^["']|["']$/g, "").trim();
    email = angleMatch[2].trim();
  } else {
    email = s;
  }

  if (!EMAIL_RE.test(email)) return null;
  return { displayName: displayName || "", email };
}

/**
 * Parse a full header value into an array of {displayName, email}.
 */
export function parseRfc2822Address(raw) {
  return splitAddressList(raw)
    .map(parseAddress)
    .filter(Boolean);
}

/**
 * Canonical-form email for entity lookup.
 *
 * Preserves +tag addressing (alice+news@x.com stays distinct from
 * alice@x.com) because we don't want to collapse intentional aliases at
 * ingest time. A future resolver pass can decide when same-local-part-
 * different-tag should merge.
 */
export function normalizeEmail(email) {
  if (!email || typeof email !== "string") return null;
  return email.trim().toLowerCase();
}
