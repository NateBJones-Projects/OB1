-- ============================================================
-- editorial-policy: mechanical hygiene layer (optional, recommended)
-- Run this in your Supabase SQL Editor (one-time setup, safe to re-run).
--
-- Installs read-only lint views plus a lint_hygiene_summary() function the
-- auditor calls BEFORE its LLM pass. The auditor then stores the counts in
-- metadata.hygiene on every audit_report and appends a human-readable
-- hygiene section to the report content. Hygiene never triggers Slack —
-- it is informational, following the same low-noise discipline as findings.
--
-- Everything is guarded: on a stock install without the enhanced-thoughts
-- schema, content-fingerprint dedup, or the entity-extraction schema, the
-- optional views are skipped and the summary reports what it can.
-- Without this file installed at all, the auditor still works (LLM-only) —
-- fetchHygiene() logs a warning and stores hygiene: null.
--
-- Adapted from recipes/lint-sweep views (Tier 1 SQL lint + Tier 2 graph lint).
-- ============================================================

-- ── Tier 1: thoughts-table lint (works on any install) ──────────────────────
-- Column shapes match recipes/lint-sweep/views.sql exactly where the
-- enhanced-thoughts columns exist, so CREATE OR REPLACE upgrades cleanly over
-- a prior lint-sweep install (REPLACE cannot drop or reorder view columns).

DO $$
DECLARE has_enhanced boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='thoughts'
                   AND column_name='importance') INTO has_enhanced;
  IF has_enhanced THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW lint_orphans_by_tag AS
      SELECT id, created_at, importance, left(content,160) AS preview, source_type
      FROM public.thoughts
      WHERE COALESCE(jsonb_array_length(metadata->'topics'),0)=0
        AND COALESCE(jsonb_array_length(metadata->'tags'),0)=0
        AND COALESCE(jsonb_array_length(metadata->'people'),0)=0
      ORDER BY id DESC;

      CREATE OR REPLACE VIEW lint_empty_content AS
      SELECT id, created_at, source_type, importance
      FROM public.thoughts
      WHERE content IS NULL OR btrim(content)=''
      ORDER BY id DESC;
    $v$;
  ELSE
    EXECUTE $v$
      CREATE OR REPLACE VIEW lint_orphans_by_tag AS
      SELECT id, created_at, left(content,160) AS preview
      FROM public.thoughts
      WHERE COALESCE(jsonb_array_length(metadata->'topics'),0)=0
        AND COALESCE(jsonb_array_length(metadata->'tags'),0)=0
        AND COALESCE(jsonb_array_length(metadata->'people'),0)=0
      ORDER BY id DESC;

      CREATE OR REPLACE VIEW lint_empty_content AS
      SELECT id, created_at
      FROM public.thoughts
      WHERE content IS NULL OR btrim(content)=''
      ORDER BY id DESC;
    $v$;
  END IF;
END $$;

CREATE OR REPLACE VIEW lint_over_tagged AS
SELECT id, created_at, jsonb_array_length(metadata->'tags') AS tag_count, left(content,160) AS preview
FROM public.thoughts
WHERE COALESCE(jsonb_array_length(metadata->'tags'),0) > 10
ORDER BY tag_count DESC;

CREATE OR REPLACE VIEW lint_very_long AS
SELECT id, created_at, length(content) AS chars, left(content,200) AS preview
FROM public.thoughts
WHERE length(content) > 20000
ORDER BY chars DESC;

-- Low-signal requires the enhanced-thoughts `importance` column; skipped if absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='thoughts' AND column_name='importance') THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW lint_low_signal AS
      SELECT id, created_at, importance, content
      FROM public.thoughts
      WHERE importance IS NOT NULL AND importance <= 2
        AND length(COALESCE(btrim(content),'')) < 40
      ORDER BY id DESC;
    $v$;
  ELSE
    RAISE NOTICE 'importance column absent (schemas/enhanced-thoughts) — lint_low_signal skipped';
  END IF;
