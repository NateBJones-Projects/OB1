-- Typed Reasoning Edges + Temporal Validity
--
-- Adds two things to Open Brain's knowledge graph:
--
--   1. A new `thought_edges` table that holds semantic reasoning
--      relations BETWEEN thoughts (supports, contradicts, evolved_into,
--      supersedes, depends_on, related_to). This is distinct from the
--      entity-to-entity `edges` table shipped by `schemas/entity-extraction/`
--      because the FK targets are different: `edges.from_entity_id` points
--      at `entities.id`, whereas reasoning edges point at `thoughts.id`.
--
--   2. Temporal validity columns (`valid_from`, `valid_until`,
--      `decay_weight`) on the existing entity `edges` table so that
--      edge relevance can decay over time.
--
-- Both parts are idempotent. The entity-extraction portion is a
-- guarded `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so it is safe to
-- re-apply and is a no-op if the columns already exist.
--
-- PREREQUISITES
--   - `public.thoughts` table (from `docs/01-getting-started.md`)
--   - `schemas/entity-extraction/schema.sql` applied, because the
--     temporal-validity columns target its `edges` table.
--
-- FK TYPE NOTE: `public.thoughts.id` is UUID in stock Open Brain, so
-- `thought_edges.from_thought_id` / `to_thought_id` are UUID to match.
-- The table's own `id` is BIGSERIAL (integer surrogate) — the UUID
-- only applies to the FK columns pointing at `thoughts`.

BEGIN;

-- ============================================================
-- 0. PREREQUISITE CHECKS
--    Fail fast with a clear message if the base thoughts table
--    or the entity-extraction edges table is missing.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'thoughts'
  ) THEN
    RAISE EXCEPTION
      'typed-reasoning-edges requires the public.thoughts table. '
      'Run docs/01-getting-started.md first, then re-apply this schema.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'edges'
  ) THEN
    RAISE EXCEPTION
      'typed-reasoning-edges requires the public.edges table from '
      'schemas/entity-extraction/. Apply entity-extraction first, then re-apply this schema.';
  END IF;
END $$;

-- ============================================================
-- 1. THOUGHT EDGES
--    Semantic reasoning relations between thoughts. Populated by
--    the `recipes/typed-edge-classifier/` worker, but the table
--    is usable standalone (manual INSERTs are fine too).
--
--    relation vocabulary:
--      supports     — A strengthens or provides evidence for B
--      contradicts  — A disagrees with or disproves B
--      evolved_into — A was replaced by a refined/updated B
--      supersedes   — A is the newer replacement for B (decisions/versions)
--      depends_on   — A is conditional on B being true
--      related_to   — Generic fallback when no specific label fits
--
--    confidence: classifier confidence, 0.0 to 1.0
--    decay_weight: current temporal weight, 0.0 to 1.0. Recalculated
--      by the classifier or a separate decay job; lower values mean
--      the edge should rank lower in graph traversal.
--    valid_from / valid_until: temporal bounds. NULL valid_from = always
--      true; NULL valid_until = still current.
--    classifier_version: tag so future classifier vocabulary changes can
--      be distinguished from older runs during audit.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.thought_edges (
  id BIGSERIAL PRIMARY KEY,
  from_thought_id UUID NOT NULL REFERENCES public.thoughts(id) ON DELETE CASCADE,
  to_thought_id UUID NOT NULL REFERENCES public.thoughts(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (
    relation IN ('supports', 'contradicts', 'evolved_into', 'supersedes', 'depends_on', 'related_to')
  ),
  confidence NUMERIC(3,2) CHECK (confidence >= 0 AND confidence <= 1),
  decay_weight NUMERIC(3,2) CHECK (decay_weight IS NULL OR (decay_weight >= 0 AND decay_weight <= 1)),
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  classifier_version TEXT,
  support_count INT NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_thought_id, to_thought_id, relation),
  CHECK (from_thought_id <> to_thought_id)
);

COMMENT ON TABLE public.thought_edges IS
  'Semantic reasoning relations between thoughts. Paired with the typed-edge-classifier recipe.';
COMMENT ON COLUMN public.thought_edges.confidence IS 'Classifier confidence 0-1';
COMMENT ON COLUMN public.thought_edges.decay_weight IS 'Current temporal weight 0-1; lower = less relevant';
COMMENT ON COLUMN public.thought_edges.valid_from IS 'When the relation became true (NULL = unknown/always)';
COMMENT ON COLUMN public.thought_edges.valid_until IS 'When the relation stopped being true (NULL = still current)';
COMMENT ON COLUMN public.thought_edges.classifier_version IS 'Tag identifying the classifier vocabulary/version that produced the row';

-- ============================================================
-- 2. INDEXES
--    Outgoing, incoming, and temporal-decay query paths.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_thought_edges_from_relation
  ON public.thought_edges (from_thought_id, relation);

CREATE INDEX IF NOT EXISTS idx_thought_edges_to_relation
  ON public.thought_edges (to_thought_id, relation);

-- Partial index: "currently valid" edges are the most common read path
CREATE INDEX IF NOT EXISTS idx_thought_edges_current
  ON public.thought_edges (from_thought_id, to_thought_id)
  WHERE valid_until IS NULL;

-- Partial index for decay sweeps: rows with a valid_until we might expire
CREATE INDEX IF NOT EXISTS idx_thought_edges_valid_until
  ON public.thought_edges (valid_until)
  WHERE valid_until IS NOT NULL;

-- ============================================================
-- 3. updated_at TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION public.thought_edges_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_thought_edges_updated_at ON public.thought_edges;
CREATE TRIGGER trg_thought_edges_updated_at
  BEFORE UPDATE ON public.thought_edges
  FOR EACH ROW EXECUTE FUNCTION public.thought_edges_set_updated_at();

-- ============================================================
-- 4. ROW LEVEL SECURITY
--    Mirror the posture of public.thoughts (see docs/01-getting-started.md):
--    service_role only. No authenticated or anon access.
--
--    Reasoning: each thought_edge row carries from_thought_id,
--    to_thought_id, and metadata.rationale — it exposes derived
--    relationships between private thoughts. Since the underlying
--    public.thoughts table is service-role-only, thought_edges MUST
--    match that posture, otherwise any logged-in client could read
--    derived private-thought relationships that the base table
--    intentionally hides.
--
--    Any future change to open SELECT to authenticated must be an
--    explicit product decision, not a default.
-- ============================================================

ALTER TABLE public.thought_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.thought_edges;
CREATE POLICY "service_role full access"
  ON public.thought_edges
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Explicitly drop any previously-granted authenticated read policy so
-- re-applying this migration on an older deployment tightens the posture.
DROP POLICY IF EXISTS "authenticated read" ON public.thought_edges;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.thought_edges TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.thought_edges_id_seq TO service_role;
-- Revoke any inherited or previously-granted read from authenticated /
-- anon to keep the posture aligned with public.thoughts.
REVOKE ALL ON public.thought_edges FROM authenticated;
REVOKE ALL ON public.thought_edges FROM anon;

-- ============================================================
-- 4b. UPSERT RPC
--     Callers that want "insert OR bump support_count + refresh
--     valid_until" in one atomic write use this function. PostgREST
--     exposes it as POST /rpc/thought_edges_upsert.
--
--     The UNIQUE (from_thought_id, to_thought_id, relation) constraint
--     is the conflict target — on conflict we bump support_count, take
--     the max confidence, and extend valid_until (GREATEST, NULL-safe:
--     a NULL valid_until means "still current", so NULL wins). This
--     matches the documented duplicate-handling contract in the
--     typed-edge-classifier README.
-- ============================================================

CREATE OR REPLACE FUNCTION public.thought_edges_upsert(
  p_from_thought_id UUID,
  p_to_thought_id UUID,
  p_relation TEXT,
  p_confidence NUMERIC,
  p_support_count INT,
  p_classifier_version TEXT,
  p_valid_from TIMESTAMPTZ,
  p_valid_until TIMESTAMPTZ,
  p_metadata JSONB
)
RETURNS public.thought_edges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.thought_edges;
BEGIN
  INSERT INTO public.thought_edges (
    from_thought_id, to_thought_id, relation,
    confidence, support_count, classifier_version,
    valid_from, valid_until, metadata
  )
  VALUES (
    p_from_thought_id, p_to_thought_id, p_relation,
    p_confidence, COALESCE(p_support_count, 1), p_classifier_version,
    p_valid_from, p_valid_until, COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (from_thought_id, to_thought_id, relation)
  DO UPDATE SET
    support_count = public.thought_edges.support_count + COALESCE(EXCLUDED.support_count, 1),
    confidence = GREATEST(public.thought_edges.confidence, EXCLUDED.confidence),
    -- NULL valid_until means "still current" — prefer NULL if either side is NULL,
    -- otherwise take the later bound.
    valid_until = CASE
      WHEN public.thought_edges.valid_until IS NULL OR EXCLUDED.valid_until IS NULL THEN NULL
      ELSE GREATEST(public.thought_edges.valid_until, EXCLUDED.valid_until)
    END,
    -- valid_from: take the earlier known bound (NULL means "always/unknown",
    -- a concrete date is more informative, so prefer the non-NULL; if both
    -- are non-NULL, take the earlier).
    valid_from = CASE
      WHEN public.thought_edges.valid_from IS NULL THEN EXCLUDED.valid_from
      WHEN EXCLUDED.valid_from IS NULL THEN public.thought_edges.valid_from
      ELSE LEAST(public.thought_edges.valid_from, EXCLUDED.valid_from)
    END,
    classifier_version = EXCLUDED.classifier_version,
    metadata = public.thought_edges.metadata || EXCLUDED.metadata,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.thought_edges_upsert IS
  'Insert or (on duplicate key) bump support_count + refresh temporal bounds. Call via POST /rpc/thought_edges_upsert. Use instead of a plain INSERT when you want repeated classifications of the same pair to accumulate evidence.';

REVOKE ALL ON FUNCTION public.thought_edges_upsert(
  UUID, UUID, TEXT, NUMERIC, INT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.thought_edges_upsert(
  UUID, UUID, TEXT, NUMERIC, INT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) TO service_role;

-- ============================================================
-- 5. TEMPORAL VALIDITY ON ENTITY `edges`
--    Adds valid_from / valid_until / decay_weight to the existing
--    entity-to-entity edges table. Idempotent: ADD COLUMN IF NOT
--    EXISTS means re-running is a no-op.
-- ============================================================

ALTER TABLE public.edges
  ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decay_weight NUMERIC(3,2);

-- Validate decay_weight range, but only if the column just got created
-- without a constraint. Using a DO block keeps this idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'edges_decay_weight_range'
  ) THEN
    ALTER TABLE public.edges
      ADD CONSTRAINT edges_decay_weight_range
      CHECK (decay_weight IS NULL OR (decay_weight >= 0 AND decay_weight <= 1));
  END IF;
END $$;

COMMENT ON COLUMN public.edges.valid_from IS 'When this relationship became true (NULL = unknown/always)';
COMMENT ON COLUMN public.edges.valid_until IS 'When this relationship stopped being true (NULL = still current)';
COMMENT ON COLUMN public.edges.decay_weight IS 'Current temporal weight 0-1; lower = less relevant';

CREATE INDEX IF NOT EXISTS idx_edges_temporal
  ON public.edges (valid_from, valid_until)
  WHERE valid_from IS NOT NULL OR valid_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_edges_current
  ON public.edges (from_entity_id, to_entity_id)
  WHERE valid_until IS NULL;

-- ============================================================
-- 6. RELOAD POSTGREST SCHEMA CACHE
--    So the REST API picks up the new table + columns without a
--    manual restart.
-- ============================================================

NOTIFY pgrst, 'reload schema';

COMMIT;
