/**
 * entity-resolver.mjs — Promote message-header correspondents (Gmail From /
 * To / Cc) to first-class `public.entities` rows linked to a thought via
 * `thought_entities` edges.
 *
 * Scope: raw ingest only. One email address = one entity row. Multi-address
 * identity resolution (person@personal vs person@work) is deliberately out
 * of scope; this builds the substrate a future resolver can act on.
 *
 * Assumes an Enhanced-Thoughts-style schema is in place: `public.entities`
 * (with canonical_email, normalized_name, aliases jsonb, metadata jsonb) and
 * `public.thought_entities` (with thought_id, entity_id, mention_role,
 * source, evidence jsonb). See this recipe's README for the minimum DDL.
 *
 * PostgREST-only client — no @supabase/supabase-js dependency.
 */

import fs from "node:fs";

// ── RFC 2822 address parsing ────────────────────────────────────────────────
//
// Handles the forms seen in real Gmail headers:
//   "First Last" <user@example.com>
//   First Last <user@example.com>
//   user@example.com
//   Name <one@x.com>, Other <two@x.com>              (comma list)
//   "Last, First" <user@example.com>                 (quoted comma)
//   undisclosed-recipients:;                          (group syntax — ignored)

const EMAIL_RE = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

/**
 * Split a header value on commas, respecting quoted strings and <> brackets.
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
 * Parse a single address into {displayName, email}. Returns null if no
 * plausible email could be extracted (e.g., group syntax, garbage).
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
 * Preserves +tag addressing (user+news@x.com stays distinct from user@x.com)
 * because we don't want to collapse intentional aliases at ingest time. A
 * future resolver pass can decide when same-local-part-different-tag should
 * merge.
 */
export function normalizeEmail(email) {
  if (!email || typeof email !== "string") return null;
  return email.trim().toLowerCase();
}

// ── Entity upsert ───────────────────────────────────────────────────────────

function bestCanonicalName(existingName, candidateDisplay, email) {
  // Never downgrade. Only replace a bare-email placeholder.
  const looksLikeBareEmail = (n) => !n || n === email || EMAIL_RE.test(n);
  if (candidateDisplay && looksLikeBareEmail(existingName)) return candidateDisplay;
  return existingName;
}

/**
 * Upsert a person entity keyed by canonical_email. Returns {id, created}.
 *
 * Race-safe: on duplicate-key we re-SELECT. Concurrent inserts converge.
 */
