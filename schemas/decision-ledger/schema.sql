-- ============================================================
-- OB1 Decision Ledger
-- Ranked-recall sidecar for agent decisions.
--
-- Motivation:
--   In Stefania Druga's memory-harness experiments (Sakana.ai,
--   AI Engineer 2026), a ranked decisions ledger beat plain
--   vector RAG on long-horizon recall — on both accuracy AND
--   token cost. The existing agent-memory schema already stores
--   memory_type = 'decision' rows, but recall reaches them only
--   through vector similarity on the linked thought. This sidecar
--   adds what a ledger needs and vector search lacks:
--
--     * step_index        — where in the task the decision happened
--     * importance        — an explicit, adjustable priority
--     * rationale         — why, kept separate from what
--     * dependency edges  — which decisions rest on which
--     * a ranking RPC     — importance x step-recency x relevance,
--                           with a full-text fallback so recall
--                           works with no embedding service at all
--
-- This migration is additive only. public.thoughts and all
-- agent-memory tables are untouched. Lifecycle state (active /
-- superseded / stale) stays in agent_memories — the ledger reads
-- it, never duplicates it.
--
-- Requires: the agent-memory sidecar schema (schemas/agent-memory).
-- Safe to run more than once.
-- ============================================================

BEGIN;

SET search_path TO public, extensions;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'agent_memories'
  ) THEN
    RAISE EXCEPTION
      'decision-ledger requires public.agent_memories. Run schemas/agent-memory/schema.sql first.';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 1. Ledger rows: one per decision-type agent memory
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_decision_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL UNIQUE REFERENCES public.agent_memories(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  task_id TEXT,
  flow_id TEXT,
  -- Monotonic position of the decision within its (workspace, task)
  -- stream. This is the coordinate that makes "the answer was at
  -- step 124, the question arrived at step 500" testable.
  step_index INTEGER NOT NULL CHECK (step_index >= 0),
  -- Why the decision was made, separate from the decision text
  -- itself (which lives in agent_memories.content).
  rationale TEXT,
  -- Explicit priority, adjustable by review or by usage feedback.
  importance NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (importance >= 0 AND importance <= 1),
  -- Pinned decisions always surface first (harness "core" behavior).
  pinned BOOLEAN NOT NULL DEFAULT false,
  -- Usage bookkeeping — raw material for learned ranking later.
  recall_count INTEGER NOT NULL DEFAULT 0,
  used_count INTEGER NOT NULL DEFAULT 0,
  last_recalled_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_decision_ledger_stream
  ON public.agent_decision_ledger (workspace_id, task_id, step_index DESC);

CREATE INDEX IF NOT EXISTS idx_agent_decision_ledger_scope
  ON public.agent_decision_ledger (workspace_id, project_id, created_at DESC);

-- ------------------------------------------------------------
-- 2. Dependency edges between decisions
--    (supersedes/merged_into already live in agent_memory_relations;
--    this table holds the ledger-specific structural edges.)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_decision_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_memory_id UUID NOT NULL REFERENCES public.agent_memories(id) ON DELETE CASCADE,
  to_memory_id UUID NOT NULL REFERENCES public.agent_memories(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('depends_on', 'informs', 'blocks')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_memory_id, to_memory_id, relation),
  CHECK (from_memory_id <> to_memory_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_decision_edges_to
  ON public.agent_decision_edges (to_memory_id, relation);

-- ------------------------------------------------------------
-- 3. Auto-enrollment: every decision-type agent memory gets a
--    ledger row. The write path (agent-memory-api /writeback)
--    does not need to change at all.
--
--    step_index comes from metadata.step_index when the caller
--    provides it, otherwise it is assigned as max+1 within the
--    (workspace, task) stream. Note: the fallback counter assumes
--    a single writer per task stream (true for the serial agent
--    loops this is built for). Concurrent writers to one task
--    should pass explicit step_index values.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.agent_decision_ledger_enroll()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_step INTEGER;
BEGIN
  IF NEW.memory_type <> 'decision' THEN
    RETURN NEW;
  END IF;

  v_step := NULLIF(NEW.metadata #>> '{agent_memory,step_index}', '')::INTEGER;
  IF v_step IS NULL THEN
    v_step := NULLIF(NEW.metadata ->> 'step_index', '')::INTEGER;
  END IF;
  IF v_step IS NULL THEN
    SELECT COALESCE(MAX(l.step_index), -1) + 1 INTO v_step
    FROM public.agent_decision_ledger l
    WHERE l.workspace_id = NEW.workspace_id
      AND l.task_id IS NOT DISTINCT FROM NEW.task_id;
  END IF;

  INSERT INTO public.agent_decision_ledger (
    memory_id, workspace_id, project_id, task_id, flow_id,
    step_index, rationale, importance
  )
  VALUES (
    NEW.id, NEW.workspace_id, NEW.project_id, NEW.task_id, NEW.flow_id,
    v_step,
    NULLIF(NEW.metadata ->> 'rationale', ''),
    COALESCE(NEW.confidence, 0.50)
  )
  ON CONFLICT (memory_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_decision_ledger_enroll ON public.agent_memories;
CREATE TRIGGER trg_agent_decision_ledger_enroll
  AFTER INSERT ON public.agent_memories
  FOR EACH ROW EXECUTE FUNCTION public.agent_decision_ledger_enroll();

CREATE OR REPLACE FUNCTION public.agent_decision_ledger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_decision_ledger_updated_at ON public.agent_decision_ledger;
CREATE TRIGGER trg_agent_decision_ledger_updated_at
  BEFORE UPDATE ON public.agent_decision_ledger
  FOR EACH ROW EXECUTE FUNCTION public.agent_decision_ledger_set_updated_at();

-- ------------------------------------------------------------
-- 4. Ranked recall RPC
--
--    score = w_similarity  * relevance      (vector, or FTS fallback)
--          + w_importance  * importance
--          + w_recency     * exp(-step_distance / half_life_steps)
--          + w_dependency  * inbound_live_dependency_degree
--
--    Superseded/stale/rejected decisions are excluded by default
--    (pass p_include_superseded => true for eval runs that need
--    them). Pinned decisions always sort first.
--
--    Relevance fallback order:
--      1. p_query_embedding provided and the linked thought has an
--         embedding  -> cosine similarity
--      2. p_query text provided -> websearch full-text rank (scaled
--         into the 0-1 range) — this is what makes the ledger usable
--         on a fully local stack with no embedding service
--      3. neither -> 0 (rank purely on importance/recency/structure)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.match_decision_ledger(
  p_workspace_id        TEXT,
  p_query               TEXT              DEFAULT NULL,
  p_query_embedding     vector(1536)      DEFAULT NULL,
  p_project_id          TEXT              DEFAULT NULL,
  p_task_id             TEXT              DEFAULT NULL,
  p_current_step        INTEGER           DEFAULT NULL,
  p_match_count         INTEGER           DEFAULT 10,
  p_w_similarity        FLOAT             DEFAULT 0.45,
  p_w_importance        FLOAT             DEFAULT 0.25,
  p_w_recency           FLOAT             DEFAULT 0.15,
  p_w_dependency        FLOAT             DEFAULT 0.15,
  p_half_life_steps     FLOAT             DEFAULT 120.0,
  p_half_life_days      FLOAT             DEFAULT 30.0,
  p_include_superseded  BOOLEAN           DEFAULT false
)
RETURNS TABLE (
  memory_id        UUID,
  summary          TEXT,
  content          TEXT,
  rationale        TEXT,
  step_index       INTEGER,
  importance       NUMERIC,
  pinned           BOOLEAN,
  lifecycle_status TEXT,
  relevance        FLOAT,
  recency          FLOAT,
  dependency_boost FLOAT,
  ranking_score    FLOAT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF p_half_life_steps <= 0.0 THEN p_half_life_steps := 120.0; END IF;
  IF p_half_life_days  <= 0.0 THEN p_half_life_days  := 30.0;  END IF;
  IF p_match_count IS NULL OR p_match_count < 1 THEN p_match_count := 10; END IF;

  RETURN QUERY
  WITH scored AS (
    SELECT
      m.id                                            AS s_memory_id,
      m.summary                                       AS s_summary,
      m.content                                       AS s_content,
      l.rationale                                     AS s_rationale,
      l.step_index                                    AS s_step_index,
      l.importance                                    AS s_importance,
      l.pinned                                        AS s_pinned,
      m.lifecycle_status                              AS s_lifecycle_status,
      -- relevance: vector similarity when available, FTS fallback otherwise
      COALESCE(
        CASE
          WHEN p_query_embedding IS NOT NULL AND t.embedding IS NOT NULL
            THEN (1 - (t.embedding <=> p_query_embedding))::FLOAT
          WHEN p_query IS NOT NULL AND length(trim(p_query)) > 0
            -- ts_rank_cd emits small raw values (~0.01-0.1); scale x10
            -- so a solid text match lands in the same 0-1 range as
            -- cosine similarity and can actually move the blend.
            THEN LEAST(
              ts_rank_cd(
                to_tsvector('english', m.content || ' ' || COALESCE(l.rationale, '')),
                websearch_to_tsquery('english', p_query)
              )::FLOAT * 10.0,
              1.0
            )
          ELSE 0.0
        END,
        0.0
      ) AS s_relevance,
      -- recency: step distance when the caller knows its step,
      -- wall-clock decay otherwise
      CASE
        WHEN p_current_step IS NOT NULL
          THEN exp(
            -GREATEST((p_current_step - l.step_index)::FLOAT, 0.0)
            / p_half_life_steps
          )::FLOAT
        ELSE exp(
          -GREATEST(extract(epoch FROM (now() - l.created_at)) / 86400.0, 0.0)
          / p_half_life_days
        )::FLOAT
      END AS s_recency,
      -- dependency degree: how many live decisions depend on this one
      LEAST(
        (
          SELECT COUNT(*)
          FROM public.agent_decision_edges e
          JOIN public.agent_memories fm ON fm.id = e.from_memory_id
          WHERE e.to_memory_id = m.id
            AND e.relation = 'depends_on'
            AND fm.lifecycle_status = 'active'
        )::FLOAT / 3.0,
        1.0
      ) AS s_dependency_boost
    FROM public.agent_decision_ledger l
    JOIN public.agent_memories m ON m.id = l.memory_id
    LEFT JOIN public.thoughts t ON t.id = m.thought_id
    WHERE l.workspace_id = p_workspace_id
      AND (p_project_id IS NULL OR l.project_id = p_project_id)
      AND (p_task_id IS NULL OR l.task_id = p_task_id)
      AND (
        p_include_superseded
        OR m.lifecycle_status = 'active'
      )
  )
  SELECT
    s.s_memory_id,
    s.s_summary,
    s.s_content,
    s.s_rationale,
    s.s_step_index,
    s.s_importance,
    s.s_pinned,
    s.s_lifecycle_status,
    s.s_relevance,
    s.s_recency,
    s.s_dependency_boost,
    (
      p_w_similarity * s.s_relevance
      + p_w_importance * s.s_importance::FLOAT
      + p_w_recency    * s.s_recency
      + p_w_dependency * s.s_dependency_boost
      -- non-active rows (only reachable with p_include_superseded)
      -- carry an explicit penalty so eval runs can still rank them
      + CASE WHEN s.s_lifecycle_status <> 'active' THEN -0.30 ELSE 0.0 END
    )::FLOAT AS ranking_score
  FROM scored s
  ORDER BY s.s_pinned DESC, ranking_score DESC, s.s_step_index DESC
  LIMIT p_match_count;
END;
$$;

COMMENT ON FUNCTION public.match_decision_ledger IS
  'Ranked recall over the decision ledger. score = w_sim*relevance + w_imp*importance + w_rec*exp(-step_distance/half_life) + w_dep*dependency_degree. Vector similarity when an embedding is passed; websearch FTS fallback when only text is passed (fully local operation). Pinned rows first. Non-active decisions excluded unless p_include_superseded.';

-- ------------------------------------------------------------
-- 5. Recall bookkeeping + usage feedback
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_decision_recall(
  p_memory_ids UUID[],
  p_used BOOLEAN DEFAULT false
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.agent_decision_ledger l
  SET recall_count = l.recall_count + 1,
      used_count = l.used_count + CASE WHEN p_used THEN 1 ELSE 0 END,
      last_recalled_at = now()
  WHERE l.memory_id = ANY(p_memory_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ------------------------------------------------------------
-- 6. Recall-policy eval view
--
--    The agent-memory-api already writes a recall trace per request
--    and per-item used/ignored flags. Tag each request's policy in
--    response_policy.recall_policy (see README patch) and this view
--    becomes the "recall policy as a first-class metric" report:
--    one row per policy with volume, hit-rate, and usage-rate.
-- ------------------------------------------------------------

CREATE OR REPLACE VIEW public.agent_recall_policy_stats AS
SELECT
  COALESCE(t.response_policy ->> 'recall_policy', 'vector') AS recall_policy,
  COUNT(DISTINCT t.id)                                      AS recall_requests,
  COUNT(i.id)                                               AS items_returned,
  ROUND(AVG(i.similarity)::NUMERIC, 4)                      AS avg_similarity,
  ROUND(AVG(i.ranking_score)::NUMERIC, 4)                   AS avg_ranking_score,
  ROUND(
    (SUM(CASE WHEN i.used IS TRUE THEN 1 ELSE 0 END)::NUMERIC
      / NULLIF(SUM(CASE WHEN i.used IS NOT NULL THEN 1 ELSE 0 END), 0)),
    4
  )                                                         AS used_rate,
  ROUND(
    (SUM(CASE WHEN i.used IS FALSE THEN 1 ELSE 0 END)::NUMERIC
      / NULLIF(SUM(CASE WHEN i.used IS NOT NULL THEN 1 ELSE 0 END), 0)),
    4
  )                                                         AS ignored_rate
FROM public.agent_memory_recall_traces t
LEFT JOIN public.agent_memory_recall_items i ON i.trace_id = t.id
GROUP BY 1;

COMMENT ON VIEW public.agent_recall_policy_stats IS
  'Per-recall-policy report over existing recall traces: request volume, items returned, average scores, and used/ignored rates from usage feedback. Policies are read from response_policy.recall_policy on each trace.';

-- ------------------------------------------------------------
-- 7. RLS + grants (matches agent-memory conventions)
-- ------------------------------------------------------------

ALTER TABLE public.agent_decision_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_decision_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_decision_ledger_service_role_all ON public.agent_decision_ledger;
CREATE POLICY agent_decision_ledger_service_role_all ON public.agent_decision_ledger
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS agent_decision_edges_service_role_all ON public.agent_decision_edges;
CREATE POLICY agent_decision_edges_service_role_all ON public.agent_decision_edges
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_decision_ledger TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_decision_edges TO service_role;
GRANT SELECT ON public.agent_recall_policy_stats TO service_role;
GRANT EXECUTE ON FUNCTION public.match_decision_ledger TO service_role;
GRANT EXECUTE ON FUNCTION public.touch_decision_recall(UUID[], BOOLEAN) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
