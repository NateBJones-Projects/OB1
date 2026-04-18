-- Provenance Chains — Derivation tracking for Open Brain thoughts
--
-- Adds four columns plus two helper SQL functions so Open Brain can answer
-- "show me the atomic thoughts that produced this derived artifact" and
-- "what downstream artifacts cite this atomic thought?" at the database layer.
--
-- Columns added to public.thoughts:
--   derived_from         JSONB   — array of parent thought IDs (as JSON strings,
--                                  since public.thoughts.id is UUID in the
--                                  canonical Open Brain setup). NULL for primary
--                                  thoughts.
--   derivation_method    TEXT    — how the thought was derived. Currently
--                                  constrained to 'synthesis' or NULL.
--   derivation_layer     TEXT    — 'primary' (atomic capture) or 'derived'
--                                  (regenerable artifact). Defaults to 'primary'.
--   supersedes           UUID    — optional pointer to a prior thought this one
--                                  replaces (e.g., an updated digest).
--
-- Helper functions:
--   trace_provenance(p_thought_id UUID, p_max_depth INT)
--     Walks derived_from upward and returns a flat rowset of ancestors with
--     their depth, cycle flag, and sensitivity tier. Caller can build a tree.
--
--   find_derivatives(p_thought_id UUID, p_limit INT)
--     Reverse lookup — returns rows whose derived_from contains p_thought_id.
--
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE).
-- See README.md for rollback instructions.

-- ============================================================
-- 1. COLUMNS
-- ============================================================

ALTER TABLE public.thoughts
  ADD COLUMN IF NOT EXISTS derived_from JSONB;

ALTER TABLE public.thoughts
  ADD COLUMN IF NOT EXISTS derivation_method TEXT;

ALTER TABLE public.thoughts
  ADD COLUMN IF NOT EXISTS derivation_layer TEXT NOT NULL DEFAULT 'primary';

ALTER TABLE public.thoughts
  ADD COLUMN IF NOT EXISTS supersedes UUID REFERENCES public.thoughts(id) ON DELETE SET NULL;

-- ============================================================
-- 2. CONSTRAINTS (drop-then-add for idempotency)
-- ============================================================

ALTER TABLE public.thoughts
  DROP CONSTRAINT IF EXISTS thoughts_derivation_layer_check;
ALTER TABLE public.thoughts
  ADD CONSTRAINT thoughts_derivation_layer_check
  CHECK (derivation_layer IN ('primary', 'derived'));

ALTER TABLE public.thoughts
  DROP CONSTRAINT IF EXISTS thoughts_derivation_method_check;
ALTER TABLE public.thoughts
  ADD CONSTRAINT thoughts_derivation_method_check
  CHECK (derivation_method IS NULL OR derivation_method = 'synthesis');

-- derived_from must be NULL or a JSON array. Element-shape validation is
-- enforced in application code (MCP tool / backfill) because pg check
-- constraints can't loop over JSONB array elements cleanly.
ALTER TABLE public.thoughts
  DROP CONSTRAINT IF EXISTS thoughts_derived_from_is_array_check;
ALTER TABLE public.thoughts
  ADD CONSTRAINT thoughts_derived_from_is_array_check
  CHECK (derived_from IS NULL OR jsonb_typeof(derived_from) = 'array');

-- ============================================================
-- 3. INDEXES
-- ============================================================

-- GIN index for "find_derivatives" containment queries (derived_from @> '["<uuid>"]')
CREATE INDEX IF NOT EXISTS idx_thoughts_derived_from
  ON public.thoughts USING gin (derived_from);

-- Btree on layer for "give me all derived artifacts" browse queries
CREATE INDEX IF NOT EXISTS idx_thoughts_derivation_layer
  ON public.thoughts (derivation_layer);

-- Partial index on supersedes — most rows are NULL, only track the active ones
CREATE INDEX IF NOT EXISTS idx_thoughts_supersedes
  ON public.thoughts (supersedes)
  WHERE supersedes IS NOT NULL;

-- ============================================================
-- 4. COLUMN COMMENTS (discoverable via \d+ thoughts)
-- ============================================================

COMMENT ON COLUMN public.thoughts.derived_from IS
  'JSONB array of parent thought IDs (UUID strings). NULL for primary thoughts. Use @> for containment lookup.';
COMMENT ON COLUMN public.thoughts.derivation_method IS
  'How this thought was derived. Currently: ''synthesis'' or NULL. Extend the check constraint to add methods.';
