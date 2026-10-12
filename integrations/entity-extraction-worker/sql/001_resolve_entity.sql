-- resolve_entity: dedupe entities on normalized_name ALONE.
--
-- The worker's upsertEntity() calls this RPC instead of upserting on the
-- schema's original UNIQUE (entity_type, normalized_name). That composite key
-- let the same entity split into several rows whenever the LLM assigned an
-- inconsistent type across mentions ("Acme" as organization, then company,
-- then product). Keying on normalized_name alone keeps one row per entity;
-- the first-seen type is kept and later mentions only bump the timestamps.
--
-- Idempotent: safe to re-run. Apply with
--   supabase db query --linked -f /ABS/PATH/TO/001_resolve_entity.sql
-- or paste into the SQL editor.

-- 1. Pre-flight. A unique index on normalized_name cannot be created while
--    the same name exists under two types. Refuse with guidance rather than
--    merging rows silently: merging must also repoint thought_entities and
--    edges, which the merge_entities MCP tool (enhanced-mcp) and the
--    entity-near-dupe-review recipe already do correctly.
DO $$
DECLARE
  v_dupes integer;
BEGIN
  SELECT count(*) INTO v_dupes
  FROM (
    SELECT normalized_name
    FROM public.entities
    GROUP BY normalized_name
    HAVING count(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      '% entity name(s) exist under more than one entity_type. Merge them first (merge_entities tool or recipes/entity-near-dupe-review), then re-run this file. To list them: SELECT normalized_name, array_agg(entity_type) FROM public.entities GROUP BY 1 HAVING count(*) > 1;',
      v_dupes;
  END IF;
END
$$;

-- 2. Swap the uniqueness key: normalized_name alone replaces the composite.
--    The composite constraint is implied by the new one, so it is dropped to
--    avoid maintaining a redundant index.
ALTER TABLE public.entities
  DROP CONSTRAINT IF EXISTS entities_entity_type_normalized_name_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.entities'::regclass
      AND conname = 'entities_normalized_name_key'
  ) THEN
    ALTER TABLE public.entities
      ADD CONSTRAINT entities_normalized_name_key UNIQUE (normalized_name);
  END IF;
END
$$;

-- 3. The RPC itself. Returns the surviving row's id either way.
CREATE OR REPLACE FUNCTION public.resolve_entity(
  p_name text,
  p_normalized text,
  p_type text
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.entities (entity_type, canonical_name, normalized_name, last_seen_at, updated_at)
  VALUES (p_type, p_name, p_normalized, now(), now())
  ON CONFLICT (normalized_name) DO UPDATE
    SET last_seen_at = now(), updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
