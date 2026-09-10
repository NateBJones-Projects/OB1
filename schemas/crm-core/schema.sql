-- ============================================================================
-- CRM core — editable contacts + field-proposal truth layer
-- ============================================================================
--
-- A first-class, editable contact book that sits on top of your Open Brain,
-- with a human-in-the-loop truth model baked into the schema itself.
--
-- The headline is the truth layer. There are two kinds of writer:
--
--   * A HUMAN (a person editing in a UI or via a trusted manual tool) writes
--     directly to the canonical contact fields. Their edits win.
--   * A MACHINE / AGENT (an import, an extraction pass, a projection job) does
--     NOT get to overwrite a human-set field. Instead its write is parked as a
--     PROPOSAL in crm_field_proposals. A human later resolves that proposal —
--     accept applies it to the canonical field (and logs it); reject discards it
--     (and logs it). This is the same trust model as the wiki regen guard:
--     machine writes propose, a human accepts.
--
-- This means the canonical contact record only ever changes when a human edits
-- it directly, or when a human explicitly accepts a machine proposal. A pending
-- proposal never mutates the live field.
--
-- ── Scope of this schema ────────────────────────────────────────────────────
--   crm_contacts             — the editable contact record (scalar fields +
--                              per-field provenance).
--   crm_contact_methods      — emails / phones / urls / addresses, with a
--                              current/superseded/rejected status lifecycle.
--   crm_contact_aliases      — alternate names for duplicate-safe future merges.
--   crm_contact_change_log   — an append-only audit trail. Contact-method VALUES
--                              are redacted here ('[redacted]') so the audit log
--                              never stores raw email/phone strings.
--   crm_field_proposals      — the inbox: where machine writers PROPOSE.
--   crm_field_evidence       — links a field / method / proposal to the thoughts
--                              that support or contradict it (UUID thought ids).
--
--   RPCs:
--     crm_create_contact         — create a contact (human / manual entry).
--     crm_get_contact            — read a contact + its methods + aliases.
--     crm_patch_contact_record   — PATCH scalar fields with auto-protection:
--                                  a machine origin writing over a human-set
--                                  field is diverted to crm_propose_field.
--     crm_set_field_lock         — explicitly lock/unlock one field.
--     crm_add_contact_method     — add / update a contact method.
--     crm_propose_field          — the single chokepoint for machine writers.
--     crm_resolve_field_proposal — accept / reject one proposal.
--     crm_add_field_evidence     — attach a supporting/contradicting thought.
--     crm_contact_field_evidence — read the evidence for a contact / field.
--
-- ── ID contract ─────────────────────────────────────────────────────────────
--   Every primary key is UUID (gen_random_uuid()). Every reference to a memory
--   row is `UUID REFERENCES public.thoughts(id)` — never bigint, never a
--   `brain_thoughts` table, never an INSTEAD OF view trigger. crm_field_evidence
--   joins public.thoughts on a UUID thought id; evidence_thought_ids is UUID[].
--
-- ── Security model ──────────────────────────────────────────────────────────
--   RLS is enabled on every table. Each table additionally REVOKEs ALL from
--   PUBLIC, anon, and authenticated, then grants only what service_role needs,
--   so a project that blanket-grants new tables to its API roles cannot leave
--   contact data exposed. Every function is SECURITY INVOKER with a fixed
--   search_path and is granted to service_role only — contact data is reached
--   through the service role, never anon.
--
-- ── Idempotent + additive ───────────────────────────────────────────────────
--   CREATE TABLE / INDEX IF NOT EXISTS and CREATE OR REPLACE FUNCTION
--   throughout. Nothing on public.thoughts is altered or dropped. No
--   destructive table operations and no row removals: methods are soft-deleted
--   via a deleted_at timestamp, never hard-removed. Safe to re-run.
-- ============================================================================

-- gen_random_uuid() lives in pgcrypto on older Postgres; harmless if present.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── crm_contacts — the editable contact record ─────────────────────────────
-- The canonical, human-owned record. field_provenance records, per editable
-- scalar field, who last set it and how: {origin, actor, run_id, at, locked}.
-- origin='manual' implicitly protects a field from machine overwrites;
-- locked=true additionally blocks bulk manual overwrites until unlocked.

CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind         TEXT        NOT NULL DEFAULT 'manual',
  display_name        TEXT        NOT NULL,
  canonical_name      TEXT,
  canonical_email     TEXT,
  preferred_name      TEXT,
  given_name          TEXT,
  family_name         TEXT,
  pronouns            TEXT,
  job_title           TEXT,
  organization_name   TEXT,
  location            TEXT,
  relationship_note   TEXT,
  lifecycle_status    TEXT        NOT NULL DEFAULT 'active'
                        CHECK (lifecycle_status IN ('active', 'archived')),
  privacy_tier        TEXT        NOT NULL DEFAULT 'standard'
                        CHECK (privacy_tier IN ('standard', 'sensitive', 'restricted')),
  owner_label         TEXT        NOT NULL DEFAULT 'personal',
  source_metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  editable_metadata   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  field_provenance    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_by          TEXT        NOT NULL DEFAULT 'system',
  updated_by          TEXT        NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_display_name
  ON public.crm_contacts (display_name);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_privacy_tier
  ON public.crm_contacts (privacy_tier);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_lifecycle
  ON public.crm_contacts (lifecycle_status);

COMMENT ON TABLE public.crm_contacts IS
  'Editable CRM contact records. The canonical, human-owned record; machine writers must go through crm_propose_field, never write here directly.';
COMMENT ON COLUMN public.crm_contacts.relationship_note IS
  'Free-text note about the relationship. This is NOT a relationship tier; the tier system is a separate schema (crm-person-tiers).';
COMMENT ON COLUMN public.crm_contacts.field_provenance IS
  'Per editable field: {origin: manual|import|extraction|projection|generated, actor, run_id, at, locked}. Manual origin out-ranks machine writers (auto-protection); locked additionally blocks manual bulk overwrites.';

