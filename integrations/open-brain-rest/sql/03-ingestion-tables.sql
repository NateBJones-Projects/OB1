-- 03-ingestion-tables.sql
-- Creates the ingestion pipeline tables (jobs and items) and the
-- append_thought_evidence RPC for the smart-ingest workflow.

-- ── ingestion_jobs ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id BIGSERIAL PRIMARY KEY,
  source_label TEXT NOT NULL,
  raw_input TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'extracting', 'extracted', 'executing', 'complete', 'failed')),
  extracted_count INT DEFAULT 0,
  added_count INT DEFAULT 0,
  skipped_count INT DEFAULT 0,
  appended_count INT DEFAULT 0,
  revised_count INT DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON ingestion_jobs (status);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_created_at ON ingestion_jobs (created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ingestion_jobs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE ingestion_jobs_id_seq TO service_role;

-- ── ingestion_items ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingestion_items (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  type TEXT DEFAULT 'idea',
  fingerprint TEXT,
  action TEXT NOT NULL DEFAULT 'add'
    CHECK (action IN ('add', 'skip', 'create_revision', 'append_evidence')),
  reason TEXT,
  similarity NUMERIC(5,4),
  status TEXT NOT NULL DEFAULT 'pending',
  matched_thought_id BIGINT REFERENCES thoughts(serial_id),
  result_thought_id BIGINT REFERENCES thoughts(serial_id),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_items_job_id ON ingestion_items (job_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_items_status ON ingestion_items (status);
CREATE INDEX IF NOT EXISTS idx_ingestion_items_fingerprint ON ingestion_items (fingerprint);
CREATE INDEX IF NOT EXISTS idx_ingestion_items_action ON ingestion_items (action);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ingestion_items TO service_role;
GRANT USAGE, SELECT ON SEQUENCE ingestion_items_id_seq TO service_role;

-- ── append_thought_evidence RPC ─────────────────────────────────────
CREATE OR REPLACE FUNCTION append_thought_evidence(
  p_thought_id BIGINT,
  p_new_content TEXT,
  p_source_label TEXT DEFAULT 'smart-ingest'
)
RETURNS JSONB AS $$
DECLARE
  v_current TEXT;
  v_updated TEXT;
BEGIN
  SELECT content INTO v_current FROM thoughts WHERE serial_id = p_thought_id;

  IF v_current IS NULL THEN
    RETURN jsonb_build_object('error', 'thought not found');
  END IF;

  v_updated := v_current || E'\n\n--- Evidence from ' || p_source_label || ' ---\n' || p_new_content;

  UPDATE thoughts
  SET content = v_updated, updated_at = now()
  WHERE serial_id = p_thought_id;

  RETURN jsonb_build_object('thought_id', p_thought_id, 'action', 'appended');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
