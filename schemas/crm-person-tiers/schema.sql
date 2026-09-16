-- CRM Person Tiers
-- Adds a standalone `crm_persons` table with a four-tier `relationship_tier`
-- taxonomy (connected > contact > known > unknown), an optional join table
-- for linking persons to core `thoughts` rows, and an RPC that returns
-- per-person tiers with an activity-based "connected" promotion rule.
--
-- Safe to run multiple times (fully idempotent).
-- Does not destroy data: no dropping or truncating of user tables.
-- The core `thoughts` table is untouched.

-- ============================================================
-- 1. PERSON TIER VOCABULARY (CHECK constraint)
--    Taxonomy (most permissive first):
--      connected  -- family, close contacts, or high-activity recent contacts
--      contact    -- in your contact list / address book
--      known      -- you've had an engaged thread (you replied)
--      unknown    -- no prior engagement, seen only once
--    The constraint is self-contained in the table so the vocabulary stays
--    tight without creating a DB-wide enum that is hard to extend later.
-- ============================================================

-- ============================================================
-- 2. CRM_PERSONS TABLE
--    A standalone person record. Not linked to the core `thoughts`
--    primary key directly — use the `crm_person_mentions` join table
--    below to count mentions, which keeps the core `thoughts` table
--    structure untouched per OB1 contribution rules.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.crm_persons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name  TEXT NOT NULL,
  aliases         JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  relationship_tier TEXT NOT NULL DEFAULT 'unknown'
    CHECK (relationship_tier IN ('connected', 'contact', 'known', 'unknown')),
  first_seen_at   TIMESTAMPTZ DEFAULT now(),
  last_seen_at    TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Case-insensitive uniqueness on canonical_name so imports don't create
-- "Jane Doe" and "jane doe" as two records.
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_persons_canonical_name_lower
  ON public.crm_persons (lower(canonical_name));

CREATE INDEX IF NOT EXISTS idx_crm_persons_relationship_tier
  ON public.crm_persons (relationship_tier);

CREATE INDEX IF NOT EXISTS idx_crm_persons_last_seen_at
  ON public.crm_persons (last_seen_at DESC NULLS LAST);

