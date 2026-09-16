-- Add pg_trgm trigram GIN index to accelerate search_thoughts_text ILIKE fallback.
--
-- Context: search_thoughts_text (from schemas/enhanced-thoughts) has a tsvector
-- phase (fast) and an ILIKE '%...%' fallback. The ILIKE fallback triggers for
-- most real queries -- tsvector usually returns fewer hits than requested and
-- the function fills in from ILIKE. Leading-wildcard ILIKE can't use the
-- tsvector GIN index, so without a trigram index ILIKE seq-scans the whole
-- thoughts table. On an 89K-row brain, that's 7-8s per rare-word query.
--
-- Fix: pg_trgm provides trigram-based indexing that GIN can use for ILIKE
-- patterns. No changes to search_thoughts_text needed -- the Postgres planner
-- picks up the new index automatically once it exists. Rare-word queries drop
-- from ~8s to ~100-150ms.
--
-- Prerequisites: enhanced-thoughts schema (PR #191) must be installed first.
-- This migration adds only the trigram index; tsvector index lives in
-- enhanced-thoughts.
--
-- Tradeoffs:
-- - Storage: ~20-40MB on a 90K-thought brain; scales linearly with content size.
-- - Build lock: regular (non-CONCURRENT) CREATE INDEX briefly locks the
--   thoughts table against writes during the build (~1-2 min at 90K rows).
--   Switch to CREATE INDEX CONCURRENTLY if you're running live capture and
--   can tolerate migration-outside-transaction semantics.
-- - Write-amp: small INSERT/UPDATE overhead on content changes. Imperceptible
--   at typical personal-brain write rates.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_thoughts_content_trgm
  ON public.thoughts
  USING gin (content gin_trgm_ops);

COMMENT ON INDEX public.idx_thoughts_content_trgm IS
  'Trigram GIN index on content for ILIKE ''%foo%'' patterns. Accelerates search_thoughts_text ILIKE fallback from ~8s to ~150ms on rare-word queries.';

COMMIT;