COMMENT ON COLUMN public.thoughts.derivation_layer IS
  '''primary'' (atomic capture) or ''derived'' (regenerable artifact). Defaults to ''primary''.';
COMMENT ON COLUMN public.thoughts.supersedes IS
  'UUID of the prior thought this one replaces, e.g., a regenerated digest. NULL when nothing is superseded.';

-- ============================================================
-- 5. HELPER: trace_provenance
--    Walks derived_from upward (toward ancestors) and returns a flat rowset
--    of each visited thought with its depth. Cycles terminate at the first
--    re-visit and are flagged. Restricted ancestors return with content=NULL
--    and a flag so callers can redact downstream.
-- ============================================================

CREATE OR REPLACE FUNCTION public.trace_provenance(
  p_thought_id UUID,
  p_max_depth INT DEFAULT 3,
  p_node_cap INT DEFAULT 250
)
RETURNS TABLE (
  thought_id UUID,
  depth INT,
  parent_id UUID,
  content TEXT,
  type TEXT,
  source_type TEXT,
  derivation_method TEXT,
  derivation_layer TEXT,
  sensitivity_tier TEXT,
  created_at TIMESTAMPTZ,
  cycle BOOLEAN,
  restricted BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_depth INT := GREATEST(1, LEAST(COALESCE(p_max_depth, 3), 10));
  v_node_cap INT := GREATEST(1, LEAST(COALESCE(p_node_cap, 250), 2000));
BEGIN
  IF p_thought_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH RECURSIVE walk AS (
    -- Seed: the root thought at depth 0.
    SELECT
      t.id          AS thought_id,
      0             AS depth,
      NULL::uuid    AS parent_id,
      t.content,
      t.type,
      t.source_type,
      t.derivation_method,
      t.derivation_layer,
      t.sensitivity_tier,
      t.created_at,
      t.derived_from,
      ARRAY[t.id]   AS visited,
      false         AS cycle
    FROM public.thoughts t
    WHERE t.id = p_thought_id

    UNION ALL

    -- Step: for each walked row, emit one row per parent id. Stop at depth,
    -- cycles, and the node cap (LIMIT on the outer query below).
    SELECT
      parent.id,
      w.depth + 1,
      w.thought_id,
      parent.content,
      parent.type,
      parent.source_type,
      parent.derivation_method,
      parent.derivation_layer,
      parent.sensitivity_tier,
      parent.created_at,
      parent.derived_from,
      w.visited || parent.id,
      parent.id = ANY(w.visited)
    FROM walk w
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(w.derived_from, '[]'::jsonb)) AS p(parent_id_text)
    JOIN public.thoughts parent ON parent.id = p.parent_id_text::uuid
    WHERE w.depth < v_max_depth
      AND NOT w.cycle
  )
  SELECT
    walk.thought_id,
    walk.depth,
    walk.parent_id,
    CASE WHEN walk.sensitivity_tier = 'restricted' THEN NULL ELSE walk.content END AS content,
    walk.type,
    walk.source_type,
    walk.derivation_method,
    walk.derivation_layer,
    walk.sensitivity_tier,
    walk.created_at,
    walk.cycle,
    (walk.sensitivity_tier = 'restricted') AS restricted
  FROM walk
  ORDER BY depth ASC, thought_id ASC
  LIMIT v_node_cap;
END;
$$;

GRANT EXECUTE ON FUNCTION public.trace_provenance(UUID, INT, INT)
  TO authenticated, service_role;

-- ============================================================
-- 6. HELPER: find_derivatives
--    Single-level reverse lookup — "what thoughts were derived from this one?"
--    Uses the GIN index on derived_from via the @> containment operator.
-- ============================================================

CREATE OR REPLACE FUNCTION public.find_derivatives(
  p_thought_id UUID,
  p_limit INT DEFAULT 100,
  p_exclude_restricted BOOLEAN DEFAULT true
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  type TEXT,
  source_type TEXT,
  derivation_method TEXT,
  derivation_layer TEXT,
  sensitivity_tier TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_needle JSONB;
BEGIN
  IF p_thought_id IS NULL THEN
    RETURN;
  END IF;

  -- Build a JSONB array containing the UUID as a JSON string, so the GIN
  -- containment operator can use idx_thoughts_derived_from.
  v_needle := jsonb_build_array(p_thought_id::text);

  RETURN QUERY
  SELECT
    t.id,
    t.content,
    t.type,
    t.source_type,
    t.derivation_method,
    t.derivation_layer,
    t.sensitivity_tier,
    t.created_at
  FROM public.thoughts t
  WHERE t.derived_from @> v_needle
    AND (NOT p_exclude_restricted OR t.sensitivity_tier IS DISTINCT FROM 'restricted')
  ORDER BY t.created_at DESC
  LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_derivatives(UUID, INT, BOOLEAN)
  TO authenticated, service_role;

-- ============================================================
-- 7. RELOAD PostgREST SCHEMA CACHE
-- ============================================================

NOTIFY pgrst, 'reload schema';
