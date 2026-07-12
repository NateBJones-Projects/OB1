-- ============================================================
-- entity-near-dupe-review: surface fuzzy entity duplicates + a safe,
-- human-confirmed merge primitive.
-- Run this in your Supabase SQL Editor (one-time setup, safe to re-run).
--
-- The entity-extraction worker dedupes on normalized_name, so exact variants
-- collapse automatically. What it CANNOT catch: spacing/case/hyphen/domain
-- variants ("Open Brain" vs "open-brain"), acronym expansions ("PAE" vs
-- "Prostate Artery Embolization (PAE)"), and username/proper-name pairs
-- ("NateBJones" vs "Nate B Jones"). These accumulate as separate entity rows
-- and fragment the graph — a person's edges split across two nodes.
--
-- This installs a REVIEW view (candidates only) and a MERGE function. Merges
-- are NEVER automatic: near-dupe detection has real false positives — "C" and
-- "C++" are 100% trigram-similar and compact-equal but are different entities.
-- Pair with the `merging-entities` skill (skills/merging-entities) for the
-- human-in-the-loop workflow every connected client should follow.
--
-- Requires: schemas/entity-extraction (entities, edges, thought_entities,
--           consolidation_log). pg_trgm is created here.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_entities_normalized_trgm
  ON public.entities USING gin (normalized_name gin_trgm_ops);

-- Candidate pairs to REVIEW (never auto-act on these):
--   compact_equal — identical after stripping non-alphanumerics (spacing,
--                   punctuation, case, hyphen, slash, domain-dot variants)
--   OR trigram similarity >= 0.6 (near variants, acronym expansions)
-- Ordered so the highest-confidence pairs (compact-equal, then most similar)
-- surface first. mentions_a/b help pick the survivor (usually the richer node).
CREATE OR REPLACE VIEW ops_entity_near_dupes AS
SELECT
  a.id AS id_a, a.canonical_name AS name_a, a.entity_type AS type_a,
  (SELECT count(*) FROM public.thought_entities te WHERE te.entity_id = a.id) AS mentions_a,
  b.id AS id_b, b.canonical_name AS name_b, b.entity_type AS type_b,
  (SELECT count(*) FROM public.thought_entities te WHERE te.entity_id = b.id) AS mentions_b,
  round(similarity(a.normalized_name, b.normalized_name)::numeric, 2) AS sim,
  regexp_replace(a.normalized_name, '[^a-z0-9]', '', 'g')
    = regexp_replace(b.normalized_name, '[^a-z0-9]', '', 'g') AS compact_equal
FROM public.entities a
JOIN public.entities b ON a.id < b.id
WHERE regexp_replace(a.normalized_name, '[^a-z0-9]', '', 'g')
        = regexp_replace(b.normalized_name, '[^a-z0-9]', '', 'g')
   OR (a.normalized_name % b.normalized_name
       AND similarity(a.normalized_name, b.normalized_name) >= 0.6)
ORDER BY compact_equal DESC, sim DESC;

COMMENT ON VIEW ops_entity_near_dupes IS
  'Fuzzy entity duplicate CANDIDATES for human review. Has false positives '
  '(e.g. C vs C++). Never auto-merge — use ops_merge_entities per confirmed pair.';

-- Human-confirmed merge: repoint thought_entities + edges from loser to
-- survivor with collision dedup, carry the loser name into survivor.aliases,
-- log to consolidation_log, then delete the loser. Idempotent-safe: raises
-- clearly on bad input rather than corrupting the graph.
CREATE OR REPLACE FUNCTION ops_merge_entities(
  p_survivor bigint, p_loser bigint, p_reason text DEFAULT 'near-dupe review'
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_loser_name text; v_mentions int; v_edges int;
BEGIN
  IF p_survivor = p_loser THEN
    RAISE EXCEPTION 'survivor and loser are the same entity (%).', p_survivor;
  END IF;
  SELECT canonical_name INTO v_loser_name FROM public.entities WHERE id = p_loser;
  IF v_loser_name IS NULL THEN
    RAISE EXCEPTION 'loser entity % not found', p_loser;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.entities WHERE id = p_survivor) THEN
    RAISE EXCEPTION 'survivor entity % not found', p_survivor;
  END IF;

  -- thought_entities: drop rows that would collide on the survivor, repoint rest
  DELETE FROM public.thought_entities te USING public.thought_entities k
  WHERE te.entity_id = p_loser AND k.entity_id = p_survivor
    AND k.thought_id = te.thought_id AND k.mention_role = te.mention_role;
  UPDATE public.thought_entities SET entity_id = p_survivor WHERE entity_id = p_loser;
  GET DIAGNOSTICS v_mentions = ROW_COUNT;

  -- edges: drop future self-loops, drop (from,to,relation) collisions, repoint rest
  DELETE FROM public.edges
   WHERE (from_entity_id = p_loser AND to_entity_id = p_survivor)
      OR (from_entity_id = p_survivor AND to_entity_id = p_loser);
  DELETE FROM public.edges e USING public.edges k
  WHERE e.from_entity_id = p_loser AND k.from_entity_id = p_survivor
    AND k.to_entity_id = e.to_entity_id AND k.relation = e.relation;
  DELETE FROM public.edges e USING public.edges k
  WHERE e.to_entity_id = p_loser AND k.to_entity_id = p_survivor
    AND k.from_entity_id = e.from_entity_id AND k.relation = e.relation;
  UPDATE public.edges SET from_entity_id = p_survivor WHERE from_entity_id = p_loser;
  UPDATE public.edges SET to_entity_id   = p_survivor WHERE to_entity_id   = p_loser;
  GET DIAGNOSTICS v_edges = ROW_COUNT;

  -- carry the loser's display name onto the survivor as an alias
  UPDATE public.entities
     SET aliases = COALESCE(aliases, '[]'::jsonb) || to_jsonb(v_loser_name),
         updated_at = now()
   WHERE id = p_survivor
     AND NOT COALESCE(aliases, '[]'::jsonb) ? v_loser_name;

  -- audit (entity ids are bigint; consolidation_log.survivor_id/loser_id are
  -- UUID for thought merges, so record entity ids inside details)
  INSERT INTO public.consolidation_log (operation, details)
  VALUES ('dedup_merge',
          jsonb_build_object('survivor_entity_id', p_survivor,
                             'loser_entity_id', p_loser,
                             'loser_name', v_loser_name,
                             'reason', p_reason));

  DELETE FROM public.entities WHERE id = p_loser;

  RETURN jsonb_build_object('survivor', p_survivor, 'merged', v_loser_name,
                            'mentions_repointed', v_mentions, 'edges_repointed', v_edges);
END $$;

COMMENT ON FUNCTION ops_merge_entities(bigint, bigint, text) IS
  'Merge loser entity into survivor: repoint mentions/edges (dedup collisions '
  'and self-loops), alias the loser name, log to consolidation_log, delete '
  'loser. Human-confirmed only — see the merging-entities skill.';

-- ============================================================
-- Verify + use:
--   SELECT * FROM ops_entity_near_dupes LIMIT 25;   -- review candidates
--   -- for a CONFIRMED pair (survivor first = the node to keep):
--   SELECT ops_merge_entities(<survivor_id>, <loser_id>, 'why');
--   -- integrity check after a merge session:
--   SELECT count(*) FROM public.thought_entities te
--     WHERE NOT EXISTS (SELECT 1 FROM public.entities e WHERE e.id = te.entity_id);  -- expect 0
--   SELECT * FROM public.consolidation_log WHERE operation='dedup_merge' ORDER BY created_at DESC LIMIT 10;
-- ============================================================
