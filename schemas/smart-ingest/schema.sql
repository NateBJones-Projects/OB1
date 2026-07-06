-- Smart Ingest Pipeline Tables
-- Adds ingestion_jobs and ingestion_items tables for tracking
-- the extract-deduplicate-execute lifecycle of bulk text ingestion.
-- Safe to run multiple times (fully idempotent).

-- ============================================================
-- 1. INGESTION JOBS
--    One row per ingest invocation. Tracks status through:
--    pending -> extracting -> dry_run_complete -> executing -> complete
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ingestion_jobs (
  id bigserial PRIMARY KEY,
  source_label text,
  input_hash text NOT NULL UNIQUE,
  input_length int,
  status text DEFAULT 'pending',        -- pending, extracting, dry_run_complete, executing, complete, failed
  extracted_count int DEFAULT 0,
  added_count int DEFAULT 0,
  skipped_count int DEFAULT 0,
  appended_count int DEFAULT 0,
  revised_count int DEFAULT 0,
  error_message text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- ============================================================
-- 2. INGESTION ITEMS
--    Individual extracted thoughts within a job. Each item gets
--    a reconciliation action (add, skip, append_evidence,
--    create_revision) during dedup, then executes independently.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ingestion_items (
  id bigserial PRIMARY KEY,
  job_id bigint REFERENCES public.ingestion_jobs(id) ON DELETE CASCADE,
  extracted_content text NOT NULL,
  action text NOT NULL DEFAULT 'pending',   -- pending, add, skip, append_evidence, create_revision
  status text NOT NULL DEFAULT 'pending',   -- pending, ready, executed, failed
  reason text,
  matched_thought_id bigint,
  similarity_score numeric(5,4),
  result_thought_id bigint,
  error_message text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Index for fast job-item lookups
CREATE INDEX IF NOT EXISTS ingestion_items_job_idx
  ON public.ingestion_items(job_id);

-- Partial indexes that keep the worker's hot path ("next pending job"
-- and "next pending/ready item") O(small) even as the historical tail
-- of completed rows grows unbounded.
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_pending
  ON public.ingestion_jobs (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ingestion_items_pending
  ON public.ingestion_items (job_id, created_at)
  WHERE status IN ('pending', 'ready');

-- ============================================================
-- 2a. MULTI-TENANT SCOPING (optional)
--     Add a nullable user_id to both tables so shared (multi-tenant)
--     deployments can isolate ingestion history per user. Stock
--     single-tenant OB1 setups can leave user_id NULL on every row.
--
--     The FK to auth.users is added only when Supabase's auth schema
--     exists, so these statements are safe to run on non-Supabase
--     Postgres instances too.
-- ============================================================

ALTER TABLE public.ingestion_jobs
  ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.ingestion_items
  ADD COLUMN IF NOT EXISTS user_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'auth'
  ) AND EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'auth' AND c.relname = 'users'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'ingestion_jobs_user_id_fkey'
    ) THEN
      ALTER TABLE public.ingestion_jobs
        ADD CONSTRAINT ingestion_jobs_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'ingestion_items_user_id_fkey'
    ) THEN
      ALTER TABLE public.ingestion_items
        ADD CONSTRAINT ingestion_items_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
  END IF;
END
$$;

-- ============================================================
-- 3. APPEND THOUGHT EVIDENCE RPC
--    Appends an evidence entry to thoughts.metadata.evidence[].
--    Idempotent via SHA256 identity of (source_label + excerpt + thought_id).
--    Returns { thought_id, evidence_count, action: 'appended' | 'already_exists' }.
-- ============================================================

