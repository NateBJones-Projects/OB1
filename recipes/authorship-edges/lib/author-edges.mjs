/**
 * author-edges.mjs — link self-spoken thoughts to a canonical self-entity via
 * `thought_entities` author edges, and (optionally) stamp attribution metadata.
 *
 * This is the DB side of the authorship layer. It consumes the entity-extraction
 * schema's `entities` and `thought_entities` tables (additive — it creates no
 * tables and changes no columns) and treats `thought_id` as an opaque value, so
 * it works whether your `thoughts.id` is UUID or BIGINT.
 *
 * Nothing here hardcodes an entity id: the self-entity is resolved from config
 * (an id you pass, or a display name the recipe upserts once). PostgREST-only
 * client, matching the atomizer recipe — no @supabase/supabase-js dependency.
 */
import fs from "node:fs";
import { classifySpeakers } from "./speaker-attribution.mjs";

const enc = encodeURIComponent;

// ── env + PostgREST client (mirrors recipes/atomizer/lib/entity-resolver.mjs) ──

export function loadEnv(envPath = ".env.local") {
  const env = { ...process.env };
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

export function makeSbClient({ projectRef, serviceRoleKey, supabaseUrl }) {
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
      // Don't leak query-string filter values into logs by default.
      const tableOnly = String(relPath).split("?")[0];
      const debug = process.env.AUTHORSHIP_DEBUG === "1";
      throw new Error(`${method} ${debug ? relPath : tableOnly}: ${res.status} ${text.slice(0, 300)}`);
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

// ── self entity resolution (config-driven, never hardcoded) ────────────────────

/**
 * Resolve the brain owner's `entities.id`. Prefers an explicit id; otherwise
 * upserts a `person` entity by display name (idempotent on the schema's
 * UNIQUE(entity_type, normalized_name)) and tags it `metadata.is_self`.
 *
 * @returns {Promise<number>} the self entity id
 */
export async function getSelfEntityId(sb, { id, name } = {}) {
  // Pass a configured id through OPAQUE — entities.id is BIGSERIAL and can
  // exceed 2^53, so never Number() it (that would silently round a large id).
  if (id !== undefined && id !== null && String(id) !== "") return String(id).trim();
  const display = String(name || "").trim();
  if (!display) {
    throw new Error("getSelfEntityId: provide { id } or { name } (e.g. OB_SELF_ENTITY_ID or OB_SELF_ENTITY_NAME)");
  }
  const normalized = display.toLowerCase();
  const existing = await sb.get(
    `entities?entity_type=eq.person&normalized_name=eq.${enc(normalized)}&select=id,metadata&limit=1`,
  );
  if (existing && existing.length > 0) {
    const row = existing[0];
    if (row.metadata && row.metadata.is_self === true) return String(row.id);
    // A same-named person already exists but is NOT marked as you (e.g. one the
    // entity worker extracted from a transcript). Refuse rather than silently
    // attribute your speech to a stranger — pin the correct id explicitly.
    throw new Error(
      `getSelfEntityId: a person entity named "${display}" exists (id ${row.id}) but is not marked is_self. `
      + "Set OB_SELF_ENTITY_ID to your entity id, or set that row's metadata.is_self=true if it really is you.",
    );
  }
  try {
    const inserted = await sb.post(
      "entities?select=id",
      {
        entity_type: "person",
        canonical_name: display,
        normalized_name: normalized,
        aliases: [],
        metadata: { is_self: true, discovered_via: "authorship-edges" },
      },
      { Prefer: "return=representation" },
    );
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return String(row.id);
  } catch (err) {
    if (!/duplicate key|23505/.test(err.message)) throw err;
    // Lost an insert race — re-select and apply the same is_self guard.
    const again = await sb.get(
      `entities?entity_type=eq.person&normalized_name=eq.${enc(normalized)}&select=id,metadata&limit=1`,
    );
    if (again && again.length > 0) {
      const row = again[0];
      if (row.metadata && row.metadata.is_self === true) return String(row.id);
      throw new Error(`getSelfEntityId: race resolved to a non-self entity named "${display}"; set OB_SELF_ENTITY_ID.`);
    }
    throw new Error(`getSelfEntityId: 23505 but no row for "${display}"`);
  }
}

// ── thought_entities edge ──────────────────────────────────────────────────────

/**
 * Idempotently link a thought to an entity with a mention role. Mirrors the
 * atomizer's edge writer; `thoughtId` is passed through opaque (UUID or BIGINT).
 */
export async function linkThoughtToEntity(
  sb,
  { thoughtId, entityId, mentionRole, source = "authorship-edges", evidence = {} },
) {
  if (thoughtId === undefined || entityId === undefined || !mentionRole) {
    throw new Error("linkThoughtToEntity: thoughtId, entityId, mentionRole all required");
  }
  // `resolution=ignore-duplicates` makes a re-link a server-side no-op on the
  // UNIQUE(thought_id, entity_id, mention_role) constraint — so there is no
  // error text to pattern-match, and genuine failures (e.g. a missing
  // thought_id foreign key) still throw instead of being swallowed.
  await sb.post(
    "thought_entities",
    { thought_id: thoughtId, entity_id: entityId, mention_role: mentionRole, source, evidence },
    { Prefer: "resolution=ignore-duplicates" },
  );
}

// ── high-level: attribute one thought ──────────────────────────────────────────

/**
 * Classify a thought's speakers and, when the owner is present, link an author
 * edge to the self entity.
 *
 * This does NOT write `thoughts.metadata` — your capture path should set
 * `metadata.attribution` (and `metadata.attributed_to`) in the row it inserts,
 * where it's a single atomic write with no read-modify-write race. Use the
 * returned classification to do exactly that. This helper owns only the edge.
 *
 * @param {object} sb         PostgREST client
 * @param {object} args
 * @param {string|number} args.thoughtId      passed through opaque (UUID or BIGINT)
 * @param {string[]} args.speakers            speaker labels on this thought
 * @param {string|number} args.selfEntityId   from getSelfEntityId()
 * @param {Set|string|string[]} [args.selfLabels]
 * @param {boolean}  [args.hasUtterances=true]
 * @param {string}   [args.source="authorship-edges"]
 * @param {object}   [args.evidence={}]
 * @param {boolean}  [args.dryRun=false]
 * @returns {Promise<{attribution, selfPresent, role, linked:boolean}>}
 *          `linked` = an author edge was ensured (owner present + selfEntityId given).
 */
export async function attributeThought(sb, args) {
  const {
    thoughtId,
    speakers = [],
    selfEntityId,
    selfLabels,
    hasUtterances = true,
    source = "authorship-edges",
    evidence = {},
    dryRun = false,
  } = args;

  const cls = classifySpeakers(speakers, { selfLabels, hasUtterances });
  let linked = false;

  if (cls.selfPresent && selfEntityId) {
    if (!dryRun) {
      await linkThoughtToEntity(sb, {
        thoughtId,
        entityId: selfEntityId,
        mentionRole: cls.role || "participant",
        source,
        evidence,
      });
    }
    linked = true;
  }

  return { ...cls, linked };
}
