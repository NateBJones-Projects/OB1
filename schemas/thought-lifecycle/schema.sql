-- Thought Lifecycle Events
-- Adds an append-only receipt log for lifecycle and correction actions,
-- and (v3) the single receipted write path that makes a thought mutation
-- and its receipt one transaction.
-- Safe to run multiple times.
--
-- v2: actor carries no default — every writer must state who acted
-- (`user:chat`, `agent:review`, `system:scheduler`), because an
-- append-only log misattributed is history recorded wrong, permanently.
-- Adds nullable brief/run linkage columns so receipts written by an
-- approval executor can rejoin the brief artifact that authorized them
-- (see the companion brief-artifact-store schema). After the caller is
-- deployed writing real actors, also run actor-hardening.sql in this
-- directory.
--
-- v3: "no consequential write without a receipt" becomes a database
-- guarantee instead of a hope. public.receipted_thought_write below
-- is the one write path for every governed thought mutation (lifecycle
-- updates, brief-approval execution, content corrections): the thought
-- patch, its receipt, the supersedes pointer, and the brief outcome event
-- commit or roll back together. The replay lookup index on
-- (brief_id, thought_id) becomes UNIQUE, so "one execution per brief item"
-- is enforced by the database rather than by a check-then-write race. The
-- action→status projection now lives here and only here; the caller passes
-- judgment content (notes, targets, dates) and identity, and this file
-- derives the law. This pack stands alone: the function's
-- optional touchpoints with other packs (the provenance-chains
-- `supersedes` column, the brief store's outcome table) are
-- exception-guarded dynamic SQL — present, they join the transaction;
-- absent, the write still works and says so.

CREATE TABLE IF NOT EXISTS public.thought_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deliberately not a foreign key: receipt rows should survive rare manual/admin
  -- deletion of a thought.
  thought_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN (
      'mark_done',
      'mark_still_open',
      'defer',
      'needs_review',
      'archive',
      'suppress_noise',
      'mark_superseded',
      'correct_thought'
    )
  ),
  actor TEXT NOT NULL,
  note TEXT,
  before_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Brief/run linkage (nullable; no FK, same posture as thought_id above):
  -- populated by the approval executor, absent on direct writes.
  brief_id TEXT,
  run_id UUID,
  brief_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrade path for tables created before v2. Dropping a default is a no-op
-- when none exists; ADD COLUMN IF NOT EXISTS is a no-op when present.
ALTER TABLE public.thought_lifecycle_events ALTER COLUMN actor DROP DEFAULT;
ALTER TABLE public.thought_lifecycle_events ADD COLUMN IF NOT EXISTS brief_id TEXT;
ALTER TABLE public.thought_lifecycle_events ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE public.thought_lifecycle_events ADD COLUMN IF NOT EXISTS brief_hash TEXT;

COMMENT ON TABLE public.thought_lifecycle_events IS
  'Append-only audit log for lifecycle and correction actions on Open Brain thoughts';
COMMENT ON COLUMN public.thought_lifecycle_events.before_state IS
  'Compact JSON snapshot of lifecycle-relevant state before the action';
COMMENT ON COLUMN public.thought_lifecycle_events.after_state IS
  'Compact JSON snapshot of lifecycle-relevant state after the action';
COMMENT ON COLUMN public.thought_lifecycle_events.actor IS
  'Who acted, as party:context (user:chat, agent:review, system:scheduler). No default: silence may not claim an identity.';
COMMENT ON COLUMN public.thought_lifecycle_events.brief_id IS
  'Brief artifact that authorized this write (executor path); NULL on direct writes.';
COMMENT ON COLUMN public.thought_lifecycle_events.brief_hash IS
  'Hash of the exact reviewed brief bytes, so each receipt independently pins what authorized it.';

CREATE INDEX IF NOT EXISTS idx_thought_lifecycle_events_thought
  ON public.thought_lifecycle_events (thought_id, created_at DESC);