-- ─── crm_contact_methods — emails / phones / urls / addresses ───────────────
-- status lifecycle: 'current' is the live truth; 'superseded'/'rejected' rows
-- stay as queryable history. The dedupe unique index applies to CURRENT rows
-- only, so a superseded value never blocks a fresh current one.

CREATE TABLE IF NOT EXISTS public.crm_contact_methods (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        UUID        NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  method_type       TEXT        NOT NULL
                      CHECK (method_type IN ('email', 'phone', 'url', 'social', 'address', 'other')),
  value             TEXT        NOT NULL,
  label             TEXT,
  is_primary        BOOLEAN     NOT NULL DEFAULT false,
  source            TEXT        NOT NULL DEFAULT 'manual',
  confidence        NUMERIC(4,3) NOT NULL DEFAULT 1.0
                      CHECK (confidence >= 0 AND confidence <= 1),
  status            TEXT        NOT NULL DEFAULT 'current'
                      CHECK (status IN ('current', 'superseded', 'rejected')),
  superseded_by     UUID        REFERENCES public.crm_contact_methods(id) ON DELETE SET NULL,
  source_run_id     TEXT,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_by        TEXT        NOT NULL DEFAULT 'system',
  updated_by        TEXT        NOT NULL DEFAULT 'system',
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crm_contact_methods_contact
  ON public.crm_contact_methods (contact_id, deleted_at);

-- Dedupe current, non-deleted methods only.
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_contact_methods_dedupe
  ON public.crm_contact_methods (contact_id, method_type, lower(value))
  WHERE deleted_at IS NULL AND status = 'current';

CREATE INDEX IF NOT EXISTS idx_crm_contact_methods_run
  ON public.crm_contact_methods (source_run_id)
  WHERE source_run_id IS NOT NULL;

COMMENT ON TABLE public.crm_contact_methods IS
  'Editable contact methods (email/phone/url/social/address). Values are contact data; they are redacted in the change log.';

-- ─── crm_contact_aliases — alternate names ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.crm_contact_aliases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID        NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  alias         TEXT        NOT NULL,
  source        TEXT        NOT NULL DEFAULT 'manual',
  confidence    NUMERIC(4,3) NOT NULL DEFAULT 1.0
                  CHECK (confidence >= 0 AND confidence <= 1),
  status        TEXT        NOT NULL DEFAULT 'current'
                  CHECK (status IN ('current', 'superseded', 'rejected')),
  superseded_by UUID        REFERENCES public.crm_contact_aliases(id) ON DELETE SET NULL,
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_by    TEXT        NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_crm_contact_aliases_contact
  ON public.crm_contact_aliases (contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_contact_aliases_dedupe
  ON public.crm_contact_aliases (contact_id, lower(alias))
  WHERE status = 'current';

COMMENT ON TABLE public.crm_contact_aliases IS
  'Alternate names for a contact, used for duplicate-safe future merge/link workflows.';

-- ─── crm_contact_change_log — append-only audit (values redacted) ───────────
-- Every contact / method / proposal mutation lands here. Contact-method VALUES
-- are written as '[redacted]' so the audit trail never stores raw email/phone
-- strings.

CREATE TABLE IF NOT EXISTS public.crm_contact_change_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID        REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  method_id     UUID        REFERENCES public.crm_contact_methods(id) ON DELETE SET NULL,
  alias_id      UUID        REFERENCES public.crm_contact_aliases(id) ON DELETE SET NULL,
  action        TEXT        NOT NULL,
  actor_label   TEXT        NOT NULL DEFAULT 'service',
  changed_fields JSONB      NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_crm_contact_change_log_contact
  ON public.crm_contact_change_log (contact_id, created_at DESC);

COMMENT ON TABLE public.crm_contact_change_log IS
  'Append-only CRM edit audit. Contact-method values are redacted ([redacted]) in changed_fields; raw email/phone strings are never stored here.';

-- ─── crm_field_proposals — the inbox where machine writers PROPOSE ──────────
-- proposal_key = sha256(contact_id|target_kind|field_key|normalized_value|origin)
-- and is UNCONDITIONALLY unique: a rejected proposal blocks an identical
-- re-proposal forever (the reimport-idempotency mechanism). Re-seeing the same
-- value only bumps seen_count / last_seen_at; status is never reset.

CREATE TABLE IF NOT EXISTS public.crm_field_proposals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          UUID        NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  target_kind         TEXT        NOT NULL
                        CHECK (target_kind IN ('contact_field', 'contact_method', 'alias')),
  field_key           TEXT        NOT NULL,
  proposed_value      TEXT,
  normalized_value    TEXT        NOT NULL,
  current_value       TEXT,
  origin              TEXT        NOT NULL
                        CHECK (origin IN ('import', 'extraction', 'projection', 'generated')),
  origin_ref          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  confidence          NUMERIC(4,3),
  proposal_key        TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'accepted', 'rejected', 'stale')),
  evidence_thought_ids UUID[]     NOT NULL DEFAULT ARRAY[]::UUID[],
  seen_count          INTEGER     NOT NULL DEFAULT 1,
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  decided_at          TIMESTAMPTZ,
  decided_by          TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_field_proposals_key
  ON public.crm_field_proposals (proposal_key);