-- ============================================================
-- 3. CRM_PERSON_MENTIONS JOIN TABLE
--    Links a person to a thought in the core `thoughts` table so the
--    tier RPC can aggregate mention counts. Stays in its own table so
--    it can be rebuilt from scratch without touching `thoughts`.
--
--    NOTE: Assumes the core `thoughts` table uses UUID ids (the default
--    from `docs/01-getting-started.md`). If your deployment uses BIGINT
--    ids instead, change `thought_id UUID` to `thought_id BIGINT` and
--    drop the REFERENCES clause (or adjust to match).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.crm_person_mentions (
  person_id       UUID NOT NULL REFERENCES public.crm_persons(id) ON DELETE CASCADE,
  thought_id      UUID NOT NULL,
  mention_role    TEXT, -- free-form: 'sender', 'recipient', 'subject', etc.
  created_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (person_id, thought_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_person_mentions_thought
  ON public.crm_person_mentions (thought_id);

-- Auto-update the `updated_at` timestamp on crm_persons row updates.
CREATE OR REPLACE FUNCTION public.crm_persons_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_persons_updated_at ON public.crm_persons;
CREATE TRIGGER trg_crm_persons_updated_at
  BEFORE UPDATE ON public.crm_persons
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_persons_touch_updated_at();

-- ============================================================
-- 4. CRM_PERSON_TIERS RPC
--    Returns one row per person with the stored `relationship_tier`,
--    a computed `effective_tier` (applying the "connected" promotion
--    rule), and the aggregated mention count. Ordered by tier
--    priority -> last_seen desc -> mention_count desc -> name asc.
--
--    Promotion rule for "connected":
--      effective_tier = 'connected' when
--        relationship_tier = 'connected'
--        OR (mention_count >= p_promote_min_mentions
--            AND last_seen_at >= now() - p_promote_within)
--
--    Search: case-insensitive ILIKE on canonical_name.
--    Pagination: (p_limit, p_offset). p_limit is clamped to [1, 200].
-- ============================================================

CREATE OR REPLACE FUNCTION public.crm_person_tiers(
  p_limit                   INTEGER  DEFAULT 50,
  p_offset                  INTEGER  DEFAULT 0,
  p_search                  TEXT     DEFAULT NULL,
  p_promote_min_mentions    INTEGER  DEFAULT 20,
  p_promote_within          INTERVAL DEFAULT INTERVAL '7 days'
)
RETURNS TABLE (
  id                UUID,
  canonical_name    TEXT,
  aliases           JSONB,
  metadata          JSONB,
  first_seen_at     TIMESTAMPTZ,
  last_seen_at      TIMESTAMPTZ,
  mention_count     BIGINT,
  relationship_tier TEXT,
  effective_tier    TEXT,
  total_count       BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_limit  INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
  v_search TEXT    := NULLIF(trim(COALESCE(p_search, '')), '');
  v_promote_min INTEGER  := GREATEST(COALESCE(p_promote_min_mentions, 20), 0);
  v_promote_within INTERVAL := COALESCE(p_promote_within, INTERVAL '7 days');
  v_total  BIGINT;
BEGIN
  -- Exact total matching the filter so the client can paginate.
  SELECT count(*)
    INTO v_total
    FROM public.crm_persons p
   WHERE (v_search IS NULL OR p.canonical_name ILIKE '%' || v_search || '%');

  -- Compute mention_count and effective_tier BEFORE pagination so global
  -- tier-priority ordering is preserved across pages. Without this, page 1
  -- can miss high-mention "connected" people that sort later by last_seen.
  RETURN QUERY
  WITH filtered AS (
    SELECT
      p.id               AS p_id,
      p.canonical_name   AS p_canonical_name,
      p.aliases          AS p_aliases,
      p.metadata         AS p_metadata,
      p.first_seen_at    AS p_first_seen_at,
      p.last_seen_at     AS p_last_seen_at,
      p.relationship_tier AS p_relationship_tier
    FROM public.crm_persons p
    WHERE (v_search IS NULL OR p.canonical_name ILIKE '%' || v_search || '%')
  ),
  mention_counts AS (
    SELECT
      m.person_id AS mc_person_id,
      count(*)::bigint AS mc_count
    FROM public.crm_person_mentions m
    WHERE m.person_id IN (SELECT f.p_id FROM filtered f)
    GROUP BY m.person_id
  ),
  rows_out AS (
    SELECT
      f.p_id,
      f.p_canonical_name,
      f.p_aliases,
      f.p_metadata,
      f.p_first_seen_at,
      f.p_last_seen_at,
      COALESCE(mc.mc_count, 0)::bigint AS r_mention_count,
      f.p_relationship_tier::text AS r_relationship_tier,
      (CASE
        WHEN f.p_relationship_tier = 'connected' THEN 'connected'
        WHEN COALESCE(mc.mc_count, 0) >= v_promote_min
             AND f.p_last_seen_at IS NOT NULL
             AND f.p_last_seen_at >= now() - v_promote_within THEN 'connected'
        ELSE f.p_relationship_tier
      END)::text AS r_effective_tier
    FROM filtered f
    LEFT JOIN mention_counts mc ON mc.mc_person_id = f.p_id
  )
  SELECT
    ro.p_id,
    ro.p_canonical_name,
    ro.p_aliases,
    ro.p_metadata,
    ro.p_first_seen_at,
    ro.p_last_seen_at,
    ro.r_mention_count,
    ro.r_relationship_tier,
    ro.r_effective_tier,
    v_total
  FROM rows_out ro
  ORDER BY
    CASE ro.r_effective_tier
      WHEN 'connected' THEN 1
      WHEN 'contact'   THEN 2
      WHEN 'known'     THEN 3
      ELSE 4
    END ASC,
    ro.p_last_seen_at DESC NULLS LAST,
    ro.r_mention_count DESC,
    ro.p_canonical_name ASC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

-- ============================================================
-- 5. GRANTS
--    Supabase no longer auto-grants CRUD permissions to service_role
--    on new projects, so we grant them explicitly.
--
--    Least-privilege read path:
--      - RPC execution is granted to `authenticated` and `service_role`
--        only. `anon` is deliberately excluded so an exposed anon key
--        cannot dump every person's name, aliases, and metadata.
--      - The function is SECURITY INVOKER (see section 4), so callers
--        still see only rows their role is allowed to see. If you want
--        authenticated end-users to read these tables directly, enable
--        RLS on `crm_persons` and `crm_person_mentions` and add an
--        explicit SELECT policy; otherwise, call the RPC from a
--        server-side `service_role` client.
--      - To expose the RPC to anon clients on purpose (e.g. a public
--        "who's in this brain" page), explicitly add
--        `GRANT EXECUTE ... TO anon;` in a follow-up migration after
--        you've added RLS policies you're comfortable with.
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crm_persons         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crm_person_mentions TO service_role;

GRANT EXECUTE ON FUNCTION public.crm_person_tiers(INTEGER, INTEGER, TEXT, INTEGER, INTERVAL)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.crm_person_tiers(INTEGER, INTEGER, TEXT, INTEGER, INTERVAL) IS
  'Paginated list of CRM persons with per-row relationship_tier and a computed effective_tier that promotes high-activity recent contacts to "connected".';

-- Reload PostgREST schema cache so the new RPC is immediately callable.
NOTIFY pgrst, 'reload schema';