-- Replay refusal, database-enforced (v3): at most ONE receipt per
-- (brief_id, thought_id), ever. brief_items holds UNIQUE (brief_id,
-- thought_id), so this is exactly "one execution per brief item" — the
-- rule the executor's check-then-write pre-check could only hope to hold
-- under concurrency. Two racing approvals of the same item serialize
-- here: the second receipt insert violates the index and its whole
-- transaction — thought mutation included — rolls back. Relaxing the
-- replay rule later is a receipted schema change (drop this index), not a
-- silent code edit; that is this system's constitution applied to itself.
-- Safe on a live table: no executor ran before v3, so every existing
-- receipt has brief_id IS NULL and the partial index starts empty. The
-- old non-unique index served the same lookups and is superseded.
DROP INDEX IF EXISTS public.idx_thought_lifecycle_events_brief;
CREATE UNIQUE INDEX IF NOT EXISTS uq_thought_lifecycle_events_brief_thought
  ON public.thought_lifecycle_events (brief_id, thought_id)
  WHERE brief_id IS NOT NULL;

COMMENT ON INDEX public.uq_thought_lifecycle_events_brief_thought IS
  'The replay law: one executed approval per (brief, thought), held by the database. Also serves the "does a receipt exist for this brief item?" lookup.';

CREATE INDEX IF NOT EXISTS idx_thought_lifecycle_events_action
  ON public.thought_lifecycle_events (action, created_at DESC);

ALTER TABLE public.thought_lifecycle_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS thought_lifecycle_events_service_role_select
  ON public.thought_lifecycle_events;
DROP POLICY IF EXISTS thought_lifecycle_events_service_role_insert
  ON public.thought_lifecycle_events;

CREATE POLICY thought_lifecycle_events_service_role_select
  ON public.thought_lifecycle_events
  FOR SELECT
  USING (auth.role() = 'service_role');

CREATE POLICY thought_lifecycle_events_service_role_insert
  ON public.thought_lifecycle_events
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT, INSERT ON TABLE public.thought_lifecycle_events TO service_role;

-- ---------------------------------------------------------------------------
-- v3 — the receipted write path.
--
-- Boundary allocation: the database derives the
-- LAW — the action→status projection, the law-stamped metadata keys, the
-- actor format, replay refusal, and atomicity. The caller composes the
-- JUDGMENT — which action, whose identity, what note, which target — and
-- validates it against brief artifacts and approval contracts before
-- calling here. Do not reintroduce the projection in the caller: one
-- source of truth, callers stay callers.
--
-- The metadata merge (metadata || patch) and both receipt snapshots happen
-- under the row lock taken by this function, which closes two silent
-- corruptions the old two-call path allowed: a concurrent writer's
-- metadata keys being overwritten by a stale read-modify-write, and a
-- receipt recording a before_state that was never actually the before.
-- ---------------------------------------------------------------------------

-- Receipt snapshot shape (the summary both tools historically wrote).
CREATE OR REPLACE FUNCTION public.thought_state_summary(
  p_id pg_catalog.uuid,
  p_content pg_catalog.text,
  p_status pg_catalog.text,
  p_status_updated_at pg_catalog.timestamptz,
  p_metadata pg_catalog.jsonb
) RETURNS pg_catalog.jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'id', p_id,
    'status', p_status,
    'status_updated_at', p_status_updated_at,
    'lifecycle_state', pg_catalog.jsonb_extract_path(p_metadata, 'lifecycle_state'),
    'lifecycle_reason', pg_catalog.jsonb_extract_path(p_metadata, 'lifecycle_reason'),
    'next_action', pg_catalog.jsonb_extract_path(p_metadata, 'next_action'),
    'review_after', pg_catalog.jsonb_extract_path(p_metadata, 'review_after'),
    'superseded_by', pg_catalog.jsonb_extract_path(p_metadata, 'superseded_by'),
    'suppress_from_operating_loop', CASE
      WHEN pg_catalog.jsonb_extract_path(p_metadata, 'suppress_from_operating_loop') IS NULL
        OR pg_catalog.jsonb_extract_path(p_metadata, 'suppress_from_operating_loop') OPERATOR(pg_catalog.=) 'null'::pg_catalog.jsonb
      THEN pg_catalog.to_jsonb(false)
      ELSE pg_catalog.jsonb_extract_path(p_metadata, 'suppress_from_operating_loop')
    END,
    'content_preview', (
      SELECT CASE
        WHEN pg_catalog.length(normalized) OPERATOR(pg_catalog.<=) 160 THEN normalized
        ELSE pg_catalog.concat(pg_catalog.left(normalized, 159), '...')
      END
      FROM (
        SELECT pg_catalog.btrim(pg_catalog.regexp_replace(p_content, '\s+', ' ', 'g')) AS normalized
      ) AS preview
    )
  )