CREATE INDEX IF NOT EXISTS idx_crm_field_proposals_contact_status
  ON public.crm_field_proposals (contact_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_field_proposals_run
  ON public.crm_field_proposals ((origin_ref->>'run_id'))
  WHERE origin_ref ? 'run_id';

COMMENT ON TABLE public.crm_field_proposals IS
  'Inbox for machine writers: imports / extraction / projection PROPOSE changes to user-controlled CRM truth instead of applying them. proposal_key uniqueness is unconditional so a rejected value can never be re-proposed.';

-- ─── crm_field_evidence — truth points to its receipts (UUID thought ids) ───

CREATE TABLE IF NOT EXISTS public.crm_field_evidence (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID        NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  target_kind   TEXT        NOT NULL
                  CHECK (target_kind IN ('contact_field', 'contact_method', 'alias', 'proposal')),
  target_id     UUID,
  field_key     TEXT        NOT NULL,
  thought_id    UUID        NOT NULL REFERENCES public.thoughts(id) ON DELETE CASCADE,
  role          TEXT        NOT NULL
                  CHECK (role IN ('supports', 'contradicts', 'source', 'correction')),
  note          TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_field_evidence_dedupe
  ON public.crm_field_evidence (
    contact_id,
    target_kind,
    COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid),
    field_key,
    thought_id,
    role
  );
CREATE INDEX IF NOT EXISTS idx_crm_field_evidence_thought
  ON public.crm_field_evidence (thought_id);

COMMENT ON TABLE public.crm_field_evidence IS
  'Links CRM truth (a field / method / proposal) to the thoughts (UUID) that support or contradict it.';

-- ============================================================================
-- Functions
-- ============================================================================

-- ─── crm_create_contact — human / manual entry point ────────────────────────
-- Creates a contact and stamps manual provenance on display_name so the truth
-- layer immediately protects it from machine overwrites. Returns the new id.

CREATE OR REPLACE FUNCTION public.crm_create_contact(
  p_display_name      TEXT,
  p_canonical_email   TEXT DEFAULT NULL,
  p_organization_name TEXT DEFAULT NULL,
  p_job_title         TEXT DEFAULT NULL,
  p_actor             TEXT DEFAULT 'service'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor TEXT := COALESCE(NULLIF(trim(p_actor), ''), 'service');
  v_name  TEXT := NULLIF(trim(COALESCE(p_display_name, '')), '');
  v_id    UUID;
  v_now   TIMESTAMPTZ := timezone('utc', now());
BEGIN
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'display_name is required';
  END IF;

  INSERT INTO public.crm_contacts (
    display_name, canonical_email, organization_name, job_title,
    field_provenance, created_by, updated_by
  )
  VALUES (
    v_name,
    NULLIF(trim(COALESCE(p_canonical_email, '')), ''),
    NULLIF(trim(COALESCE(p_organization_name, '')), ''),
    NULLIF(trim(COALESCE(p_job_title, '')), ''),
    jsonb_build_object('display_name', jsonb_build_object(
      'origin', 'manual', 'actor', v_actor, 'at', v_now, 'locked', false)),
    v_actor, v_actor
  )
  RETURNING id INTO v_id;

  INSERT INTO public.crm_contact_change_log (contact_id, action, actor_label, changed_fields)
  VALUES (v_id, 'contact.create', v_actor,
          jsonb_strip_nulls(jsonb_build_object(
            'display_name', v_name,
            'organization_name', p_organization_name,
            'job_title', p_job_title)));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_create_contact(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_create_contact(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ─── crm_get_contact — read a contact + methods + aliases ───────────────────

CREATE OR REPLACE FUNCTION public.crm_get_contact(
  p_contact_id UUID
) RETURNS TABLE (
  record  JSONB,
  methods JSONB,
  aliases JSONB
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH contact_record AS (
    SELECT c.*
    FROM public.crm_contacts c
    WHERE c.id = p_contact_id
    LIMIT 1
  )
  SELECT
    to_jsonb(c.*) AS record,
    COALESCE((
      SELECT jsonb_agg(to_jsonb(m.*) ORDER BY m.is_primary DESC, m.method_type ASC, m.value ASC)
      FROM public.crm_contact_methods m
      WHERE m.contact_id = c.id
        AND m.deleted_at IS NULL
        AND m.status = 'current'
    ), '[]'::jsonb) AS methods,
    COALESCE((
      SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.source ASC, a.alias ASC)
      FROM public.crm_contact_aliases a
      WHERE a.contact_id = c.id
        AND a.status = 'current'
    ), '[]'::jsonb) AS aliases
  FROM contact_record c;
$$;

REVOKE ALL ON FUNCTION public.crm_get_contact(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_get_contact(UUID) TO service_role;

-- ─── crm_propose_field — the single chokepoint for machine writers ──────────
-- Machine origins call this (directly or via crm_patch_contact_record's
-- auto-protection). It NEVER mutates a canonical field; it only records a
-- proposal. Returns {proposal_id, status, created}.

CREATE OR REPLACE FUNCTION public.crm_propose_field(
  p_contact_id          UUID,
  p_target_kind         TEXT,
  p_field_key           TEXT,
  p_proposed_value      TEXT,
  p_origin              TEXT,
  p_origin_ref          JSONB DEFAULT '{}'::jsonb,
  p_confidence          NUMERIC DEFAULT NULL,
  p_current_value       TEXT DEFAULT NULL,
  p_evidence_thought_ids UUID[] DEFAULT NULL,
  p_normalized_value    TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_field_key  TEXT := NULLIF(trim(COALESCE(p_field_key, '')), '');
  v_normalized TEXT := COALESCE(
    NULLIF(trim(COALESCE(p_normalized_value, '')), ''),
    lower(trim(COALESCE(p_proposed_value, '')))
  );
  v_key     TEXT;
  v_id      UUID;
  v_status  TEXT;
  v_created BOOLEAN := false;
BEGIN
  IF p_contact_id IS NULL THEN
    RAISE EXCEPTION 'contact_id is required';
  END IF;
  IF v_field_key IS NULL THEN
    RAISE EXCEPTION 'field_key is required';
  END IF;
  IF v_normalized = '' THEN
    RAISE EXCEPTION 'a proposal needs a value';
  END IF;
  -- Manual edits never propose — they apply directly with auto-protection.
  IF p_origin NOT IN ('import', 'extraction', 'projection', 'generated') THEN
    RAISE EXCEPTION 'invalid proposal origin: %', p_origin;
  END IF;

  v_key := encode(sha256(convert_to(
    p_contact_id::text || '|' || p_target_kind || '|' || v_field_key || '|' || v_normalized || '|' || p_origin,
    'UTF8'
  )), 'hex');

  INSERT INTO public.crm_field_proposals (
    contact_id, target_kind, field_key, proposed_value, normalized_value,
    current_value, origin, origin_ref, confidence, proposal_key,
    evidence_thought_ids
  )
  VALUES (
    p_contact_id, p_target_kind, v_field_key, p_proposed_value, v_normalized,
    p_current_value, p_origin, COALESCE(p_origin_ref, '{}'::jsonb), p_confidence, v_key,
    COALESCE(p_evidence_thought_ids, ARRAY[]::UUID[])
  )
  ON CONFLICT (proposal_key) DO UPDATE
    SET seen_count   = crm_field_proposals.seen_count + 1,
        last_seen_at = timezone('utc', now()),
        -- Accumulate evidence across sightings; status is never touched, so a
        -- rejected proposal stays rejected no matter how often it re-appears.
        evidence_thought_ids = (
          SELECT COALESCE(array_agg(DISTINCT t), ARRAY[]::UUID[])
          FROM unnest(crm_field_proposals.evidence_thought_ids || COALESCE(EXCLUDED.evidence_thought_ids, ARRAY[]::UUID[])) t
        )
  RETURNING id, status, (xmax::text = '0') INTO v_id, v_status, v_created;

  RETURN jsonb_build_object('proposal_id', v_id, 'status', v_status, 'created', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_propose_field(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT, UUID[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_propose_field(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT, UUID[], TEXT) TO service_role;

-- ─── crm_patch_contact_record — PATCH with auto-protection ──────────────────
-- True PATCH: only the keys present in p_patch are considered. A machine origin
-- (import/extraction/projection) writing over a human-set ('manual') field is
-- DIVERTED to crm_propose_field instead of overwriting — the field is reported
-- under "proposed". A locked field blocks everyone (reported under "conflicts").
-- Accepting a proposal re-enters this function with p_resolved_proposal_id set,
-- which bypasses protection: the user's decision IS the manual authority.

CREATE OR REPLACE FUNCTION public.crm_patch_contact_record(
  p_contact_id           UUID,
  p_patch                JSONB,
  p_actor                TEXT DEFAULT 'service',
  p_origin               TEXT DEFAULT 'manual',
  p_run_id               TEXT DEFAULT NULL,
  p_expected_updated_at  TIMESTAMPTZ DEFAULT NULL,
  p_resolved_proposal_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor TEXT := COALESCE(NULLIF(trim(p_actor), ''), 'service');
  v_row   public.crm_contacts%ROWTYPE;
  v_key   TEXT;
  v_new   TEXT;
  v_cur   TEXT;
  v_prov  JSONB;
  v_locked BOOLEAN;
  v_prev_origin TEXT;
  v_entry JSONB;
  v_applied TEXT[] := ARRAY[]::TEXT[];
  v_conflicts TEXT[] := ARRAY[]::TEXT[];
  v_proposed JSONB := '[]'::jsonb;
  v_applied_patch JSONB := '{}'::jsonb;
  v_prov_patch JSONB := '{}'::jsonb;
  v_proposal JSONB;
  v_resolved_proposal public.crm_field_proposals%ROWTYPE;
  v_bypass_this_key BOOLEAN;
  v_now TIMESTAMPTZ := timezone('utc', now());
  c_known_keys CONSTANT TEXT[] := ARRAY[
    'display_name', 'preferred_name', 'given_name', 'family_name', 'pronouns',
    'job_title', 'organization_name', 'location', 'relationship_note',
    'lifecycle_status', 'privacy_tier', 'owner_label'
  ];
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'p_patch must be a JSON object';
  END IF;
  -- 'generated' is only valid as the origin of an accepted proposal: the human
  -- accept (which sets p_resolved_proposal_id) is the authorization. A direct
  -- machine write may not claim 'generated'. Without this, a generated-origin
  -- proposal could never be accepted — the accept path re-enters here passing
  -- the proposal's origin, and the value would stay forever open.
  IF p_origin NOT IN ('manual', 'import', 'extraction', 'projection')
     AND NOT (p_origin = 'generated' AND p_resolved_proposal_id IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid patch origin: %', p_origin;
  END IF;

  SELECT c.* INTO v_row
  FROM public.crm_contacts c
  WHERE c.id = p_contact_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'CRM contact not found: %', p_contact_id;
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at > p_expected_updated_at THEN
    RAISE EXCEPTION 'crm_contact_stale_write: contact % was modified at % (expected unchanged since %); re-fetch and retry', v_row.id, v_row.updated_at, p_expected_updated_at;
  END IF;

  -- p_resolved_proposal_id is the "manual authority" bypass: it skips
  -- auto-protection so an accepted proposal can apply. Guard it so the bypass
  -- can only be triggered by a real, still-open contact_field proposal on THIS
  -- contact — a forged, stale, or cross-contact id cannot be used to overwrite
  -- a protected field. Load the proposal here; the bypass is then narrowed to
  -- ONLY the exact field_key/value the proposal proposes (see v_bypass_this_key
  -- in the per-key loop), so accepting a proposal for field A can never loosen
  -- protection on field B in the same patch. The canonical accept path
  -- (crm_resolve_field_proposal) always passes a verified open proposal id.
  IF p_resolved_proposal_id IS NOT NULL THEN
    SELECT * INTO v_resolved_proposal
    FROM public.crm_field_proposals p
    WHERE p.id = p_resolved_proposal_id
      AND p.contact_id = v_row.id
      AND p.status = 'open'
      AND p.target_kind = 'contact_field';
    IF v_resolved_proposal.id IS NULL THEN
      RAISE EXCEPTION 'crm_invalid_proposal_bypass: % is not an open contact_field proposal for contact %', p_resolved_proposal_id, v_row.id;
    END IF;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch)
  LOOP
    IF NOT (v_key = ANY(c_known_keys)) THEN
      RAISE EXCEPTION 'unknown contact field: %', v_key;
    END IF;

    v_new := NULLIF(trim(COALESCE(p_patch->>v_key, '')), '');

    -- Enum / required validation at the boundary.
    IF v_key = 'lifecycle_status' AND (v_new IS NULL OR v_new NOT IN ('active', 'archived')) THEN
      RAISE EXCEPTION 'invalid lifecycle status: %', p_patch->>v_key;
    END IF;
    IF v_key = 'privacy_tier' AND (v_new IS NULL OR v_new NOT IN ('standard', 'sensitive', 'restricted')) THEN
      RAISE EXCEPTION 'invalid privacy tier: %', p_patch->>v_key;
    END IF;
    IF v_key = 'display_name' AND v_new IS NULL THEN
      RAISE EXCEPTION 'display_name cannot be cleared';
    END IF;
    IF v_key = 'owner_label' AND v_new IS NULL THEN
      RAISE EXCEPTION 'owner_label cannot be cleared';
    END IF;

    v_cur := CASE v_key
      WHEN 'display_name' THEN v_row.display_name
      WHEN 'preferred_name' THEN v_row.preferred_name
      WHEN 'given_name' THEN v_row.given_name
      WHEN 'family_name' THEN v_row.family_name
      WHEN 'pronouns' THEN v_row.pronouns
      WHEN 'job_title' THEN v_row.job_title
      WHEN 'organization_name' THEN v_row.organization_name
      WHEN 'location' THEN v_row.location
      WHEN 'relationship_note' THEN v_row.relationship_note
      WHEN 'lifecycle_status' THEN v_row.lifecycle_status
      WHEN 'privacy_tier' THEN v_row.privacy_tier
      WHEN 'owner_label' THEN v_row.owner_label
    END;

    -- No-op writes neither claim provenance nor churn updated_at.
    IF v_new IS NOT DISTINCT FROM v_cur THEN
      CONTINUE;
    END IF;

    v_prov := COALESCE(v_row.field_provenance->v_key, '{}'::jsonb);
    v_locked := COALESCE((v_prov->>'locked')::boolean, false);
    -- A value with no recorded provenance predates the truth layer; treat it as
    -- manual (conservative: machines must propose, humans may edit).
    v_prev_origin := COALESCE(NULLIF(v_prov->>'origin', ''),
                              CASE WHEN v_cur IS NULL THEN NULL ELSE 'manual' END);

    -- The proposal bypass loosens lock / manual-origin protection for ONLY the
    -- exact field the proposal is about, and ONLY when the patched value equals
    -- the proposal's proposed value. Any other key in the same patch is treated
    -- as a normal (unprivileged) write, so a stale or same-contact proposal for
    -- field A cannot smuggle an unprotected overwrite of field B (or a different
    -- value for field A) past auto-protection.
    v_bypass_this_key := (
      p_resolved_proposal_id IS NOT NULL
      AND v_key = v_resolved_proposal.field_key
      AND v_new IS NOT DISTINCT FROM NULLIF(trim(COALESCE(v_resolved_proposal.proposed_value, '')), '')
    );

    IF NOT v_bypass_this_key AND v_locked THEN
      -- Locked blocks everyone, including manual bulk edits: unlock first.
      v_conflicts := v_conflicts || v_key;
      CONTINUE;
    END IF;

    IF NOT v_bypass_this_key
       AND p_origin <> 'manual'
       AND v_prev_origin = 'manual' THEN
      -- Auto-protection: a machine writer never overwrites a human value; it
      -- proposes instead. The canonical field is left untouched.
      v_proposal := public.crm_propose_field(
        v_row.id,
        'contact_field',
        v_key,
        p_patch->>v_key,
        p_origin,
        jsonb_strip_nulls(jsonb_build_object('run_id', p_run_id)),
        NULL,
        v_cur,
        NULL,
        NULL
      );
      v_proposed := v_proposed || jsonb_build_object(
        'field', v_key,
        'proposal_id', v_proposal->>'proposal_id',
        'proposal_status', v_proposal->>'status'
      );
      CONTINUE;
    END IF;

    v_applied := v_applied || v_key;
    v_applied_patch := v_applied_patch || jsonb_build_object(v_key, p_patch->v_key);
    -- When this write is a human ACCEPTING a proposal, the human's decision
    -- makes the value authoritative: stamp origin='manual' so a later machine
    -- write cannot overwrite the now-human-blessed value directly (it would have
    -- to propose again). The machine origin that supplied the value is preserved
    -- under 'accepted_origin' for audit. A direct manual edit keeps p_origin.
    v_entry := jsonb_strip_nulls(jsonb_build_object(
      'origin', CASE WHEN v_bypass_this_key THEN 'manual' ELSE p_origin END,
      'accepted_origin', CASE WHEN v_bypass_this_key THEN p_origin ELSE NULL END,
      'actor', v_actor,
      'run_id', p_run_id,
      'at', v_now,
      'locked', v_locked,
      'via_proposal', CASE WHEN v_bypass_this_key THEN p_resolved_proposal_id ELSE NULL END
    ));
    v_prov_patch := v_prov_patch || jsonb_build_object(v_key, v_entry);
  END LOOP;

  IF array_length(v_applied, 1) IS NOT NULL THEN
    UPDATE public.crm_contacts c
    SET display_name = CASE WHEN v_applied_patch ? 'display_name' THEN NULLIF(trim(COALESCE(v_applied_patch->>'display_name', '')), '') ELSE c.display_name END,
        preferred_name = CASE WHEN v_applied_patch ? 'preferred_name' THEN NULLIF(trim(COALESCE(v_applied_patch->>'preferred_name', '')), '') ELSE c.preferred_name END,
        given_name = CASE WHEN v_applied_patch ? 'given_name' THEN NULLIF(trim(COALESCE(v_applied_patch->>'given_name', '')), '') ELSE c.given_name END,
        family_name = CASE WHEN v_applied_patch ? 'family_name' THEN NULLIF(trim(COALESCE(v_applied_patch->>'family_name', '')), '') ELSE c.family_name END,
        pronouns = CASE WHEN v_applied_patch ? 'pronouns' THEN NULLIF(trim(COALESCE(v_applied_patch->>'pronouns', '')), '') ELSE c.pronouns END,
        job_title = CASE WHEN v_applied_patch ? 'job_title' THEN NULLIF(trim(COALESCE(v_applied_patch->>'job_title', '')), '') ELSE c.job_title END,
        organization_name = CASE WHEN v_applied_patch ? 'organization_name' THEN NULLIF(trim(COALESCE(v_applied_patch->>'organization_name', '')), '') ELSE c.organization_name END,
        location = CASE WHEN v_applied_patch ? 'location' THEN NULLIF(trim(COALESCE(v_applied_patch->>'location', '')), '') ELSE c.location END,
        relationship_note = CASE WHEN v_applied_patch ? 'relationship_note' THEN NULLIF(trim(COALESCE(v_applied_patch->>'relationship_note', '')), '') ELSE c.relationship_note END,
        lifecycle_status = CASE WHEN v_applied_patch ? 'lifecycle_status' THEN NULLIF(trim(COALESCE(v_applied_patch->>'lifecycle_status', '')), '') ELSE c.lifecycle_status END,
        privacy_tier = CASE WHEN v_applied_patch ? 'privacy_tier' THEN NULLIF(trim(COALESCE(v_applied_patch->>'privacy_tier', '')), '') ELSE c.privacy_tier END,
        owner_label = CASE WHEN v_applied_patch ? 'owner_label' THEN NULLIF(trim(COALESCE(v_applied_patch->>'owner_label', '')), '') ELSE c.owner_label END,
        field_provenance = c.field_provenance || v_prov_patch,
        updated_at = v_now,
        updated_by = v_actor
    WHERE c.id = v_row.id;

    INSERT INTO public.crm_contact_change_log (contact_id, action, actor_label, changed_fields)
    VALUES (
      v_row.id,
      'contact.update',
      v_actor,
      jsonb_strip_nulls(jsonb_build_object(
        'patched_fields', to_jsonb(v_applied),
        'origin', p_origin,
        'run_id', p_run_id,
        'via_proposal', p_resolved_proposal_id
      ))
    );
  END IF;

  RETURN jsonb_build_object(
    'contact_id', v_row.id,
    'applied', to_jsonb(v_applied),
    'proposed', v_proposed,
    'conflicts', to_jsonb(v_conflicts),
    'record', (SELECT r.record FROM public.crm_get_contact(v_row.id) r)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.crm_patch_contact_record(UUID, JSONB, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_patch_contact_record(UUID, JSONB, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID) TO service_role;

-- ─── crm_set_field_lock — toggle the explicit lock on one field ─────────────

CREATE OR REPLACE FUNCTION public.crm_set_field_lock(
  p_contact_id UUID,
  p_field_key  TEXT,
  p_locked     BOOLEAN,
  p_actor      TEXT DEFAULT 'service'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor TEXT := COALESCE(NULLIF(trim(p_actor), ''), 'service');
  v_contact_id UUID;
  v_entry JSONB;
BEGIN
  IF p_field_key IS NULL OR p_field_key NOT IN (
    'display_name', 'preferred_name', 'given_name', 'family_name', 'pronouns',
    'job_title', 'organization_name', 'location', 'relationship_note',
    'lifecycle_status', 'privacy_tier', 'owner_label'
  ) THEN
    RAISE EXCEPTION 'unknown contact field: %', p_field_key;
  END IF;

  SELECT c.id INTO v_contact_id
  FROM public.crm_contacts c
  WHERE c.id = p_contact_id
  FOR UPDATE;

  IF v_contact_id IS NULL THEN
    RAISE EXCEPTION 'CRM contact not found: %', p_contact_id;
  END IF;

  UPDATE public.crm_contacts c
  SET field_provenance = c.field_provenance || jsonb_build_object(
        p_field_key,
        COALESCE(c.field_provenance->p_field_key, jsonb_build_object('origin', 'manual'))
          || jsonb_build_object('locked', COALESCE(p_locked, false), 'actor', v_actor, 'at', timezone('utc', now()))
      ),
      updated_at = timezone('utc', now()),
      updated_by = v_actor
  WHERE c.id = v_contact_id
  RETURNING c.field_provenance->p_field_key INTO v_entry;

  INSERT INTO public.crm_contact_change_log (contact_id, action, actor_label, changed_fields)
  VALUES (v_contact_id, 'contact.update', v_actor,
          jsonb_build_object('field_lock', p_field_key, 'locked', COALESCE(p_locked, false)));

  RETURN jsonb_build_object('field', p_field_key, 'provenance', v_entry);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_set_field_lock(UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_set_field_lock(UUID, TEXT, BOOLEAN, TEXT) TO service_role;

-- ─── crm_add_contact_method — add / update a contact method ─────────────────
-- The method value is redacted in the change log.

CREATE OR REPLACE FUNCTION public.crm_add_contact_method(
  p_contact_id  UUID,
  p_method_type TEXT,
  p_value       TEXT,
  p_label       TEXT DEFAULT NULL,
  p_is_primary  BOOLEAN DEFAULT false,
  p_actor       TEXT DEFAULT 'service',
  p_source      TEXT DEFAULT 'manual'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor       TEXT := COALESCE(NULLIF(trim(p_actor), ''), 'service');
  v_method_type TEXT := NULLIF(trim(COALESCE(p_method_type, '')), '');
  v_value       TEXT := NULLIF(trim(COALESCE(p_value, '')), '');
  v_source      TEXT := COALESCE(NULLIF(trim(COALESCE(p_source, '')), ''), 'manual');
  v_method_id   UUID;
BEGIN
  IF v_method_type IS NULL OR v_method_type NOT IN ('email', 'phone', 'url', 'social', 'address', 'other') THEN
    RAISE EXCEPTION 'invalid contact method type: %', p_method_type;
  END IF;
  IF v_value IS NULL THEN
    RAISE EXCEPTION 'contact method value is required';
  END IF;

  PERFORM 1 FROM public.crm_contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CRM contact not found: %', p_contact_id;
  END IF;

  IF COALESCE(p_is_primary, false) THEN
    UPDATE public.crm_contact_methods
    SET is_primary = false, updated_at = timezone('utc', now()), updated_by = v_actor
    WHERE contact_id = p_contact_id
      AND method_type = v_method_type
      AND deleted_at IS NULL
      AND status = 'current';
  END IF;

  SELECT m.id INTO v_method_id
  FROM public.crm_contact_methods m
  WHERE m.contact_id = p_contact_id
    AND m.method_type = v_method_type
    AND lower(m.value) = lower(v_value)
    AND m.deleted_at IS NULL
    AND m.status = 'current'
  LIMIT 1;

  IF v_method_id IS NULL THEN
    INSERT INTO public.crm_contact_methods (
      contact_id, method_type, value, label, is_primary, source, confidence, created_by, updated_by
    )
    VALUES (
      p_contact_id, v_method_type, v_value,
      NULLIF(trim(COALESCE(p_label, '')), ''),
      COALESCE(p_is_primary, false), v_source, 1.0, v_actor, v_actor
    )
    RETURNING id INTO v_method_id;
  ELSE
    UPDATE public.crm_contact_methods
    SET label = NULLIF(trim(COALESCE(p_label, '')), ''),
        is_primary = COALESCE(p_is_primary, is_primary),
        updated_at = timezone('utc', now()),
        updated_by = v_actor
    WHERE id = v_method_id;
  END IF;

  -- The value is REDACTED in the audit log: the change log never stores a raw
  -- email/phone string.
  INSERT INTO public.crm_contact_change_log (contact_id, method_id, action, actor_label, changed_fields)
  VALUES (
    p_contact_id, v_method_id, 'method.upsert', v_actor,
    jsonb_build_object('method_type', v_method_type, 'value', '[redacted]', 'is_primary', COALESCE(p_is_primary, false))
  );

  RETURN (SELECT to_jsonb(m.*) FROM public.crm_contact_methods m WHERE m.id = v_method_id);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_add_contact_method(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_add_contact_method(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT) TO service_role;

-- ─── crm_add_field_evidence — attach a supporting/contradicting thought ─────

CREATE OR REPLACE FUNCTION public.crm_add_field_evidence(
  p_contact_id UUID,
  p_field_key  TEXT,
  p_thought_id UUID,
  p_role       TEXT DEFAULT 'supports',
  p_target_kind TEXT DEFAULT 'contact_field',
  p_target_id  UUID DEFAULT NULL,
  p_note       TEXT DEFAULT NULL,
  p_actor      TEXT DEFAULT 'service'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor TEXT := COALESCE(NULLIF(trim(p_actor), ''), 'service');
  v_id    UUID;
BEGIN
  IF p_role NOT IN ('supports', 'contradicts', 'source', 'correction') THEN
    RAISE EXCEPTION 'invalid evidence role: %', p_role;
  END IF;
  IF p_target_kind NOT IN ('contact_field', 'contact_method', 'alias', 'proposal') THEN
    RAISE EXCEPTION 'invalid evidence target_kind: %', p_target_kind;
  END IF;

  INSERT INTO public.crm_field_evidence (
    contact_id, target_kind, target_id, field_key, thought_id, role, note, created_by
  )
  VALUES (
    p_contact_id, p_target_kind, p_target_id,
    NULLIF(trim(COALESCE(p_field_key, '')), ''),
    p_thought_id, p_role, NULLIF(trim(COALESCE(p_note, '')), ''), v_actor
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_add_field_evidence(UUID, TEXT, UUID, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_add_field_evidence(UUID, TEXT, UUID, TEXT, TEXT, UUID, TEXT, TEXT) TO service_role;

-- ─── crm_contact_field_evidence — read evidence (restricted excluded) ───────

CREATE OR REPLACE FUNCTION public.crm_contact_field_evidence(
  p_contact_id        UUID,
  p_field_key         TEXT DEFAULT NULL,
  p_exclude_restricted BOOLEAN DEFAULT true,
  p_limit             INTEGER DEFAULT 100
) RETURNS TABLE (
  evidence_id        UUID,
  target_kind        TEXT,
  target_id          UUID,
  field_key          TEXT,
  role               TEXT,
  note               TEXT,
  thought_id         UUID,
  thought_snippet    TEXT,
  thought_created_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    e.id,
    e.target_kind,
    e.target_id,
    e.field_key,
    e.role,
    e.note,
    e.thought_id,
    left(t.content, 400),
    t.created_at,
    e.created_at
  FROM public.crm_field_evidence e
  JOIN public.crm_contacts c ON c.id = e.contact_id
  JOIN public.thoughts t ON t.id = e.thought_id
  WHERE e.contact_id = p_contact_id
    AND (p_field_key IS NULL OR e.field_key = p_field_key)
    AND (NOT p_exclude_restricted OR c.privacy_tier IS DISTINCT FROM 'restricted')
  ORDER BY e.created_at DESC
  LIMIT greatest(1, least(COALESCE(p_limit, 100), 500));
$$;

REVOKE ALL ON FUNCTION public.crm_contact_field_evidence(UUID, TEXT, BOOLEAN, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_contact_field_evidence(UUID, TEXT, BOOLEAN, INTEGER) TO service_role;

-- ─── crm_resolve_field_proposal — the human accept / reject decision ────────
-- accept: re-enters crm_patch_contact_record with p_resolved_proposal_id set,
--         which bypasses auto-protection and APPLIES the proposed value to the
--         canonical field (and logs it). For a method proposal, the value is
--         added via crm_add_contact_method.
-- reject: the canonical field is NOT touched; the proposal is marked rejected
--         and logged. Its proposal_key stays unique so the same value can never
--         be re-proposed.
-- Either decision is recorded as evidence about the field.

CREATE OR REPLACE FUNCTION public.crm_resolve_field_proposal(
  p_proposal_id UUID,
  p_decision    TEXT,
  p_actor       TEXT DEFAULT 'service'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor TEXT := COALESCE(NULLIF(trim(p_actor), ''), 'service');
  v_p     public.crm_field_proposals%ROWTYPE;
  v_apply JSONB;
BEGIN
  IF p_decision NOT IN ('accept', 'reject') THEN
    RAISE EXCEPTION 'decision must be accept or reject';
  END IF;

  SELECT * INTO v_p
  FROM public.crm_field_proposals
  WHERE id = p_proposal_id
  FOR UPDATE;

  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'proposal not found: %', p_proposal_id;
  END IF;
  IF v_p.status <> 'open' THEN
    -- Already decided: idempotent no-op, the canonical field is untouched.
    RETURN jsonb_build_object('proposal_id', v_p.id, 'status', v_p.status, 'changed', false);
  END IF;

  IF p_decision = 'accept' THEN
    IF v_p.target_kind = 'contact_field' THEN
      -- A human-locked field blocks acceptance too: the lock is a deliberate
      -- "do not change this" statement, stronger than auto-protection. Accepting
      -- a proposal passes p_resolved_proposal_id, which bypasses the lock inside
      -- the patch, so we must check the lock HERE, before applying, and refuse.
      IF COALESCE((
        SELECT (c.field_provenance->v_p.field_key->>'locked')::boolean
        FROM public.crm_contacts c WHERE c.id = v_p.contact_id
      ), false) THEN
        RAISE EXCEPTION 'field % is locked; unlock it before accepting this proposal', v_p.field_key;
      END IF;
      v_apply := public.crm_patch_contact_record(
        v_p.contact_id,
        jsonb_build_object(v_p.field_key, v_p.proposed_value),
        v_actor,
        v_p.origin,
        v_p.origin_ref->>'run_id',
        NULL,
        v_p.id
      );
    ELSIF v_p.target_kind = 'contact_method' THEN
      v_apply := public.crm_add_contact_method(
        v_p.contact_id, v_p.field_key, v_p.proposed_value, NULL, false, v_actor, v_p.origin
      );
    ELSE
      RAISE EXCEPTION 'accepting % proposals is not supported yet', v_p.target_kind;
    END IF;
  END IF;

  UPDATE public.crm_field_proposals
  SET status     = CASE WHEN p_decision = 'accept' THEN 'accepted' ELSE 'rejected' END,
      decided_at = timezone('utc', now()),
      decided_by = v_actor
  WHERE id = v_p.id;

  -- Either decision is itself evidence about the field. Evidence insertion is
  -- best-effort: a proposal whose evidence_thought_ids contains a deleted or
  -- mistyped UUID must not abort the decision. Filter to ids that actually exist
  -- in thoughts so the crm_field_evidence FK can never fire — the decision is
  -- recorded and the valid evidence still lands.
  INSERT INTO public.crm_field_evidence (contact_id, target_kind, target_id, field_key, thought_id, role, note, created_by)
  SELECT v_p.contact_id, 'proposal', v_p.id, v_p.field_key, t.id, 'correction',
         'proposal ' || p_decision || 'ed', v_actor
  FROM unnest(COALESCE(v_p.evidence_thought_ids, ARRAY[]::UUID[])) AS ev(thought_id)
  JOIN public.thoughts t ON t.id = ev.thought_id
  ON CONFLICT DO NOTHING;

  INSERT INTO public.crm_contact_change_log (contact_id, action, actor_label, changed_fields)
  VALUES (v_p.contact_id, 'proposal.' || p_decision, v_actor,
          jsonb_build_object('proposal_id', v_p.id, 'field_key', v_p.field_key, 'target_kind', v_p.target_kind));

  RETURN jsonb_build_object(
    'proposal_id', v_p.id,
    'status', CASE WHEN p_decision = 'accept' THEN 'accepted' ELSE 'rejected' END,
    'changed', true,
    'apply_result', v_apply
  );
END;
$$;

REVOKE ALL ON FUNCTION public.crm_resolve_field_proposal(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_resolve_field_proposal(UUID, TEXT, TEXT) TO service_role;

-- ─── crm_resolve_field_proposals_by_run — batch resolve one import run ──────

CREATE OR REPLACE FUNCTION public.crm_resolve_field_proposals_by_run(
  p_run_id   TEXT,
  p_decision TEXT,
  p_actor    TEXT DEFAULT 'service'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id       UUID;
  v_resolved INTEGER := 0;
  v_failed   INTEGER := 0;
  v_failures JSONB := '[]'::jsonb;
BEGIN
  IF NULLIF(trim(COALESCE(p_run_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'run_id is required';
  END IF;

  FOR v_id IN
    SELECT id FROM public.crm_field_proposals
    WHERE status = 'open' AND origin_ref->>'run_id' = p_run_id
    ORDER BY created_at
  LOOP
    BEGIN
      PERFORM public.crm_resolve_field_proposal(v_id, p_decision, p_actor);
      v_resolved := v_resolved + 1;
    EXCEPTION WHEN others THEN
      v_failed := v_failed + 1;
      v_failures := v_failures || jsonb_build_object('proposal_id', v_id, 'error', sqlerrm);
    END;
  END LOOP;

  RETURN jsonb_build_object('resolved', v_resolved, 'failed', v_failed, 'failures', v_failures);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_resolve_field_proposals_by_run(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_resolve_field_proposals_by_run(TEXT, TEXT, TEXT) TO service_role;

-- ============================================================================
-- Row-level security + table grants (service_role only)
-- ============================================================================
-- Contact data is reached through the service role on a trusted server. RLS is
-- enabled (default-deny for anon/authenticated), and direct privileges are
-- revoked from PUBLIC/anon/authenticated so a project that blanket-grants new
-- tables to its API roles cannot leave contact data exposed. Defense in depth.

ALTER TABLE public.crm_contacts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contact_methods     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contact_aliases     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contact_change_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_field_proposals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_field_evidence      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.crm_contacts           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_contact_methods    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_contact_aliases    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_contact_change_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_field_proposals    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_field_evidence     FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.crm_contacts           TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_contact_methods    TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_contact_aliases    TO service_role;
GRANT SELECT, INSERT         ON public.crm_contact_change_log TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_field_proposals    TO service_role;
GRANT SELECT, INSERT         ON public.crm_field_evidence     TO service_role;

-- Make the new tables and RPCs visible to PostgREST immediately.
NOTIFY pgrst, 'reload schema';
