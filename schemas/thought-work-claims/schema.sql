-- ============================================================================
-- Thought work claims — a blackboard for parallel workers
-- ============================================================================
--
-- A claim table plus RPCs that let many independent workers process the same
-- pool of thoughts in parallel without two of them grabbing the same thought.
-- Useful for any community batch pipeline: consolidation workers, enrichment,
-- embedding backfills, scoring passes, wiki synthesis — anything that fans a
-- queue of thoughts out across multiple processes.
--
-- How a claim stays exclusive (the race guard):
--   The table's PRIMARY KEY is (thought_id, work_type). claim_thoughts() inserts
--   candidate rows with INSERT ... ON CONFLICT (thought_id, work_type) DO NOTHING
--   and returns only the rows it actually inserted. The unique index is the
--   arbiter: when two workers submit the same id at the same time, PostgreSQL
--   lets exactly one INSERT win the row and the other conflicts out silently.
--   The loser simply gets that id absent from its result set. No row is ever
--   handed to two workers, with no advisory locks or SELECT ... FOR UPDATE
--   needed — the constraint does the mutual exclusion atomically.
--
-- TTL + stale-claim reaping:
--   Each claim carries ttl_expires_at. If a worker crashes (SIGKILL, lost
--   network, OOM) it never releases its claims, which would otherwise strand
--   those thoughts forever. claim_thoughts() reaps inline on every call: before
--   inserting, it DELETEs claims for this work_type whose status is 'claimed'
--   and whose ttl_expires_at is in the past, freeing the (thought_id, work_type)
--   slot for a fresh claim. Pick a TTL comfortably longer than one unit of work.
--
-- ID contract: public.thoughts.id is UUID in the canonical Open Brain setup, so
-- thought_id is UUID REFERENCES public.thoughts(id). worker_id is free-form text.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and
-- CREATE OR REPLACE FUNCTION. Additive only — it never alters or drops a column
-- on public.thoughts. Every DELETE in this file is qualified with a WHERE
-- clause. Safe to re-run.
-- ============================================================================

-- ─── Claim table ────────────────────────────────────────────────────────────
-- One row per (thought, work_type). The composite primary key is what makes a
-- claim atomic and exclusive (see header). Terminal rows ('succeeded'/'failed')
-- are kept as a processing record and block re-claim until cleared.

CREATE TABLE IF NOT EXISTS public.thought_work_claims (
  thought_id     UUID NOT NULL REFERENCES public.thoughts(id) ON DELETE CASCADE,
  work_type      TEXT NOT NULL,
  worker_id      TEXT NOT NULL,
  claimed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ttl_expires_at TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'claimed',
  attempt_count  INT NOT NULL DEFAULT 1,
  last_error     TEXT,
  PRIMARY KEY (thought_id, work_type),
  CHECK (status IN ('claimed', 'succeeded', 'failed'))
);

-- The inline reaper (work_type + status + ttl_expires_at) and "what is this
-- work_type currently doing?" queries both use this index.
CREATE INDEX IF NOT EXISTS idx_twc_status_ttl
  ON public.thought_work_claims (work_type, status, ttl_expires_at);

-- "What is worker X currently holding?" — partial index keeps it small.
CREATE INDEX IF NOT EXISTS idx_twc_worker
  ON public.thought_work_claims (worker_id)
  WHERE status = 'claimed';

ALTER TABLE public.thought_work_claims ENABLE ROW LEVEL SECURITY;

-- The claim table is operational coordination state, not memory content. Only
-- the service role (server-side workers) touches it; no anon/authenticated
-- grants, and RLS denies everything else by default. The explicit REVOKE makes
-- the "service-role only" intent enforceable even if a default privilege or a
-- prior grant ever leaked access to anon/authenticated.
REVOKE ALL ON public.thought_work_claims FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.thought_work_claims TO service_role;

COMMENT ON TABLE public.thought_work_claims IS
  'Blackboard claim table for parallel workers. One row per (thought, work_type).';