$fn$;

COMMENT ON FUNCTION public.thought_state_summary(uuid, text, text, timestamptz, jsonb) IS
  'Compact lifecycle-relevant snapshot recorded as before_state/after_state on receipts. Pure; used only by receipted_thought_write.';

CREATE OR REPLACE FUNCTION public.receipted_thought_write(
  p_thought_id pg_catalog.uuid,
  p_action pg_catalog.text,
  p_actor pg_catalog.text,
  p_event_time pg_catalog.timestamptz,
  p_note pg_catalog.text DEFAULT NULL,
  p_next_action pg_catalog.text DEFAULT NULL,
  p_review_after pg_catalog.text DEFAULT NULL,
  p_superseded_by pg_catalog.uuid DEFAULT NULL,
  p_content pg_catalog.text DEFAULT NULL,
  p_embedding pg_catalog.text DEFAULT NULL,
  p_brief_id pg_catalog.text DEFAULT NULL,
  p_run_id pg_catalog.uuid DEFAULT NULL,
  p_brief_hash pg_catalog.text DEFAULT NULL,
  p_item_id pg_catalog.text DEFAULT NULL,
  p_acted_at pg_catalog.timestamptz DEFAULT NULL
) RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_note pg_catalog.text := CASE
    WHEN p_note IS NULL OR pg_catalog.btrim(p_note) OPERATOR(pg_catalog.=) '' THEN NULL
    ELSE pg_catalog.btrim(p_note)
  END;
  v_next_action pg_catalog.text := CASE
    WHEN p_next_action IS NULL OR pg_catalog.btrim(p_next_action) OPERATOR(pg_catalog.=) '' THEN NULL
    ELSE pg_catalog.btrim(p_next_action)
  END;
  v_linkage boolean := p_brief_id IS NOT NULL
    OR p_run_id IS NOT NULL
    OR p_brief_hash IS NOT NULL
    OR p_item_id IS NOT NULL
    OR p_acted_at IS NOT NULL;
  v_content pg_catalog.text;
  v_metadata pg_catalog.jsonb;
  v_status pg_catalog.text;
  v_status_updated_at pg_catalog.timestamptz;
  v_before pg_catalog.jsonb;
  v_after pg_catalog.jsonb;
  v_patch pg_catalog.jsonb;
  v_new_status pg_catalog.text;
  v_now_iso pg_catalog.text;
  v_receipt_id pg_catalog.uuid;
  v_dual pg_catalog.jsonb := NULL;
  v_outcome pg_catalog.jsonb := NULL;
  v_outcome_label pg_catalog.text;
  v_seq pg_catalog.int8;
  v_rowcount pg_catalog.int4;
  v_after_content pg_catalog.text;
  v_after_metadata pg_catalog.jsonb;
  v_after_status pg_catalog.text;
  v_after_status_updated_at pg_catalog.timestamptz;
