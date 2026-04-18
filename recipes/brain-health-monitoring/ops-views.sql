-- Operational Monitoring and Brain Health Views
-- Provides SQL views for monitoring source volumes, enrichment gaps,
-- ingestion pipeline health, entity extraction queue, and graph coverage.
-- Safe to run multiple times (CREATE OR REPLACE).
--
-- Required: Enhanced thoughts schema (schemas/enhanced-thoughts)
-- Optional: Smart ingest schema (schemas/smart-ingest) for the ingestion summary view
-- Optional: Entity extraction schema (schemas/entity-extraction) for queue and
--           graph coverage views
-- Views 6-8 are wrapped in `to_regclass` guards, so running this file on a
-- stock install (only enhanced-thoughts) creates views 1-5 cleanly and emits
-- a NOTICE for each skipped optional view.

-- ============================================================
-- 1. SOURCE VOLUME (24h)
--    How many thoughts arrived from each source in the last day.
--    Quick pulse check — if a source goes silent, investigate.
-- ============================================================

CREATE OR REPLACE VIEW public.ops_source_volume_24h AS
SELECT
  coalesce(source_type, 'unknown') AS source,
  count(*)::bigint AS thoughts_24h
FROM public.thoughts
WHERE created_at >= now() - interval '24 hours'
GROUP BY 1
ORDER BY thoughts_24h DESC;

-- ============================================================
-- 2. RECENT THOUGHTS WITH SOURCE
--    Last N thoughts with source, type, topics, and preview.
--    Useful for spot-checking what's flowing in.
-- ============================================================

CREATE OR REPLACE VIEW public.ops_recent_thoughts AS
SELECT
  id,
  created_at,
  coalesce(type, 'unknown') AS type,
  coalesce(source_type, 'unknown') AS source,
  importance,
  sensitivity_tier,
  enriched,
  left(content, 180) AS preview
FROM public.thoughts
ORDER BY created_at DESC;

-- ============================================================
-- 3. ENRICHMENT GAPS
--    Thoughts that haven't been enriched yet. If this grows,
--    the enrichment pipeline may be stalled or misconfigured.
-- ============================================================

CREATE OR REPLACE VIEW public.ops_enrichment_gaps AS
SELECT
  id,
  created_at,
  coalesce(type, 'unknown') AS type,
  coalesce(source_type, 'unknown') AS source,
  left(content, 180) AS preview
FROM public.thoughts
WHERE enriched IS NOT TRUE
ORDER BY created_at DESC;

-- ============================================================
-- 4. TYPE DISTRIBUTION
--    How thoughts are distributed across types.
--    Helps spot classification drift or misconfigured sources.
-- ============================================================

CREATE OR REPLACE VIEW public.ops_type_distribution AS
SELECT
  coalesce(type, 'unclassified') AS type,
  count(*)::bigint AS total,
  count(*) FILTER (WHERE created_at >= now() - interval '7 days')::bigint AS last_7d,
  count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::bigint AS last_24h
FROM public.thoughts
GROUP BY 1
ORDER BY total DESC;

-- ============================================================
-- 5. SENSITIVITY DISTRIBUTION
--    How thoughts break down by sensitivity tier.
--    A sudden spike in "restricted" warrants investigation.
-- ============================================================

CREATE OR REPLACE VIEW public.ops_sensitivity_distribution AS
SELECT
  coalesce(sensitivity_tier, 'standard') AS tier,
  count(*)::bigint AS total
FROM public.thoughts
GROUP BY 1
ORDER BY total DESC;

-- ============================================================
-- 6. INGESTION JOB SUMMARY (requires smart-ingest schema)
--    Status breakdown of ingestion jobs. Healthy brains should
--    show mostly "complete" with few "failed".
--    Guarded: only installed if public.ingestion_jobs exists.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.ingestion_jobs') IS NOT NULL THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW public.ops_ingestion_summary AS
      SELECT
        status,
        count(*)::bigint AS job_count,
        sum(added_count)::bigint AS total_added,
        sum(skipped_count)::bigint AS total_skipped,
        max(completed_at) AS last_completed
      FROM public.ingestion_jobs
      GROUP BY status
      ORDER BY job_count DESC
    $v$;
    EXECUTE 'GRANT SELECT ON public.ops_ingestion_summary TO service_role';
  ELSE
    RAISE NOTICE 'skipping ops_ingestion_summary -- public.ingestion_jobs not found (install schemas/smart-ingest)';
  END IF;
END$$;

-- ============================================================
-- 7. STALLED ENTITY QUEUE (requires entity-extraction schema)
--    Queue items stuck in "processing" for more than 10 minutes,
--    or items that have failed repeatedly.
--    Guarded: only installed if public.entity_extraction_queue exists.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.entity_extraction_queue') IS NOT NULL THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW public.ops_stalled_entity_queue AS
      SELECT
        thought_id,
        status,
        attempt_count,
        last_error,
        started_at,
        queued_at
      FROM public.entity_extraction_queue
      WHERE (status = 'processing' AND started_at < now() - interval '10 minutes')
         OR (status = 'failed')
      ORDER BY queued_at DESC
    $v$;
    EXECUTE 'GRANT SELECT ON public.ops_stalled_entity_queue TO service_role';
  ELSE
    RAISE NOTICE 'skipping ops_stalled_entity_queue -- public.entity_extraction_queue not found (install schemas/entity-extraction)';
  END IF;
END$$;

-- ============================================================
-- 8. GRAPH COVERAGE (requires entity-extraction schema)
--    How many thoughts have been processed for entity extraction
--    vs how many are still pending.
--    Guarded: only installed if public.entity_extraction_queue exists.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.entity_extraction_queue') IS NOT NULL THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW public.ops_graph_coverage AS
      SELECT
        count(*) FILTER (WHERE status = 'complete')::bigint AS extracted,
        count(*) FILTER (WHERE status = 'pending')::bigint AS pending,
        count(*) FILTER (WHERE status = 'processing')::bigint AS processing,
        count(*) FILTER (WHERE status = 'failed')::bigint AS failed,
        count(*)::bigint AS total_queued,
        CASE
          WHEN count(*) > 0
          THEN round(100.0 * count(*) FILTER (WHERE status = 'complete') / count(*), 1)
          ELSE 0
        END AS coverage_pct
      FROM public.entity_extraction_queue
    $v$;
    EXECUTE 'GRANT SELECT ON public.ops_graph_coverage TO service_role';
  ELSE
    RAISE NOTICE 'skipping ops_graph_coverage -- public.entity_extraction_queue not found (install schemas/entity-extraction)';
  END IF;
END$$;

-- ============================================================
-- 9. GRANTS (for always-installed views 1-5)
--    Views 6-8 are granted inside their guarded DO blocks above
--    so grants only run when the view was actually created.
-- ============================================================

GRANT SELECT ON public.ops_source_volume_24h TO service_role;
GRANT SELECT ON public.ops_recent_thoughts TO service_role;
GRANT SELECT ON public.ops_enrichment_gaps TO service_role;
GRANT SELECT ON public.ops_type_distribution TO service_role;
GRANT SELECT ON public.ops_sensitivity_distribution TO service_role;

NOTIFY pgrst, 'reload schema';