COMMENT ON COLUMN public.thought_work_claims.work_type IS
  'Lowercase snake_case work kind, e.g. enrichment, consolidation, embedding_backfill.';
COMMENT ON COLUMN public.thought_work_claims.worker_id IS
  'Free-form worker identity. Convention: <work_type>-<NN>, e.g. enrichment-01.';

-- ─── Claim RPC ──────────────────────────────────────────────────────────────
-- Accepts candidate thought ids. Reaps stale claims for this work_type first
-- (inline garbage collection), then inserts new claim rows. Returns the subset
-- that was actually claimed (the winners, when workers race for the same ids).

CREATE OR REPLACE FUNCTION public.claim_thoughts(
  p_thought_ids   UUID[],
  p_work_type     TEXT,
  p_worker_id     TEXT,
  p_ttl_seconds   INT DEFAULT 900
) RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Inline stale-claim reaper: release claims whose TTL has passed. We DELETE
  -- rather than UPDATE so the (thought_id, work_type) primary-key slot opens up
  -- for a fresh claim. Scoped to this work_type and qualified by status + TTL.
  DELETE FROM public.thought_work_claims WHERE work_type = p_work_type
      AND status        = 'claimed'
      AND ttl_expires_at < now();

  -- Atomic insert-or-skip. ON CONFLICT DO NOTHING means the loser of a race
  -- gets an empty RETURNING for that id. Terminal states ('succeeded',
  -- 'failed') also block re-claim until explicitly cleared.
  RETURN QUERY
    INSERT INTO public.thought_work_claims (
      thought_id, work_type, worker_id, ttl_expires_at, status, attempt_count
    )
    SELECT
      t_id,
      p_work_type,
      p_worker_id,
      now() + make_interval(secs => p_ttl_seconds),
      'claimed',
      1
    FROM unnest(p_thought_ids) AS t_id
    ON CONFLICT (thought_id, work_type) DO NOTHING
    RETURNING thought_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_thoughts(UUID[], TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_thoughts(UUID[], TEXT, TEXT, INT) TO service_role;

COMMENT ON FUNCTION public.claim_thoughts IS
  'Atomically claim a batch of thoughts for a work_type. Reaps stale claims inline. Returns the subset actually claimed.';

-- ─── Release RPC ────────────────────────────────────────────────────────────
-- Terminal status update for a single claim. Only the holding worker can
-- release. Returns true if a row was updated (false = someone else holds it,
-- the TTL already reaped it, or it was never claimed).

CREATE OR REPLACE FUNCTION public.release_thought(
  p_thought_id UUID,
  p_work_type  TEXT,
  p_worker_id  TEXT,
  p_status     TEXT,
  p_error      TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  IF p_status NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'release_thought: invalid status %, must be succeeded or failed', p_status;
  END IF;

  UPDATE public.thought_work_claims
    SET status         = p_status,
        last_error     = p_error,
        ttl_expires_at = now()   -- terminal: TTL no longer significant
    WHERE thought_id = p_thought_id
      AND work_type  = p_work_type
      AND worker_id  = p_worker_id
      AND status     = 'claimed';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.release_thought(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_thought(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.release_thought IS
  'Terminal release for a single claim. Only the holding worker can release. Returns true if updated.';

-- ─── Bulk release (clean shutdown) ──────────────────────────────────────────
-- When a worker receives SIGINT and wants to drop its unprocessed claims, it
-- calls this to DELETE (not mark failed) its still-claimed rows so they become
-- immediately claimable by another worker. Returns how many rows were freed.

CREATE OR REPLACE FUNCTION public.release_claims_for_worker(
  p_work_type TEXT,
  p_worker_id TEXT
) RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM public.thought_work_claims WHERE work_type = p_work_type
      AND worker_id = p_worker_id
      AND status    = 'claimed';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.release_claims_for_worker(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_claims_for_worker(TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.release_claims_for_worker IS
  'Clean-shutdown helper: DELETE a worker''s still-claimed rows so other workers can reclaim them.';

-- Make the new table and RPCs visible to PostgREST immediately.
NOTIFY pgrst, 'reload schema';