BEGIN
  -- The verb law: the receipts CHECK enumerates the same set, but refusing
  -- here refuses BEFORE the thought row is touched, with a plain message.
  IF p_action IS NULL OR NOT (
    p_action OPERATOR(pg_catalog.=) ANY (
      ARRAY[
        'mark_done', 'mark_still_open', 'defer', 'needs_review',
        'archive', 'suppress_noise', 'mark_superseded', 'correct_thought'
      ]::pg_catalog.text[]
    )
  ) THEN
    RAISE EXCEPTION 'action % is not a receiptable verb',
      CASE WHEN p_action IS NULL THEN '(null)' ELSE p_action END;
  END IF;

  -- The actor law (store law L10, mirroring actor-hardening.sql): a real
  -- party:context identity, never a bare machine name, never defaulted.
  -- This function is new — no legacy write flows through it — so it holds
  -- the law from day one, independent of when actor-hardening.sql runs.
  IF p_actor IS NULL OR p_actor OPERATOR(pg_catalog.=) 'mcp'
    OR p_actor OPERATOR(pg_catalog.!~) '^[a-z0-9._-]+:[a-z0-9._-]+$' THEN
    RAISE EXCEPTION 'actor must be a real party:context identity (e.g. user:chat); % is not storable',
      CASE WHEN p_actor IS NULL THEN '(null)' ELSE p_actor END;
  END IF;

  IF p_event_time IS NULL THEN
    RAISE EXCEPTION 'event_time is required: law metadata stamps and status_updated_at derive from it';
  END IF;

  -- Param-shape laws. The tools are lenient (they null out inapplicable
  -- optional arguments); this function is strict, because a service-role
  -- caller reaching it directly gets no TypeScript courtesy.
  IF (p_action OPERATOR(pg_catalog.=) 'correct_thought') OPERATOR(pg_catalog.<>) (p_content IS NOT NULL) THEN
    RAISE EXCEPTION 'content is required for correct_thought and forbidden for every other action';
  END IF;
  IF (p_action OPERATOR(pg_catalog.=) 'correct_thought') OPERATOR(pg_catalog.<>) (p_embedding IS NOT NULL) THEN
    RAISE EXCEPTION 'embedding is required for correct_thought and forbidden for every other action';
  END IF;
  IF p_content IS NOT NULL AND pg_catalog.btrim(p_content) OPERATOR(pg_catalog.=) '' THEN
    RAISE EXCEPTION 'corrected content must not be empty';
  END IF;
  IF p_embedding IS NOT NULL AND p_embedding OPERATOR(pg_catalog.!~) '^\[[0-9eE+.,-]+\]$' THEN
    RAISE EXCEPTION 'embedding must be a pgvector literal like [0.1,-0.2,...]';
  END IF;
  IF p_superseded_by IS NOT NULL AND p_action OPERATOR(pg_catalog.<>) 'mark_superseded' THEN
    RAISE EXCEPTION 'superseded_by is only accepted for mark_superseded';
  END IF;
  IF p_superseded_by OPERATOR(pg_catalog.=) p_thought_id THEN
    RAISE EXCEPTION 'a thought cannot supersede itself';
  END IF;
  IF v_next_action IS NOT NULL
    AND NOT (p_action OPERATOR(pg_catalog.=) ANY (
      ARRAY['mark_still_open', 'defer']::pg_catalog.text[]
    )) THEN
    RAISE EXCEPTION 'next_action is only accepted for mark_still_open and defer';
  END IF;
  IF p_action OPERATOR(pg_catalog.=) 'defer' AND p_review_after IS NULL THEN
    RAISE EXCEPTION 'review_after is required for defer and must be an exact YYYY-MM-DD date';
  END IF;
  IF p_review_after IS NOT NULL AND p_action OPERATOR(pg_catalog.<>) 'defer' THEN
    RAISE EXCEPTION 'review_after is only accepted for defer';
  END IF;
  IF p_review_after IS NOT NULL THEN
    IF p_review_after OPERATOR(pg_catalog.!~) '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'review_after must be an exact YYYY-MM-DD date';
    END IF;
    BEGIN
      PERFORM p_review_after::pg_catalog.date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'review_after must be a real calendar date in YYYY-MM-DD format';
    END;
  END IF;

  -- Brief linkage: all five ride together or not at all, and never on a
  -- correction (the approval contract forbids correct_thought in the loop
  -- — correction_not_in_v0_loop — so a brief-linked correction receipt is
  -- unstorable by construction).
  IF v_linkage THEN
    IF p_brief_id IS NULL OR p_run_id IS NULL OR p_brief_hash IS NULL
      OR p_item_id IS NULL OR p_acted_at IS NULL THEN
      RAISE EXCEPTION 'brief linkage requires brief_id, run_id, brief_hash, item_id, and acted_at together';
    END IF;
    IF p_action OPERATOR(pg_catalog.=) 'correct_thought' THEN
      RAISE EXCEPTION 'correct_thought may not carry brief linkage: corrections are outside the approval loop';
    END IF;
    IF p_brief_hash OPERATOR(pg_catalog.!~) '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'brief_hash must be 64 lowercase hex characters (SHA-256)';
    END IF;
  END IF;

  -- Lock the row. The metadata merge and BOTH receipt snapshots happen
  -- under this lock: before_state is the true before, and a concurrent
  -- writer's metadata keys cannot be lost to a stale read-modify-write.
  SELECT t.content,
         CASE WHEN t.metadata IS NULL THEN '{}'::pg_catalog.jsonb ELSE t.metadata END,
         t.status,
         t.status_updated_at
    INTO v_content, v_metadata, v_status, v_status_updated_at
  FROM public.thoughts t
  WHERE t.id OPERATOR(pg_catalog.=) p_thought_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Thought not found: no thoughts row with id %', p_thought_id;
  END IF;

  v_before := public.thought_state_summary(
    p_thought_id, v_content, v_status, v_status_updated_at, v_metadata);

  -- Law metadata stamps use the caller-stated event time, formatted to
  -- match the historical JS toISOString strings byte for byte.
  v_now_iso := pg_catalog.to_char(
    pg_catalog.timezone('UTC'::pg_catalog.text, p_event_time),
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  IF p_action OPERATOR(pg_catalog.=) 'correct_thought' THEN
    IF pg_catalog.regexp_replace(v_content, '^\s+|\s+$', '', 'g') OPERATOR(pg_catalog.=) p_content THEN
      RAISE EXCEPTION 'corrected_content matches the existing thought content.';
    END IF;

    -- Correction bookkeeping, derived here so the count increments under
    -- the same lock that reads it (the old TypeScript increment raced).
    v_patch := pg_catalog.jsonb_build_object(
      'corrected_at', v_now_iso,
      'corrected_by', p_actor,
      'correction_count', CASE
        WHEN pg_catalog.jsonb_typeof(pg_catalog.jsonb_extract_path(v_metadata, 'correction_count')) OPERATOR(pg_catalog.=) 'number'
        THEN pg_catalog.jsonb_extract_path_text(v_metadata, 'correction_count')::pg_catalog.numeric::pg_catalog.int4 OPERATOR(pg_catalog.+) 1
        ELSE 1
      END,
      'correction_metadata_strategy', 'preserved_existing_metadata'
    );
    IF v_note IS NOT NULL THEN
      v_patch := v_patch OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object('correction_note', v_note);
    END IF;

    -- Dynamic SQL so the embedding rides as an unknown-typed literal (%L)
    -- and is parsed by the vector column's own input function — this file
    -- never has to name the pgvector type's schema.
    EXECUTE pg_catalog.format($sql$
      UPDATE public.thoughts
      SET content = $1, embedding = %L, metadata = $2
      WHERE id OPERATOR(pg_catalog.=) $3
      RETURNING content,
                CASE WHEN metadata IS NULL THEN '{}'::pg_catalog.jsonb ELSE metadata END,
                status,
                status_updated_at
    $sql$, p_embedding)
    INTO v_after_content, v_after_metadata, v_after_status, v_after_status_updated_at
    USING p_content, v_metadata OPERATOR(pg_catalog.||) v_patch, p_thought_id;
  ELSE
    -- The action→status projection. THE single source of this law (the
    -- read model's ACTIVE_STATUSES/CLOSED_STATUSES sets are its read-side
    -- mirror; schemas/thought-lifecycle/README.md holds the table).
    v_new_status := CASE
      WHEN p_action OPERATOR(pg_catalog.=) 'mark_done' THEN 'done'
      WHEN p_action OPERATOR(pg_catalog.=) 'mark_still_open' THEN 'active'
      WHEN p_action OPERATOR(pg_catalog.=) 'defer' THEN 'planning'
      WHEN p_action OPERATOR(pg_catalog.=) 'needs_review' THEN 'review'
      WHEN p_action OPERATOR(pg_catalog.=) 'archive' THEN 'archived'
      WHEN p_action OPERATOR(pg_catalog.=) 'suppress_noise' THEN 'archived'
      WHEN p_action OPERATOR(pg_catalog.=) 'mark_superseded' THEN 'archived'
    END;

    v_patch := pg_catalog.jsonb_build_object(
      'lifecycle_state', CASE
        WHEN p_action OPERATOR(pg_catalog.=) 'mark_done' THEN 'done'
        WHEN p_action OPERATOR(pg_catalog.=) 'mark_still_open' THEN 'open'
        WHEN p_action OPERATOR(pg_catalog.=) 'defer' THEN 'deferred'
        WHEN p_action OPERATOR(pg_catalog.=) 'needs_review' THEN 'needs_review'
        WHEN p_action OPERATOR(pg_catalog.=) 'archive' THEN 'archived'
        WHEN p_action OPERATOR(pg_catalog.=) 'suppress_noise' THEN 'noise'
        WHEN p_action OPERATOR(pg_catalog.=) 'mark_superseded' THEN 'superseded'
      END,
      'lifecycle_action', p_action,
      'lifecycle_updated_at', v_now_iso,
      'suppress_from_operating_loop',
        (p_action OPERATOR(pg_catalog.=) ANY (
          ARRAY['mark_done', 'archive', 'suppress_noise', 'mark_superseded']::pg_catalog.text[]
        ))
    );
    IF v_note IS NOT NULL THEN
      v_patch := v_patch OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object('lifecycle_note', v_note);
    END IF;

    IF p_action OPERATOR(pg_catalog.=) 'mark_done' THEN
      v_patch := v_patch OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object(
        'completed_at', v_now_iso,
        'next_action', NULL,
        'review_after', NULL);
    ELSIF p_action OPERATOR(pg_catalog.=) 'mark_still_open' THEN
      v_patch := v_patch OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object(
        'reopened_at', v_now_iso,
        'review_after', NULL);
      IF v_next_action IS NOT NULL THEN
        v_patch := v_patch OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object('next_action', v_next_action);
      END IF;
    ELSIF p_action OPERATOR(pg_catalog.=) 'defer' THEN
      v_patch := v_patch OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object(
        'deferred_at', v_now_iso,
        'review_after', p_review_after);
      IF v_next_action IS NOT NULL THEN
        v_patch := v_patch OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object('next_action', v_next_action);
      END IF;
    ELSIF p_action OPERATOR(pg_catalog.=) 'needs_review' THEN
      v_patch := v_patch OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object('needs_review_at', v_now_iso);
    ELSIF p_action OPERATOR(pg_catalog.=) 'archive' THEN
      v_patch := v_patch OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object(
        'archived_at', v_now_iso,
        'lifecycle_reason', CASE WHEN v_note IS NULL THEN 'manual_archive' ELSE v_note END);
    ELSIF p_action OPERATOR(pg_catalog.=) 'suppress_noise' THEN
      v_patch := v_patch OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object(
        'archived_at', v_now_iso,
        'suppressed_at', v_now_iso,
        'lifecycle_reason', 'noise');
    ELSIF p_action OPERATOR(pg_catalog.=) 'mark_superseded' THEN
      v_patch := v_patch OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object(
        'archived_at', v_now_iso,
        'superseded_at', v_now_iso,
        'lifecycle_reason', 'superseded');
      IF p_superseded_by IS NOT NULL THEN
        v_patch := v_patch OPERATOR(pg_catalog.||)
          pg_catalog.jsonb_build_object('superseded_by', p_superseded_by::pg_catalog.text);
      END IF;
    END IF;

    UPDATE public.thoughts
    SET status = v_new_status,
        status_updated_at = p_event_time,
        metadata = v_metadata OPERATOR(pg_catalog.||) v_patch
    WHERE id OPERATOR(pg_catalog.=) p_thought_id
    RETURNING content,
              CASE WHEN metadata IS NULL THEN '{}'::pg_catalog.jsonb ELSE metadata END,
              status,
              status_updated_at
    INTO v_after_content, v_after_metadata, v_after_status, v_after_status_updated_at;
  END IF;

  v_after := public.thought_state_summary(
    p_thought_id, v_after_content, v_after_status, v_after_status_updated_at, v_after_metadata);

  -- The receipt. On the executor path the UNIQUE replay index guards this
  -- insert: a raced duplicate approval aborts here, rolling back the
  -- thought mutation above with it.
  INSERT INTO public.thought_lifecycle_events
    (thought_id, action, actor, note, before_state, after_state, brief_id, run_id, brief_hash)
  VALUES
    (p_thought_id, p_action, p_actor, v_note, v_before, v_after, p_brief_id, p_run_id, p_brief_hash)
  RETURNING id INTO v_receipt_id;

  -- Best-effort supersedes pointer (newer.supersedes = older), inside the
  -- transaction: when the provenance-chains column exists, the pointer
  -- commits atomically with patch and receipt; when it is absent — or the
  -- write fails for any reason — the exception is contained, a warning
  -- rides the result, and the metadata receipt stays canonical.
  -- Known accepted
  -- risk: two crossing supersede calls lock two thought rows each and can
  -- deadlock; Postgres aborts one cleanly and the caller retries.
  IF p_action OPERATOR(pg_catalog.=) 'mark_superseded' AND p_superseded_by IS NOT NULL THEN
    BEGIN
      EXECUTE $sql$
        UPDATE public.thoughts SET supersedes = $1 WHERE id OPERATOR(pg_catalog.=) $2
      $sql$
      USING p_thought_id, p_superseded_by;
      GET DIAGNOSTICS v_rowcount = ROW_COUNT;
      IF v_rowcount OPERATOR(pg_catalog.=) 0 THEN
        v_dual := pg_catalog.jsonb_build_object(
          'attempted', true, 'applied', false,
          'warning', pg_catalog.format(
            'supersedes dual-write matched no row for replacing thought %s (metadata receipt still recorded).',
            p_superseded_by));
      ELSE
        v_dual := pg_catalog.jsonb_build_object(
          'attempted', true, 'applied', true, 'warning', NULL);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_dual := pg_catalog.jsonb_build_object(
        'attempted', true, 'applied', false,
        'warning', pg_catalog.concat(
          'supersedes dual-write skipped (metadata receipt still recorded): ', SQLERRM));
    END;
  END IF;

  -- The brief outcome event, inside the transaction (store law L11): on
  -- the executor path there is no receipt-without-outcome halfway state —
  -- if this insert fails, everything above rolls back and the approval
  -- can simply be retried. The ONLY contained failure is the table not
  -- existing (this pack standing alone, without the brief store); any
  -- other failure — FK, CHECK, seq collision — aborts the whole write.
  IF v_linkage THEN
    v_outcome_label := CASE WHEN p_action OPERATOR(pg_catalog.=) 'defer' THEN 'deferred' ELSE 'approved' END;
    BEGIN
      EXECUTE $sql$
        INSERT INTO public.brief_item_outcome_events
          (brief_id, item_id, outcome, verb, actor, acted_at, lifecycle_event_id, note, detail)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}'::pg_catalog.jsonb)
        RETURNING seq
      $sql$
      INTO v_seq
      USING p_brief_id, p_item_id, v_outcome_label, p_action, p_actor, p_acted_at, v_receipt_id, v_note;
      v_outcome := pg_catalog.jsonb_build_object(
        'recorded', true, 'outcome', v_outcome_label, 'seq', v_seq);
    EXCEPTION WHEN undefined_table THEN
      v_outcome := pg_catalog.jsonb_build_object(
        'recorded', false, 'outcome', v_outcome_label,
        'warning', 'brief_item_outcome_events does not exist: the receipt committed without a store outcome event. Apply schemas/brief-artifact-store/schema.sql.');
    END;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'receipt_id', v_receipt_id,
    'thought_id', p_thought_id,
    'action', p_action,
    'before', v_before,
    'after', v_after,
    'supersedes_dual_write', v_dual,
    'outcome', v_outcome
  );
END
$fn$;

COMMENT ON FUNCTION public.receipted_thought_write(uuid, text, text, timestamptz, text, text, text, uuid, text, text, text, uuid, text, text, timestamptz) IS
  'The one write path for governed thought mutations: patch + receipt + supersedes pointer + outcome event, one transaction. Derives the action→status law, law metadata stamps, and the brief outcome label; validates actor format and per-action argument shape. SECURITY INVOKER — it adds no authority the caller lacks.';

-- Posture: service-role-only, like every write surface in this pack.
-- Postgres grants EXECUTE on new functions to PUBLIC by default; revoke it.
REVOKE ALL ON FUNCTION public.thought_state_summary(uuid, text, text, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.thought_state_summary(uuid, text, text, timestamptz, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.thought_state_summary(uuid, text, text, timestamptz, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.receipted_thought_write(uuid, text, text, timestamptz, text, text, text, uuid, text, text, text, uuid, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.receipted_thought_write(uuid, text, text, timestamptz, text, text, text, uuid, text, text, text, uuid, text, text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipted_thought_write(uuid, text, text, timestamptz, text, text, text, uuid, text, text, text, uuid, text, text, timestamptz) TO service_role;