export async function upsertPersonByEmail(sb, { canonicalEmail, displayName }) {
  if (!canonicalEmail) throw new Error("canonicalEmail required");
  const email = canonicalEmail;
  const nameCandidate = (displayName || "").trim();
  const seedName = nameCandidate || email.split("@")[0];
  const normalizedName = seedName.toLowerCase();

  // Fast path: look up first. Most emails recur.
  const existing = await sb.get(
    `entities?canonical_email=eq.${encodeURIComponent(email)}&select=id,canonical_name,aliases&limit=1`,
  );
  if (existing && existing.length > 0) {
    const row = existing[0];
    const upgraded = bestCanonicalName(row.canonical_name, nameCandidate, email);
    if (upgraded !== row.canonical_name) {
      // Push the old name into aliases if meaningfully different, then upgrade.
      const aliases = Array.isArray(row.aliases) ? [...row.aliases] : [];
      if (row.canonical_name && row.canonical_name !== upgraded) {
        const exists = aliases.some(
          (a) => (a && typeof a === "object" && a.name === row.canonical_name) || a === row.canonical_name,
        );
        if (!exists) aliases.push({ name: row.canonical_name });
      }
      try {
        await sb.patch(`entities?id=eq.${row.id}`, {
          canonical_name: upgraded,
          normalized_name: upgraded.toLowerCase(),
          aliases,
          last_seen_at: new Date().toISOString(),
        });
      } catch (err) {
        // Upgrade collides with another entity sharing the target normalized_name.
        // Keep the current name (still correct, just less rich) and move on.
        if (!/duplicate key|23505/.test(err.message)) throw err;
      }
    }
    return { id: row.id, created: false };
  }

  // Insert. Three failure modes to handle on 23505:
  //   (a) concurrent writer already inserted with same canonical_email  → re-SELECT by email
  //   (b) an existing entity shares (entity_type, normalized_name) but
  //       has null canonical_email (classic case: LLM extracted the name
  //       from email bodies long before we ever parsed the header) →
  //       "adopt the orphan": attach canonical_email to the existing row.
  //   (c) an existing entity with same normalized_name has a DIFFERENT
  //       canonical_email → genuinely different person who happens to
  //       share a display name. Leave the orphan alone, store this one
  //       under a disambiguated name.
  try {
    const inserted = await sb.post(
      "entities?select=id",
      {
        entity_type: "person",
        canonical_name: seedName,
        normalized_name: normalizedName,
        canonical_email: email,
        aliases: [],
        metadata: { discovered_via: "email_header" },
      },
      { Prefer: "return=representation" },
    );
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return { id: row.id, created: true };
  } catch (err) {
    if (!/duplicate key|23505/.test(err.message)) throw err;

    // (a) someone already won the email race
    const byEmail = await sb.get(
      `entities?canonical_email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
    );
    if (byEmail && byEmail.length > 0) {
      return { id: byEmail[0].id, created: false };
    }

    // (b)/(c) collision on (entity_type, normalized_name)
    const byName = await sb.get(
      `entities?entity_type=eq.person`
      + `&normalized_name=eq.${encodeURIComponent(normalizedName)}`
      + `&select=id,canonical_email,aliases&limit=1`,
    );
    if (byName && byName.length > 0) {
      const orphan = byName[0];
      if (!orphan.canonical_email) {
        // (b) adopt: attach this email to the pre-existing name-only entity.
        //
        // Conditional PATCH — scope the WHERE to rows that still have a NULL
        // canonical_email, so a concurrent worker that already adopted this
        // orphan can't be silently overwritten. If the PATCH hits zero rows
        // (Prefer: count=exact returns Content-Range …/0), re-SELECT by email
        // — the race winner already set canonical_email to something.
        const aliases = Array.isArray(orphan.aliases) ? [...orphan.aliases] : [];
        try {
          await sb.patch(
            `entities?id=eq.${orphan.id}&canonical_email=is.null`,
            { canonical_email: email, aliases, last_seen_at: new Date().toISOString() },
          );
        } catch (patchErr) {
          // Zero rows affected looks like either a 204 (fine) or a 23505 if
          // the winner's canonical_email collides with ours. Re-SELECT by
          // email and trust the winner's row.
          const winner = await sb.get(
            `entities?canonical_email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
          );
          if (winner && winner.length > 0) return { id: winner[0].id, created: false };
          throw patchErr;
        }
        // Verify the adoption took. If a concurrent worker adopted between
        // our SELECT and PATCH, the row now has a canonical_email different
        // from ours; re-select by email to point at the winner.
        const check = await sb.get(
          `entities?id=eq.${orphan.id}&select=canonical_email&limit=1`,
        );
        if (check && check[0] && check[0].canonical_email !== email) {
          const winner = await sb.get(
            `entities?canonical_email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
          );
          if (winner && winner.length > 0) return { id: winner[0].id, created: false };
        }
        return { id: orphan.id, created: false };
      }
      // (c) same display name, different person. Retry insert with a
      // disambiguated normalized_name keyed on the email local-part.
      const localPart = email.split("@")[0];
      const disambig = `${normalizedName} (${localPart})`;
      const retry = await sb.post(
        "entities?select=id",
        {
          entity_type: "person",
          canonical_name: seedName,
          normalized_name: disambig,
          canonical_email: email,
          aliases: [],
          metadata: { discovered_via: "email_header", disambiguated_from: normalizedName },
        },
        { Prefer: "return=representation" },
      );
      const row = Array.isArray(retry) ? retry[0] : retry;
      return { id: row.id, created: true };
    }

    // Fallback error without the email address — including it here leaks PII
    // into logs that get shared/pasted. Domain-only identification is enough
    // to diagnose which upstream (gmail vs mailing list) caused the dup.
    const domain = typeof email === "string" ? email.split("@")[1] || "unknown" : "unknown";
    throw new Error(`upsertPersonByEmail: 23505 but no match by email or name (domain=${domain})`);
  }
}

// ── thought_entities edge ───────────────────────────────────────────────────

export async function linkThoughtToEntity(
  sb,
  { thoughtId, entityId, mentionRole, source = "gmail_header", evidence = {} },
) {
  if (!thoughtId || !entityId || !mentionRole) {
    throw new Error("linkThoughtToEntity: thoughtId, entityId, mentionRole all required");
  }
  try {
    await sb.post(
      "thought_entities",
      {
        thought_id: thoughtId,
        entity_id: entityId,
        mention_role: mentionRole,
        source,
        evidence,
      },
      { Prefer: "resolution=ignore-duplicates" },
    );
  } catch (err) {
    if (/duplicate key|23505/.test(err.message)) return; // idempotent
    throw err;
  }
}

// ── High-level orchestrator ─────────────────────────────────────────────────

/**
 * Walk the From/To/Cc lines of one email-sourced thought and ensure entities
 * + edges exist. `selfEmails` is a Set of normalized addresses belonging to
 * the user — they are skipped (the "me" side of every conversation is already
 * implicit).
 *
 * Returns a summary for the batch logger.
 */
export async function resolveCorrespondents(
  sb,
  { thoughtId, from, to, cc, selfEmails = new Set() },
) {
  const stats = { authors: 0, recipients: 0, ccs: 0, skippedSelf: 0, newEntities: 0, errors: 0 };

  const lines = [
    { raw: from, role: "author", key: "authors" },
    { raw: to, role: "recipient", key: "recipients" },
    { raw: cc, role: "cc", key: "ccs" },
  ];

  for (const { raw, role, key } of lines) {
    if (!raw) continue;
    const parsed = parseRfc2822Address(raw);
    for (const { displayName, email } of parsed) {
      const canonicalEmail = normalizeEmail(email);
      if (!canonicalEmail) continue;
      if (selfEmails.has(canonicalEmail)) { stats.skippedSelf++; continue; }

      try {
        const { id: entityId, created } = await upsertPersonByEmail(sb, {
          canonicalEmail,
          displayName,
        });
        if (created) stats.newEntities++;
        await linkThoughtToEntity(sb, {
          thoughtId,
          entityId,
          mentionRole: role,
          source: "gmail_header",
          evidence: { header_field: role === "author" ? "from" : role, raw: String(raw).slice(0, 500) },
        });
        stats[key]++;
      } catch (err) {
        stats.errors++;
        // Log only the email domain by default, not the full address — the
        // goal is to diagnose pipeline failures, not to leave a PII trail in
        // shared/pasted run logs. Set ENTITY_RESOLVER_DEBUG=1 for full emails.
        const logId = process.env.ENTITY_RESOLVER_DEBUG === "1"
          ? canonicalEmail
          : `@${(canonicalEmail || "").split("@")[1] || "unknown"}`;
        console.warn(`[entity-resolver] #${thoughtId} ${role} ${logId} failed: ${err.message}`);
      }
    }
  }

  return stats;
}

