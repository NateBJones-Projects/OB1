-- Entity Extraction Tables and Extraction Trigger
-- Adds entities, edges, thought_entities, entity_extraction_queue,
-- and consolidation_log tables for automatic entity and relationship
-- extraction from thoughts.
-- Safe to run multiple times (fully idempotent).

-- ============================================================
-- 0. PREREQUISITE CHECK
--    The auto-queue trigger and the optional backfill both read
--    thoughts.content_fingerprint (added in Step 2.6 of
--    docs/01-getting-started.md). Without it, the migration would
--    install silently and then crash the first INSERT INTO
--    thoughts. Hard-fail here with a clear message instead.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'thoughts'
      AND column_name  = 'content_fingerprint'
  ) THEN
    RAISE EXCEPTION
      'entity-extraction requires the content_fingerprint column on public.thoughts. '
      'Run docs/01-getting-started.md Step 2.6 first, then re-apply this schema.';
  END IF;
END $$;

-- ============================================================
-- 1. ENTITIES
--    Canonical graph nodes representing people, projects, topics,
--    tools, organizations, and places mentioned across thoughts.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.entities (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,         -- person, project, topic, tool, organization, place
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,     -- lowercase, trimmed, for dedup
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, normalized_name)
);

-- ============================================================
-- 2. EDGES
--    Typed relationships between entities (co_occurs_with,
--    works_on, uses, related_to, member_of, located_in).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.edges (
  id BIGSERIAL PRIMARY KEY,
  from_entity_id BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  to_entity_id BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,            -- co_occurs_with, works_on, uses, related_to, member_of, located_in
  support_count INT NOT NULL DEFAULT 1,
  confidence NUMERIC(3,2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_entity_id, to_entity_id, relation)
);

-- ============================================================
-- 3. THOUGHT-ENTITY LINKS
--    Evidence-bearing links from thoughts to entities with
--    mention role and extraction confidence.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.thought_entities (
  thought_id UUID NOT NULL REFERENCES public.thoughts(id) ON DELETE CASCADE,
  entity_id BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  mention_role TEXT NOT NULL DEFAULT 'mentioned',
  confidence NUMERIC(3,2),
  source TEXT NOT NULL DEFAULT 'entity_worker',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (thought_id, entity_id, mention_role)
);