END $$;

-- Duplicate detection requires content_fingerprint (recipes/content-fingerprint-dedup).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='thoughts' AND column_name='content_fingerprint') THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW lint_exact_duplicates AS
      SELECT content_fingerprint, count(*) AS copies, array_agg(id ORDER BY id) AS ids
      FROM public.thoughts
      WHERE content_fingerprint IS NOT NULL
      GROUP BY content_fingerprint
      HAVING count(*) > 1
      ORDER BY copies DESC;
    $v$;
  ELSE
    RAISE NOTICE 'content_fingerprint column absent (recipes/content-fingerprint-dedup) — lint_exact_duplicates skipped';
  END IF;
END $$;

-- ── Tier 2: graph lint (requires schemas/entity-extraction) ─────────────────

DO $$
BEGIN
  IF to_regclass('public.thought_entities') IS NOT NULL
     AND to_regclass('public.entities') IS NOT NULL
     AND to_regclass('public.edges') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='thoughts' AND column_name='importance') THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW lint_high_importance_isolated AS
      SELECT t.id, t.created_at, t.importance, left(t.content,200) AS preview
      FROM public.thoughts t
      LEFT JOIN public.thought_entities te ON te.thought_id = t.id
      WHERE t.importance >= 4 AND te.thought_id IS NULL
      ORDER BY t.importance DESC, t.id DESC;

      CREATE OR REPLACE VIEW lint_entities_zero_edges AS
      SELECT e.id, e.entity_type, e.canonical_name
      FROM public.entities e
      WHERE NOT EXISTS (
        SELECT 1 FROM public.edges g
        WHERE g.from_entity_id = e.id OR g.to_entity_id = e.id
      )
      ORDER BY e.id;
    $v$;
  ELSE
    RAISE NOTICE 'entity-extraction schema absent — Tier 2 graph lint views skipped';
  END IF;
END $$;

-- ── Aggregator the auditor calls ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION lint_hygiene_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result jsonb;
BEGIN
  result := jsonb_build_object(
    'total_thoughts', (SELECT count(*) FROM public.thoughts),
    'orphans_by_tag', (SELECT count(*) FROM lint_orphans_by_tag),
    'over_tagged',    (SELECT count(*) FROM lint_over_tagged),
    'empty_content',  (SELECT count(*) FROM lint_empty_content),
    'very_long',      (SELECT count(*) FROM lint_very_long)
  );

  IF to_regclass('public.lint_low_signal') IS NOT NULL THEN
    result := result || jsonb_build_object(
      'low_signal', (SELECT count(*) FROM lint_low_signal));
  END IF;

  IF to_regclass('public.lint_exact_duplicates') IS NOT NULL THEN
    result := result || jsonb_build_object(
      'exact_duplicate_groups', (SELECT count(*) FROM lint_exact_duplicates),
      'missing_fingerprint',    (SELECT count(*) FROM public.thoughts WHERE content_fingerprint IS NULL));
  END IF;

  IF to_regclass('public.lint_entities_zero_edges') IS NOT NULL THEN
    result := result || jsonb_build_object(
      'tier2_available',          true,
      'entities_total',           (SELECT count(*) FROM public.entities),
      'high_importance_isolated', (SELECT count(*) FROM lint_high_importance_isolated),
      'entities_zero_edges',      (SELECT count(*) FROM lint_entities_zero_edges),
      'entity_dup_groups',        (SELECT count(*) FROM (
                                     SELECT normalized_name FROM public.entities
                                     GROUP BY normalized_name HAVING count(*) > 1
                                   ) d));
  ELSE
    result := result || jsonb_build_object('tier2_available', false);
  END IF;

  RETURN result;
END $$;

-- ============================================================
-- Verify:
--   SELECT lint_hygiene_summary();
-- Then run the auditor (dry run) and confirm the response includes a
-- non-null "hygiene" object.
-- ============================================================