// ── Shared PostgREST client factory ─────────────────────────────────────────
//
// Exposes get/post/patch/delete over the Supabase PostgREST endpoint. All
// scripts in this recipe share one consistent client.

export function makeSbClient({ projectRef, serviceRoleKey, supabaseUrl }) {
  // Accept either a raw project ref (e.g. "abcd1234") or a full URL.
  const base = supabaseUrl
    ? `${supabaseUrl.replace(/\/+$/, "")}/rest/v1`
    : `https://${projectRef}.supabase.co/rest/v1`;
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  async function call(method, relPath, body, extraHeaders = {}) {
    const res = await fetch(`${base}/${relPath}`, {
      method,
      headers: { ...headers, ...extraHeaders },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text();
      // Don't leak query-string filter values (emails, thread_ids, etc.)
      // into error logs by default. Keep the table and the status; the
      // response body from PostgREST typically does not echo the query.
      const tableOnly = String(relPath).split("?")[0];
      const debug = process.env.ENTITY_RESOLVER_DEBUG === "1";
      throw new Error(
        `${method} ${debug ? relPath : tableOnly}: ${res.status} ${text.slice(0, 300)}`,
      );
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("json") ? res.json() : null;
  }
  return {
    get: (p) => call("GET", p),
    post: (p, body, extra) => call("POST", p, body, extra),
    patch: (p, body, extra) => call("PATCH", p, body, extra),
    delete: (p, extra) => call("DELETE", p, undefined, extra),
  };
}

/**
 * Load .env.local into a plain object, merged with process.env.
 * Callers can pass the result straight into makeSbClient.
 *
 * Constraints (deliberate, to keep this dependency-free):
 *   - Keys must be UPPER_SNAKE_CASE (A-Z / 0-9 / _). lowercase keys are silently ignored.
 *   - Values must be single-line. Multiline values are NOT supported.
 *   - process.env takes precedence — anything already in the ambient env wins.
 *
 * Callers should pass an absolute path. Script-relative resolution (via
 * `import.meta.url` → `fileURLToPath`) is recommended so the loader works
 * regardless of the user's current working directory.
 */
export function loadEnv(envPath = ".env.local") {
  const env = { ...process.env };
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