-- ============================================================
-- 4. ENTITY EXTRACTION QUEUE
--    Async queue for thoughts waiting to be processed by the
--    entity extraction worker. One row per thought.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.entity_extraction_queue (
  thought_id UUID PRIMARY KEY REFERENCES public.thoughts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, processing, complete, failed, skipped
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  source_fingerprint TEXT,
  source_updated_at TIMESTAMPTZ,
  worker_version TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ============================================================
-- 5. CONSOLIDATION LOG
--    Audit trail for dedup merges, metadata fixes, bio
--    synthesis, and other quality operations.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.consolidation_log (
  id BIGSERIAL PRIMARY KEY,
  operation TEXT NOT NULL,           -- dedup_merge, metadata_fix, bio_synthesis, etc.
  survivor_id UUID,
  loser_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_entities_type ON public.entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_normalized ON public.entities(normalized_name);
CREATE INDEX IF NOT EXISTS idx_edges_from ON public.edges(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON public.edges(to_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_relation ON public.edges(relation);
CREATE INDEX IF NOT EXISTS idx_thought_entities_entity ON public.thought_entities(entity_id);
CREATE INDEX IF NOT EXISTS idx_thought_entities_thought ON public.thought_entities(thought_id);
CREATE INDEX IF NOT EXISTS idx_extraction_queue_status
  ON public.entity_extraction_queue(status)
  WHERE status = 'pending';

-- ============================================================
-- 7. AUTO-QUEUE TRIGGER
--    When a thought is inserted or its content/metadata changes,
--    queue it for entity extraction. Skips system-generated
--    artifacts and ignores no-op fingerprint changes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.queue_entity_extraction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Skip system-generated artifacts (consolidation outputs, bios, etc.)
  IF NEW.metadata->>'generated_by' IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.entity_extraction_queue (thought_id, status, source_fingerprint, source_updated_at)
  VALUES (NEW.id, 'pending', NEW.content_fingerprint, NEW.updated_at)
  ON CONFLICT (thought_id) DO UPDATE SET
    status = 'pending',
    attempt_count = 0,
    last_error = NULL,
    queued_at = now(),
    source_fingerprint = EXCLUDED.source_fingerprint,
    source_updated_at = EXCLUDED.source_updated_at
  WHERE entity_extraction_queue.source_fingerprint IS DISTINCT FROM EXCLUDED.source_fingerprint;

  RETURN NEW;
END;
$$;

-- Attach trigger to thoughts table (fires on insert or content/metadata change)
DROP TRIGGER IF EXISTS trg_queue_entity_extraction ON public.thoughts;
CREATE TRIGGER trg_queue_entity_extraction
  AFTER INSERT OR UPDATE OF content, metadata ON public.thoughts
  FOR EACH ROW
  EXECUTE FUNCTION public.queue_entity_extraction();

-- ============================================================
-- 8. ROW LEVEL SECURITY
--    Defense in depth: service_role bypasses RLS for edge
--    functions and workers; authenticated users get a minimum
--    SELECT hook so dashboards can layer policies later without
--    a write-path-breaking migration. Matches recipes/ob-graph
--    and primitives/rls/ guidance. `anon` has no access.
-- ============================================================

ALTER TABLE public.entities               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edges                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thought_entities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_extraction_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consolidation_log      ENABLE ROW LEVEL SECURITY;

-- Service role: full access. Redundant with role bypass but
-- explicit policies keep the security posture legible.
DROP POLICY IF EXISTS entities_service_role_all               ON public.entities;
DROP POLICY IF EXISTS edges_service_role_all                  ON public.edges;
DROP POLICY IF EXISTS thought_entities_service_role_all       ON public.thought_entities;
DROP POLICY IF EXISTS entity_extraction_queue_service_role_all ON public.entity_extraction_queue;
DROP POLICY IF EXISTS consolidation_log_service_role_all      ON public.consolidation_log;

CREATE POLICY entities_service_role_all ON public.entities
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY edges_service_role_all ON public.edges
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY thought_entities_service_role_all ON public.thought_entities
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY entity_extraction_queue_service_role_all ON public.entity_extraction_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY consolidation_log_service_role_all ON public.consolidation_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users: SELECT-only hook. These tables have no
-- user_id column yet, so this is the minimum scaffold for future
-- multi-tenancy. When multi-tenant is wired, replace `true` with
-- `auth.uid() = user_id`. No anon policy -- anon has no access.
DROP POLICY IF EXISTS entities_authenticated_select               ON public.entities;
DROP POLICY IF EXISTS edges_authenticated_select                  ON public.edges;
DROP POLICY IF EXISTS thought_entities_authenticated_select       ON public.thought_entities;
DROP POLICY IF EXISTS entity_extraction_queue_authenticated_select ON public.entity_extraction_queue;
DROP POLICY IF EXISTS consolidation_log_authenticated_select      ON public.consolidation_log;

CREATE POLICY entities_authenticated_select ON public.entities
  FOR SELECT TO authenticated USING (true);
CREATE POLICY edges_authenticated_select ON public.edges
  FOR SELECT TO authenticated USING (true);
CREATE POLICY thought_entities_authenticated_select ON public.thought_entities
  FOR SELECT TO authenticated USING (true);
CREATE POLICY entity_extraction_queue_authenticated_select ON public.entity_extraction_queue
  FOR SELECT TO authenticated USING (true);
CREATE POLICY consolidation_log_authenticated_select ON public.consolidation_log
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 9. GRANTS
--    Service role gets full table access for workers and edge
--    functions. Authenticated gets SELECT only (RLS policies
--    above gate the rows). `anon` gets nothing by default --
--    stock OB1 uses the service-role key server-side, so anon
--    is not on the MCP path.
-- ============================================================

GRANT ALL ON public.entities                TO service_role;
GRANT ALL ON public.edges                   TO service_role;
GRANT ALL ON public.thought_entities        TO service_role;
GRANT ALL ON public.entity_extraction_queue TO service_role;
GRANT ALL ON public.consolidation_log       TO service_role;

GRANT SELECT ON public.entities                TO authenticated;
GRANT SELECT ON public.edges                   TO authenticated;
GRANT SELECT ON public.thought_entities        TO authenticated;
GRANT SELECT ON public.entity_extraction_queue TO authenticated;
GRANT SELECT ON public.consolidation_log       TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_entity_extraction()
  TO service_role;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- OPTIONAL: Backfill extraction queue for existing thoughts
--
-- The trigger only fires on INSERT/UPDATE, so pre-existing
-- thoughts need manual queuing. Uncomment and run this once
-- after applying the schema to an existing brain:
--
-- INSERT INTO public.entity_extraction_queue
--   (thought_id, status, source_fingerprint, source_updated_at)
-- SELECT id, 'pending', content_fingerprint, updated_at
-- FROM public.thoughts
-- WHERE (metadata->>'generated_by') IS NULL
-- ON CONFLICT (thought_id) DO NOTHING;
-- ============================================================
