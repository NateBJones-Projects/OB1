-- enrichment-worker / schema.sql
-- View = observability surface. RPC = the queue (predicate intentionally
-- duplicated in the RPC so FOR UPDATE targets the base table directly).

-- 1. What still needs enrichment (excludes rows stuck at max attempts).
CREATE OR REPLACE VIEW thoughts_needing_enrichment AS
SELECT
  id,
  created_at,
  source_type,
  COALESCE(metadata->>'enrichment_status', 'absent') AS enrichment_status,
  COALESCE((metadata->>'enrichment_attempts')::int, 0) AS enrichment_attempts
FROM thoughts
WHERE (
    metadata->>'enrichment_status' IS NULL
    OR metadata->>'enrichment_status' IN ('pending', 'fallback', 'skipped')
  )
  AND COALESCE((metadata->>'enrichment_attempts')::int, 0) < 3
  AND COALESCE(derivation_layer, 'primary') = 'primary'
  -- Synthesis artifacts (audit reports, briefings, wiki pages) carry a
  -- 'generator' key; they must never be re-classified. Writers also stamp
  -- status 'exempt' — this predicate is defense-in-depth.
  AND NOT (metadata ? 'generator');

COMMENT ON VIEW thoughts_needing_enrichment IS
  'Enrichment queue surface. ''skipped'' is included deliberately: skip_classification at capture time is a speed choice, not a never-enrich choice. A source wanting permanent exemption must use status ''exempt''. Derived-layer rows are excluded (never re-classify compiled artifacts).';

-- 2. Rows that gave up (surfaced by the weekly auditor; reset by clearing enrichment_attempts).
CREATE OR REPLACE VIEW thoughts_enrichment_stuck AS
SELECT id, created_at, source_type,
       metadata->>'enrichment_last_error' AS enrichment_last_error
FROM thoughts
WHERE COALESCE((metadata->>'enrichment_attempts')::int, 0) >= 3
  AND COALESCE(metadata->>'enrichment_status', '') <> 'complete'
  AND COALESCE(derivation_layer, 'primary') = 'primary';

COMMENT ON VIEW thoughts_enrichment_stuck IS
  'Rows that exhausted 3 enrichment attempts. Reset one with: UPDATE thoughts SET metadata = metadata - ''enrichment_attempts'' WHERE id = ''<uuid>'';';

-- 3. Atomic claim: FOR UPDATE SKIP LOCKED + 10-minute lease. Safe under
--    concurrent cron ticks, webhook single-id invokes, and the backfill loop.
CREATE OR REPLACE FUNCTION claim_thoughts_for_enrichment(
  p_batch int DEFAULT 20,
  p_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  source_type text,
  type text,
  needs_embedding boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE thoughts t
  SET metadata = COALESCE(t.metadata, '{}'::jsonb)
                 || jsonb_build_object('enrichment_claimed_at', now())
  WHERE t.id IN (
    SELECT c.id
    FROM thoughts c
    WHERE (
        c.metadata->>'enrichment_status' IS NULL
        OR c.metadata->>'enrichment_status' IN ('pending', 'fallback', 'skipped')
      )
      AND COALESCE((c.metadata->>'enrichment_attempts')::int, 0) < 3
      AND COALESCE(c.derivation_layer, 'primary') = 'primary'
      -- Synthesis artifacts carry a 'generator' key; never re-classify them
      -- (writers also stamp status 'exempt' — this is defense-in-depth).
      AND NOT (c.metadata ? 'generator')
      AND COALESCE((c.metadata->>'enrichment_claimed_at')::timestamptz,
                   'epoch'::timestamptz) < now() - interval '10 minutes'
      AND (p_id IS NULL OR c.id = p_id)
    ORDER BY c.created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_batch, 20), 25))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING t.id, t.content, t.metadata, t.source_type, t.type,
            (t.embedding IS NULL) AS needs_embedding;
$$;

REVOKE ALL ON FUNCTION claim_thoughts_for_enrichment(int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_thoughts_for_enrichment(int, uuid) TO service_role;
