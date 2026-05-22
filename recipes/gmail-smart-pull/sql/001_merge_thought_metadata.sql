-- merge_thought_metadata: shallow-merge a JSONB patch into a thought's
-- metadata without touching any other columns. Useful for targeted per-row
-- metadata patches that should not re-trigger a full upsert pipeline
-- (embedding regen, enrichment, fingerprint recompute).
--
-- Shallow merge only: `metadata || p_patch` replaces top-level keys. Callers
-- that want deep merges must compose the patch themselves.
--
-- This migration assumes Open Brain's canonical thoughts table is named
-- `public.brain_thoughts` with a `metadata jsonb` column. If your deployment
-- uses a different name (e.g. `public.thoughts`), adjust the identifier in
-- the UPDATE below before running.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + GRANT EXECUTE are safe to re-run.

CREATE OR REPLACE FUNCTION public.merge_thought_metadata(
  p_id bigint,
  p_patch jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_patch IS NULL OR p_patch = '{}'::jsonb THEN
    RETURN false;
  END IF;
  UPDATE public.brain_thoughts
     SET metadata = COALESCE(metadata, '{}'::jsonb) || p_patch,
         updated_at = now()
   WHERE id = p_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_thought_metadata(bigint, jsonb) TO service_role;

COMMENT ON FUNCTION public.merge_thought_metadata(bigint, jsonb) IS
  'Shallow-merge p_patch into the thought''s metadata JSONB. Returns true if a row was updated. Used by targeted metadata backfills (e.g. gmail-smart-pull recipe).';