CREATE OR REPLACE FUNCTION public.append_thought_evidence(
  p_thought_id bigint,
  p_evidence jsonb  -- {source, extracted_at, excerpt, source_label}
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identity text;
  v_current_evidence jsonb;
  v_entry jsonb;
  v_count int;
BEGIN
  -- Compute a stable identity for this evidence entry
  v_identity := encode(
    sha256(
      convert_to(
        coalesce(p_evidence->>'source_label', '') ||
        coalesce(p_evidence->>'excerpt', '') ||
        p_thought_id::text,
        'UTF8'
      )
    ),
    'hex'
  );

  -- Fetch current evidence array
  SELECT coalesce(metadata->'evidence', '[]'::jsonb)
    INTO v_current_evidence
    FROM public.thoughts
   WHERE id = p_thought_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'thought % not found', p_thought_id;
  END IF;

  -- Check for duplicate by scanning existing identities
  FOR v_entry IN SELECT jsonb_array_elements(v_current_evidence)
  LOOP
    IF v_entry->>'_identity' = v_identity THEN
      RETURN jsonb_build_object(
        'thought_id', p_thought_id,
        'evidence_count', jsonb_array_length(v_current_evidence),
        'action', 'already_exists'
      );
    END IF;
  END LOOP;

  -- Append new evidence entry with identity tag
  UPDATE public.thoughts
     SET metadata = jsonb_set(
           coalesce(metadata, '{}'::jsonb),
           '{evidence}',
           v_current_evidence || jsonb_build_object(
             '_identity', v_identity,
             'source', p_evidence->'source',
             'extracted_at', p_evidence->'extracted_at',
             'excerpt', p_evidence->'excerpt',
             'source_label', p_evidence->'source_label'
           )
         )
   WHERE id = p_thought_id;

  v_count := jsonb_array_length(v_current_evidence) + 1;

  RETURN jsonb_build_object(
    'thought_id', p_thought_id,
    'evidence_count', v_count,
    'action', 'appended'
  );
END;
$$;

-- ============================================================
-- 4. GRANTS
-- ============================================================

GRANT ALL ON TABLE public.ingestion_jobs TO service_role;
GRANT ALL ON TABLE public.ingestion_items TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ingestion_jobs_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ingestion_items_id_seq TO service_role;
REVOKE EXECUTE ON FUNCTION public.append_thought_evidence(bigint, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.append_thought_evidence(bigint, jsonb)
  TO service_role;

-- ============================================================
-- 5. ROW LEVEL SECURITY
--    Belt-and-suspenders defence against anon/authenticated roles
--    getting table-level privileges at the schema layer. service_role
--    bypasses RLS automatically, so worker writes still succeed.
--    authenticated users can read their own rows once user_id is
--    populated (see section 2a). The user-scoped SELECT policies are
--    only created when Supabase's auth.uid() exists; on non-Supabase
--    Postgres, RLS is still enabled but no authenticated policy is
--    created (deny-by-default for anyone except service_role).
-- ============================================================

ALTER TABLE public.ingestion_jobs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_items ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if present so this file stays idempotent.
DROP POLICY IF EXISTS ingestion_jobs_service_all  ON public.ingestion_jobs;
DROP POLICY IF EXISTS ingestion_jobs_user_select  ON public.ingestion_jobs;
DROP POLICY IF EXISTS ingestion_items_service_all ON public.ingestion_items;
DROP POLICY IF EXISTS ingestion_items_user_select ON public.ingestion_items;

CREATE POLICY ingestion_jobs_service_all
  ON public.ingestion_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY ingestion_items_service_all
  ON public.ingestion_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated SELECT policies depend on auth.uid(); only create them
-- on Supabase (where the auth schema ships the uid() function).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY ingestion_jobs_user_select
        ON public.ingestion_jobs
        FOR SELECT
        TO authenticated
        USING (user_id IS NOT NULL AND user_id = auth.uid())
    $policy$;

    EXECUTE $policy$
      CREATE POLICY ingestion_items_user_select
        ON public.ingestion_items
        FOR SELECT
        TO authenticated
        USING (user_id IS NOT NULL AND user_id = auth.uid())
    $policy$;
  END IF;
END
$$;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
