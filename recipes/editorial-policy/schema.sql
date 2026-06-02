-- ============================================================
-- Auditor schema additions for Open Brain
--
-- Adds one helper RPC and one partial index. The audit_report
-- type is just metadata.type='audit_report' on the existing
-- thoughts table — no new tables needed.
--
-- Run this in your Supabase SQL Editor as a one-time setup.
-- ============================================================

-- 1) Helper: fetch the most recent N audit reports.
--    Used by the auditor function to build longitudinal context (R8.3).
CREATE OR REPLACE FUNCTION public.get_recent_audit_reports(p_limit int DEFAULT 4)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, content, metadata, created_at
  FROM public.thoughts
  WHERE metadata->>'type' = 'audit_report'
  ORDER BY created_at DESC
  LIMIT GREATEST(p_limit, 1);
$$;

-- 2) Partial index for fast filtering by audit_report type.
--    Cheap because there are at most ~52/year.
CREATE INDEX IF NOT EXISTS idx_thoughts_audit_report
  ON public.thoughts ((metadata->>'type'))
  WHERE metadata->>'type' = 'audit_report';

-- 3) Verify:
--    SELECT * FROM public.get_recent_audit_reports(4);
