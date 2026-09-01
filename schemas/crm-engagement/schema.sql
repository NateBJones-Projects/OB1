-- ============================================================================
-- CRM engagement — notes, tasks, important dates, interactions, keep-in-touch
-- ============================================================================
--
-- The engagement layer that sits on top of CRM core (schemas/crm-core). Core
-- gives you an editable, human-owned contact record with a propose/accept
-- truth layer. This schema adds the day-to-day relationship surface around
-- each contact:
--
--   crm_contact_notes            — relationship notes (pinned, typed, private).
--   crm_contact_tasks            — lightweight follow-ups / reminders / todos.
--   crm_contact_important_dates  — birthdays / anniversaries / other dates.
--   crm_interactions             — a manual log of calls, meetings, messages.
--   crm_interaction_contacts     — which contacts took part in an interaction.
--   crm_contact_suggestion_reviews — review history for keep-in-touch nudges.
--
-- On top of those tables it derives, per contact, a relationship-health
-- summary (overdue tasks, due-soon tasks, upcoming dates, "gone quiet") and a
-- keep-in-touch suggestion queue. The suggestion engine reads ONLY this
-- engagement data plus crm_contacts — there is no Gmail pipeline, no entity
-- graph, and no projection cache dependency.
--
-- ── Relationship to CRM core ────────────────────────────────────────────────
--   PREREQUISITE: apply schemas/crm-core first. Every table here references
--   public.crm_contacts(id) (a UUID) with ON DELETE CASCADE, and the RPCs write
--   to crm_contact_change_log (created by crm-core). Applying this file without
--   crm-core will fail on the foreign keys — that is intended.
--
-- ── ID contract ─────────────────────────────────────────────────────────────
--   Every primary key is UUID (gen_random_uuid()). contact_id is
--   UUID REFERENCES public.crm_contacts(id) ON DELETE CASCADE. The only
--   reference to a memory row is crm_interactions.thought_id, which is
--   UUID REFERENCES public.thoughts(id) ON DELETE SET NULL — never bigint,
--   never brain_thoughts, never a view trigger.
--
-- ── Security model ──────────────────────────────────────────────────────────
--   RLS is enabled on every table. Each table additionally REVOKEs ALL from
--   PUBLIC, anon, and authenticated, then grants only what service_role needs,
--   so a project that blanket-grants new tables to its API roles cannot leave
--   relationship data exposed. Every function is SECURITY INVOKER with a fixed
--   search_path and is granted to service_role only.
--
-- ── Privacy + audit ─────────────────────────────────────────────────────────
--   Every row carries a privacy_tier (standard / sensitive / restricted). The
--   health and suggestion read paths exclude 'restricted' rows by default. The
--   change log inherited from crm-core records create/update/delete actions;
--   note/task/date bodies are NOT written into the change log (only ids,
--   types, and flags), so the audit trail never stores free-text relationship
--   content.
--
-- ── Idempotent + additive ───────────────────────────────────────────────────
--   CREATE TABLE / INDEX IF NOT EXISTS and CREATE OR REPLACE FUNCTION
--   throughout. Nothing on public.thoughts or public.crm_contacts is altered or
--   dropped. Rows are soft-deleted via a deleted_at timestamp, never hard
--   removed. Safe to re-run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── crm_contact_notes — relationship notes ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.crm_contact_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   UUID        NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  body         TEXT        NOT NULL,
  note_type    TEXT        NOT NULL DEFAULT 'relationship_note'
                 CHECK (note_type IN ('relationship_note', 'private_note', 'context')),
  pinned       BOOLEAN     NOT NULL DEFAULT false,
  privacy_tier TEXT        NOT NULL DEFAULT 'standard'
                 CHECK (privacy_tier IN ('standard', 'sensitive', 'restricted')),
  source       TEXT        NOT NULL DEFAULT 'manual',
  metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_by   TEXT        NOT NULL DEFAULT 'system',
  updated_by   TEXT        NOT NULL DEFAULT 'system',
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crm_contact_notes_contact
  ON public.crm_contact_notes (contact_id, deleted_at, pinned DESC, updated_at DESC);

COMMENT ON TABLE public.crm_contact_notes IS
  'Editable relationship notes linked to CRM contacts. CRM-layer data, not extracted thought evidence. Bodies are not copied into the change log.';

-- ─── crm_contact_tasks — follow-ups / reminders / todos ─────────────────────

CREATE TABLE IF NOT EXISTS public.crm_contact_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID        NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  title         TEXT        NOT NULL,
  description   TEXT,
  task_type     TEXT        NOT NULL DEFAULT 'follow_up'
                  CHECK (task_type IN ('follow_up', 'reminder', 'todo')),
  status        TEXT        NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'completed', 'snoozed', 'archived')),
  due_at        TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  priority      TEXT        NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low', 'normal', 'high')),
  privacy_tier  TEXT        NOT NULL DEFAULT 'standard'
                  CHECK (privacy_tier IN ('standard', 'sensitive', 'restricted')),
  source        TEXT        NOT NULL DEFAULT 'manual',
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_by    TEXT        NOT NULL DEFAULT 'system',
  updated_by    TEXT        NOT NULL DEFAULT 'system',
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crm_contact_tasks_contact
  ON public.crm_contact_tasks (contact_id, deleted_at, status, due_at NULLS LAST);

COMMENT ON TABLE public.crm_contact_tasks IS
  'Lightweight CRM follow-up tasks and reminders linked to contacts.';

-- ─── crm_contact_important_dates — birthdays / anniversaries / dates ────────

CREATE TABLE IF NOT EXISTS public.crm_contact_important_dates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   UUID        NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  label        TEXT        NOT NULL,
  date_value   DATE        NOT NULL,
  date_kind    TEXT        NOT NULL DEFAULT 'other'
                 CHECK (date_kind IN ('birthday', 'anniversary', 'work_anniversary', 'other')),
  recurrence   TEXT        NOT NULL DEFAULT 'annual'
                 CHECK (recurrence IN ('none', 'annual')),
  notes        TEXT,
  privacy_tier TEXT        NOT NULL DEFAULT 'standard'
                 CHECK (privacy_tier IN ('standard', 'sensitive', 'restricted')),
  source       TEXT        NOT NULL DEFAULT 'manual',
  metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_by   TEXT        NOT NULL DEFAULT 'system',
  updated_by   TEXT        NOT NULL DEFAULT 'system',
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crm_contact_important_dates_contact
  ON public.crm_contact_important_dates (contact_id, deleted_at, date_value);

-- Dedupe current (non-deleted) dates only.
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_contact_important_dates_dedupe
  ON public.crm_contact_important_dates (contact_id, lower(label), date_kind, date_value)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.crm_contact_important_dates IS
  'Important personal/professional dates for CRM contacts (birthdays, anniversaries, etc.).';

-- ─── crm_interactions — manual log of calls / meetings / messages ───────────

CREATE TABLE IF NOT EXISTS public.crm_interactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             TEXT        NOT NULL
                     CHECK (kind IN ('call', 'meeting', 'in_person', 'message', 'other')),
  occurred_at      TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER,
  summary          TEXT        NOT NULL CHECK (length(trim(summary)) > 0),
  thought_id       UUID        REFERENCES public.thoughts(id) ON DELETE SET NULL,
  origin           TEXT        NOT NULL DEFAULT 'manual'
                     CHECK (origin IN ('manual', 'import', 'extraction')),
  source_run_id    TEXT,
  privacy_tier     TEXT        NOT NULL DEFAULT 'standard'
                     CHECK (privacy_tier IN ('standard', 'sensitive', 'restricted')),
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_by       TEXT        NOT NULL DEFAULT 'system',
  updated_by       TEXT        NOT NULL DEFAULT 'system',
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crm_interactions_occurred_at
  ON public.crm_interactions (occurred_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_crm_interactions_thought
  ON public.crm_interactions (thought_id)
  WHERE thought_id IS NOT NULL;

COMMENT ON TABLE public.crm_interactions IS
  'Manual interaction log: calls, meetings, in-person, messages, and other off-channel relationship touchpoints. Feeds relationship health and keep-in-touch.';
COMMENT ON COLUMN public.crm_interactions.thought_id IS
  'Optional link to a supporting memory row (public.thoughts UUID).';

-- ─── crm_interaction_contacts — junction (participants) ─────────────────────

CREATE TABLE IF NOT EXISTS public.crm_interaction_contacts (
  interaction_id UUID NOT NULL REFERENCES public.crm_interactions(id) ON DELETE CASCADE,
  contact_id     UUID NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (interaction_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_interaction_contacts_contact
  ON public.crm_interaction_contacts (contact_id);

COMMENT ON TABLE public.crm_interaction_contacts IS
  'Links each interaction to one or more CRM contacts (participants).';

-- ─── crm_contact_suggestion_reviews — keep-in-touch review history ──────────

CREATE TABLE IF NOT EXISTS public.crm_contact_suggestion_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     UUID        NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  suggestion_key TEXT        NOT NULL,
  action         TEXT        NOT NULL CHECK (action IN ('dismissed', 'snoozed', 'converted_task')),
  snoozed_until  TIMESTAMPTZ,
  task_id        UUID        REFERENCES public.crm_contact_tasks(id) ON DELETE SET NULL,
  metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_by     TEXT        NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_crm_contact_suggestion_reviews_latest
  ON public.crm_contact_suggestion_reviews (contact_id, suggestion_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_contact_suggestion_reviews_action
  ON public.crm_contact_suggestion_reviews (action, snoozed_until);

COMMENT ON TABLE public.crm_contact_suggestion_reviews IS
  'Operator review history for CRM keep-in-touch suggestions (dismiss / snooze / convert-to-task).';

-- ============================================================================
-- Functions
-- ============================================================================
-- All RPCs are keyed on contact_id (a crm_contacts UUID), SECURITY INVOKER, and
-- run through crm_contact_change_log for audit. A small helper asserts the
-- contact exists so every write fails fast on a bad id.

-- ─── crm_engagement_contact_guard — internal existence check ────────────────

CREATE OR REPLACE FUNCTION public.crm_engagement_contact_guard(
  p_contact_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_contact_id IS NULL THEN
    RAISE EXCEPTION 'contact_id is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_contacts WHERE id = p_contact_id) THEN
    RAISE EXCEPTION 'CRM contact not found: %', p_contact_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_engagement_contact_guard(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_engagement_contact_guard(UUID) TO service_role;

-- ─── crm_contact_relationship_items — read notes + tasks + dates ────────────

CREATE OR REPLACE FUNCTION public.crm_contact_relationship_items(
  p_contact_id         UUID,
  p_exclude_restricted BOOLEAN DEFAULT true
) RETURNS TABLE (
  notes           JSONB,
  tasks           JSONB,
  important_dates JSONB
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT jsonb_agg(to_jsonb(n.*) ORDER BY n.pinned DESC, n.updated_at DESC)
      FROM public.crm_contact_notes n
      WHERE n.contact_id = p_contact_id
        AND n.deleted_at IS NULL
        AND (NOT COALESCE(p_exclude_restricted, true) OR n.privacy_tier <> 'restricted')
    ), '[]'::jsonb) AS notes,
    COALESCE((
      SELECT jsonb_agg(
        to_jsonb(t.*)
        ORDER BY
          CASE t.status WHEN 'open' THEN 1 WHEN 'snoozed' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
          t.due_at ASC NULLS LAST,
          t.updated_at DESC
      )
      FROM public.crm_contact_tasks t
      WHERE t.contact_id = p_contact_id
        AND t.deleted_at IS NULL
        AND (NOT COALESCE(p_exclude_restricted, true) OR t.privacy_tier <> 'restricted')
    ), '[]'::jsonb) AS tasks,
    COALESCE((
      SELECT jsonb_agg(to_jsonb(d.*) ORDER BY d.date_value ASC, d.label ASC)
      FROM public.crm_contact_important_dates d
      WHERE d.contact_id = p_contact_id
        AND d.deleted_at IS NULL
        AND (NOT COALESCE(p_exclude_restricted, true) OR d.privacy_tier <> 'restricted')
    ), '[]'::jsonb) AS important_dates;
$$;

REVOKE ALL ON FUNCTION public.crm_contact_relationship_items(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_contact_relationship_items(UUID, BOOLEAN) TO service_role;

-- ─── crm_add_contact_note ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_add_contact_note(
  p_contact_id   UUID,
  p_body         TEXT,
  p_note_type    TEXT DEFAULT 'relationship_note',
  p_pinned       BOOLEAN DEFAULT false,
  p_privacy_tier TEXT DEFAULT 'standard',
  p_actor        TEXT DEFAULT 'service'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor     TEXT := COALESCE(NULLIF(trim(p_actor), ''), 'service');
  v_body      TEXT := NULLIF(trim(COALESCE(p_body, '')), '');
  v_note_type TEXT := COALESCE(NULLIF(trim(p_note_type), ''), 'relationship_note');
  v_privacy   TEXT := COALESCE(NULLIF(trim(p_privacy_tier), ''), 'standard');
  v_note_id   UUID;
BEGIN
  PERFORM public.crm_engagement_contact_guard(p_contact_id);
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'note body is required';
  END IF;
  IF v_note_type NOT IN ('relationship_note', 'private_note', 'context') THEN
    RAISE EXCEPTION 'invalid note type: %', v_note_type;
  END IF;
  IF v_privacy NOT IN ('standard', 'sensitive', 'restricted') THEN
    RAISE EXCEPTION 'invalid privacy tier: %', v_privacy;
  END IF;

  INSERT INTO public.crm_contact_notes (
    contact_id, body, note_type, pinned, privacy_tier, source, created_by, updated_by
  )
  VALUES (
    p_contact_id, v_body, v_note_type, COALESCE(p_pinned, false), v_privacy, 'manual', v_actor, v_actor
  )
  RETURNING id INTO v_note_id;

  -- The note BODY is not written to the change log; only ids/types/flags.
  INSERT INTO public.crm_contact_change_log (contact_id, action, actor_label, changed_fields)
  VALUES (p_contact_id, 'note.create', v_actor,
          jsonb_build_object('note_id', v_note_id, 'note_type', v_note_type, 'privacy_tier', v_privacy, 'pinned', COALESCE(p_pinned, false)));

  RETURN (SELECT to_jsonb(n.*) FROM public.crm_contact_notes n WHERE n.id = v_note_id);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_add_contact_note(UUID, TEXT, TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_add_contact_note(UUID, TEXT, TEXT, BOOLEAN, TEXT, TEXT) TO service_role;

-- ─── crm_update_contact_note ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_update_contact_note(
  p_note_id      UUID,
  p_body         TEXT DEFAULT NULL,
  p_note_type    TEXT DEFAULT NULL,
  p_pinned       BOOLEAN DEFAULT NULL,
  p_privacy_tier TEXT DEFAULT NULL,
  p_deleted      BOOLEAN DEFAULT NULL,
  p_actor        TEXT DEFAULT 'service'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor      TEXT := COALESCE(NULLIF(trim(p_actor), ''), 'service');
  v_note_type  TEXT := NULLIF(trim(COALESCE(p_note_type, '')), '');
  v_privacy    TEXT := NULLIF(trim(COALESCE(p_privacy_tier, '')), '');
  v_contact_id UUID;
BEGIN
  SELECT n.contact_id INTO v_contact_id
  FROM public.crm_contact_notes n
  WHERE n.id = p_note_id
  FOR UPDATE;

  IF v_contact_id IS NULL THEN
    RAISE EXCEPTION 'CRM contact note not found: %', p_note_id;
  END IF;
  IF v_note_type IS NOT NULL AND v_note_type NOT IN ('relationship_note', 'private_note', 'context') THEN
    RAISE EXCEPTION 'invalid note type: %', v_note_type;
  END IF;
  IF v_privacy IS NOT NULL AND v_privacy NOT IN ('standard', 'sensitive', 'restricted') THEN
    RAISE EXCEPTION 'invalid privacy tier: %', v_privacy;
  END IF;

  UPDATE public.crm_contact_notes n
  SET body         = COALESCE(NULLIF(trim(COALESCE(p_body, '')), ''), n.body),
      note_type    = COALESCE(v_note_type, n.note_type),
      pinned       = COALESCE(p_pinned, n.pinned),
      privacy_tier = COALESCE(v_privacy, n.privacy_tier),
      deleted_at   = CASE WHEN p_deleted IS true THEN timezone('utc', now())
                          WHEN p_deleted IS false THEN NULL
                          ELSE n.deleted_at END,
      updated_at   = timezone('utc', now()),
      updated_by   = v_actor
  WHERE n.id = p_note_id;

  INSERT INTO public.crm_contact_change_log (contact_id, action, actor_label, changed_fields)
  VALUES (v_contact_id, 'note.update', v_actor,
          jsonb_strip_nulls(jsonb_build_object('note_id', p_note_id, 'note_type', v_note_type, 'privacy_tier', v_privacy, 'deleted', p_deleted)));

  RETURN (SELECT to_jsonb(n.*) FROM public.crm_contact_notes n WHERE n.id = p_note_id);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_update_contact_note(UUID, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_update_contact_note(UUID, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT) TO service_role;

-- ─── crm_add_contact_task ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_add_contact_task(
  p_contact_id    UUID,
  p_title         TEXT,
  p_description   TEXT DEFAULT NULL,
  p_task_type     TEXT DEFAULT 'follow_up',
  p_status        TEXT DEFAULT 'open',
  p_due_at        TIMESTAMPTZ DEFAULT NULL,
  p_snoozed_until TIMESTAMPTZ DEFAULT NULL,
  p_priority      TEXT DEFAULT 'normal',
  p_privacy_tier  TEXT DEFAULT 'standard',
  p_actor         TEXT DEFAULT 'service'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor     TEXT := COALESCE(NULLIF(trim(p_actor), ''), 'service');
  v_title     TEXT := NULLIF(trim(COALESCE(p_title, '')), '');
  v_task_type TEXT := COALESCE(NULLIF(trim(p_task_type), ''), 'follow_up');
  v_status    TEXT := COALESCE(NULLIF(trim(p_status), ''), 'open');
  v_priority  TEXT := COALESCE(NULLIF(trim(p_priority), ''), 'normal');
  v_privacy   TEXT := COALESCE(NULLIF(trim(p_privacy_tier), ''), 'standard');
  v_task_id   UUID;
BEGIN
  PERFORM public.crm_engagement_contact_guard(p_contact_id);
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'task title is required';
  END IF;
  IF v_task_type NOT IN ('follow_up', 'reminder', 'todo') THEN
    RAISE EXCEPTION 'invalid task type: %', v_task_type;
  END IF;
  IF v_status NOT IN ('open', 'completed', 'snoozed', 'archived') THEN
    RAISE EXCEPTION 'invalid task status: %', v_status;
  END IF;
  IF v_priority NOT IN ('low', 'normal', 'high') THEN
    RAISE EXCEPTION 'invalid task priority: %', v_priority;
  END IF;
  IF v_privacy NOT IN ('standard', 'sensitive', 'restricted') THEN
    RAISE EXCEPTION 'invalid privacy tier: %', v_privacy;
  END IF;

  INSERT INTO public.crm_contact_tasks (
    contact_id, title, description, task_type, status, due_at, snoozed_until,
    completed_at, priority, privacy_tier, source, created_by, updated_by
  )
  VALUES (
    p_contact_id, v_title, NULLIF(trim(COALESCE(p_description, '')), ''),
    v_task_type, v_status, p_due_at, p_snoozed_until,
    CASE WHEN v_status = 'completed' THEN timezone('utc', now()) ELSE NULL END,
    v_priority, v_privacy, 'manual', v_actor, v_actor
  )
  RETURNING id INTO v_task_id;

  INSERT INTO public.crm_contact_change_log (contact_id, action, actor_label, changed_fields)
  VALUES (p_contact_id, 'task.create', v_actor,
          jsonb_strip_nulls(jsonb_build_object('task_id', v_task_id, 'task_type', v_task_type, 'status', v_status, 'due_at', p_due_at)));

  RETURN (SELECT to_jsonb(t.*) FROM public.crm_contact_tasks t WHERE t.id = v_task_id);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_add_contact_task(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_add_contact_task(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT) TO service_role;

-- ─── crm_update_contact_task ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_update_contact_task(
  p_task_id       UUID,
  p_title         TEXT DEFAULT NULL,
  p_description   TEXT DEFAULT NULL,
  p_task_type     TEXT DEFAULT NULL,
  p_status        TEXT DEFAULT NULL,
  p_due_at        TIMESTAMPTZ DEFAULT NULL,
  p_snoozed_until TIMESTAMPTZ DEFAULT NULL,
  p_priority      TEXT DEFAULT NULL,
  p_privacy_tier  TEXT DEFAULT NULL,
  p_deleted       BOOLEAN DEFAULT NULL,
  p_actor         TEXT DEFAULT 'service'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor      TEXT := COALESCE(NULLIF(trim(p_actor), ''), 'service');
  v_task_type  TEXT := NULLIF(trim(COALESCE(p_task_type, '')), '');
  v_status     TEXT := NULLIF(trim(COALESCE(p_status, '')), '');
  v_priority   TEXT := NULLIF(trim(COALESCE(p_priority, '')), '');
  v_privacy    TEXT := NULLIF(trim(COALESCE(p_privacy_tier, '')), '');
  v_contact_id UUID;
BEGIN
  SELECT t.contact_id INTO v_contact_id
  FROM public.crm_contact_tasks t
  WHERE t.id = p_task_id
  FOR UPDATE;

  IF v_contact_id IS NULL THEN
    RAISE EXCEPTION 'CRM contact task not found: %', p_task_id;
  END IF;
  IF v_task_type IS NOT NULL AND v_task_type NOT IN ('follow_up', 'reminder', 'todo') THEN
    RAISE EXCEPTION 'invalid task type: %', v_task_type;
  END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('open', 'completed', 'snoozed', 'archived') THEN
    RAISE EXCEPTION 'invalid task status: %', v_status;
  END IF;
  IF v_priority IS NOT NULL AND v_priority NOT IN ('low', 'normal', 'high') THEN
    RAISE EXCEPTION 'invalid task priority: %', v_priority;
  END IF;
  IF v_privacy IS NOT NULL AND v_privacy NOT IN ('standard', 'sensitive', 'restricted') THEN
    RAISE EXCEPTION 'invalid privacy tier: %', v_privacy;
  END IF;

  UPDATE public.crm_contact_tasks t
  SET title         = COALESCE(NULLIF(trim(COALESCE(p_title, '')), ''), t.title),
      description   = COALESCE(NULLIF(trim(COALESCE(p_description, '')), ''), t.description),
      task_type     = COALESCE(v_task_type, t.task_type),
      status        = COALESCE(v_status, t.status),
      due_at        = COALESCE(p_due_at, t.due_at),
      snoozed_until = COALESCE(p_snoozed_until, t.snoozed_until),
      completed_at  = CASE
                        WHEN v_status = 'completed' AND t.completed_at IS NULL THEN timezone('utc', now())
                        WHEN v_status IS NOT NULL AND v_status <> 'completed' THEN NULL
                        ELSE t.completed_at
                      END,
      priority      = COALESCE(v_priority, t.priority),
      privacy_tier  = COALESCE(v_privacy, t.privacy_tier),
      deleted_at    = CASE WHEN p_deleted IS true THEN timezone('utc', now())
                           WHEN p_deleted IS false THEN NULL
                           ELSE t.deleted_at END,
      updated_at    = timezone('utc', now()),
      updated_by    = v_actor
  WHERE t.id = p_task_id;

  INSERT INTO public.crm_contact_change_log (contact_id, action, actor_label, changed_fields)
  VALUES (v_contact_id, 'task.update', v_actor,
          jsonb_strip_nulls(jsonb_build_object('task_id', p_task_id, 'status', v_status, 'due_at', p_due_at, 'snoozed_until', p_snoozed_until, 'deleted', p_deleted)));

  RETURN (SELECT to_jsonb(t.*) FROM public.crm_contact_tasks t WHERE t.id = p_task_id);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_update_contact_task(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_update_contact_task(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN, TEXT) TO service_role;

-- ─── crm_add_contact_important_date ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_add_contact_important_date(
  p_contact_id   UUID,
  p_label        TEXT,
  p_date_value   DATE,
  p_date_kind    TEXT DEFAULT 'other',
  p_recurrence   TEXT DEFAULT 'annual',
  p_notes        TEXT DEFAULT NULL,
  p_privacy_tier TEXT DEFAULT 'standard',
  p_actor        TEXT DEFAULT 'service'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor      TEXT := COALESCE(NULLIF(trim(p_actor), ''), 'service');
  v_label      TEXT := NULLIF(trim(COALESCE(p_label, '')), '');
  v_date_kind  TEXT := COALESCE(NULLIF(trim(p_date_kind), ''), 'other');
  v_recurrence TEXT := COALESCE(NULLIF(trim(p_recurrence), ''), 'annual');
  v_privacy    TEXT := COALESCE(NULLIF(trim(p_privacy_tier), ''), 'standard');
  v_date_id    UUID;
BEGIN
  PERFORM public.crm_engagement_contact_guard(p_contact_id);
  IF v_label IS NULL THEN
    RAISE EXCEPTION 'important date label is required';
  END IF;
  IF p_date_value IS NULL THEN
    RAISE EXCEPTION 'important date value is required';
  END IF;
  IF v_date_kind NOT IN ('birthday', 'anniversary', 'work_anniversary', 'other') THEN
    RAISE EXCEPTION 'invalid important date kind: %', v_date_kind;
  END IF;
  IF v_recurrence NOT IN ('none', 'annual') THEN
    RAISE EXCEPTION 'invalid recurrence: %', v_recurrence;
  END IF;
  IF v_privacy NOT IN ('standard', 'sensitive', 'restricted') THEN
    RAISE EXCEPTION 'invalid privacy tier: %', v_privacy;
  END IF;

  INSERT INTO public.crm_contact_important_dates (
    contact_id, label, date_value, date_kind, recurrence, notes, privacy_tier, source, created_by, updated_by
  )
  VALUES (
    p_contact_id, v_label, p_date_value, v_date_kind, v_recurrence,
    NULLIF(trim(COALESCE(p_notes, '')), ''), v_privacy, 'manual', v_actor, v_actor
  )
  ON CONFLICT (contact_id, lower(label), date_kind, date_value)
    WHERE deleted_at IS NULL
  DO UPDATE
    SET recurrence   = EXCLUDED.recurrence,
        notes        = EXCLUDED.notes,
        privacy_tier = EXCLUDED.privacy_tier,
        updated_at   = timezone('utc', now()),
        updated_by   = EXCLUDED.updated_by
  RETURNING id INTO v_date_id;

  INSERT INTO public.crm_contact_change_log (contact_id, action, actor_label, changed_fields)
  VALUES (p_contact_id, 'important_date.upsert', v_actor,
          jsonb_build_object('important_date_id', v_date_id, 'date_kind', v_date_kind, 'recurrence', v_recurrence));

  RETURN (SELECT to_jsonb(d.*) FROM public.crm_contact_important_dates d WHERE d.id = v_date_id);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_add_contact_important_date(UUID, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_add_contact_important_date(UUID, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ─── crm_update_contact_important_date ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_update_contact_important_date(
  p_important_date_id UUID,
  p_label             TEXT DEFAULT NULL,
  p_date_value        DATE DEFAULT NULL,
  p_date_kind         TEXT DEFAULT NULL,
  p_recurrence        TEXT DEFAULT NULL,
  p_notes             TEXT DEFAULT NULL,
  p_privacy_tier      TEXT DEFAULT NULL,
  p_deleted           BOOLEAN DEFAULT NULL,
  p_actor             TEXT DEFAULT 'service'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor      TEXT := COALESCE(NULLIF(trim(p_actor), ''), 'service');
  v_date_kind  TEXT := NULLIF(trim(COALESCE(p_date_kind, '')), '');
  v_recurrence TEXT := NULLIF(trim(COALESCE(p_recurrence, '')), '');
  v_privacy    TEXT := NULLIF(trim(COALESCE(p_privacy_tier, '')), '');
  v_contact_id UUID;
BEGIN
  SELECT d.contact_id INTO v_contact_id
  FROM public.crm_contact_important_dates d
  WHERE d.id = p_important_date_id
  FOR UPDATE;

  IF v_contact_id IS NULL THEN
    RAISE EXCEPTION 'CRM important date not found: %', p_important_date_id;
  END IF;
  IF v_date_kind IS NOT NULL AND v_date_kind NOT IN ('birthday', 'anniversary', 'work_anniversary', 'other') THEN
    RAISE EXCEPTION 'invalid important date kind: %', v_date_kind;
  END IF;
  IF v_recurrence IS NOT NULL AND v_recurrence NOT IN ('none', 'annual') THEN
    RAISE EXCEPTION 'invalid recurrence: %', v_recurrence;
  END IF;
  IF v_privacy IS NOT NULL AND v_privacy NOT IN ('standard', 'sensitive', 'restricted') THEN
    RAISE EXCEPTION 'invalid privacy tier: %', v_privacy;
  END IF;

  UPDATE public.crm_contact_important_dates d
  SET label        = COALESCE(NULLIF(trim(COALESCE(p_label, '')), ''), d.label),
      date_value   = COALESCE(p_date_value, d.date_value),
      date_kind    = COALESCE(v_date_kind, d.date_kind),
      recurrence   = COALESCE(v_recurrence, d.recurrence),
      notes        = COALESCE(NULLIF(trim(COALESCE(p_notes, '')), ''), d.notes),
      privacy_tier = COALESCE(v_privacy, d.privacy_tier),
      deleted_at   = CASE WHEN p_deleted IS true THEN timezone('utc', now())
                          WHEN p_deleted IS false THEN NULL
                          ELSE d.deleted_at END,
      updated_at   = timezone('utc', now()),
      updated_by   = v_actor
  WHERE d.id = p_important_date_id;

  INSERT INTO public.crm_contact_change_log (contact_id, action, actor_label, changed_fields)
  VALUES (v_contact_id, 'important_date.update', v_actor,
          jsonb_strip_nulls(jsonb_build_object('important_date_id', p_important_date_id, 'date_kind', v_date_kind, 'recurrence', v_recurrence, 'deleted', p_deleted)));

  RETURN (SELECT to_jsonb(d.*) FROM public.crm_contact_important_dates d WHERE d.id = p_important_date_id);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_update_contact_important_date(UUID, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_update_contact_important_date(UUID, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO service_role;

-- ─── crm_log_interaction — log a call / meeting / message ───────────────────
-- Participants are CRM contact UUIDs. Unknown / archived participants are
-- SKIPPED (reported back), not fatal — a group interaction must not abort
-- because one participant was archived or mistyped.

CREATE OR REPLACE FUNCTION public.crm_log_interaction(
  p_contact_ids      UUID[],
  p_kind             TEXT,
  p_occurred_at      TIMESTAMPTZ,
  p_summary          TEXT,
  p_duration_minutes INTEGER DEFAULT NULL,
  p_privacy_tier     TEXT DEFAULT 'standard',
  p_thought_id       UUID DEFAULT NULL,
  p_actor            TEXT DEFAULT 'service'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor       TEXT := COALESCE(NULLIF(trim(p_actor), ''), 'service');
  v_kind        TEXT := COALESCE(NULLIF(trim(p_kind), ''), '');
  v_summary     TEXT := NULLIF(trim(COALESCE(p_summary, '')), '');
  v_privacy     TEXT := COALESCE(NULLIF(trim(p_privacy_tier), ''), 'standard');
  v_occurred_at TIMESTAMPTZ := COALESCE(p_occurred_at, timezone('utc', now()));
  v_interaction_id UUID;
  v_contact_ids UUID[] := ARRAY[]::UUID[];
  v_contact_id  UUID;
  v_skipped     UUID[] := ARRAY[]::UUID[];
BEGIN
  IF v_kind NOT IN ('call', 'meeting', 'in_person', 'message', 'other') THEN
    RAISE EXCEPTION 'invalid interaction kind: %', p_kind;
  END IF;
  IF v_summary IS NULL THEN
    RAISE EXCEPTION 'interaction summary is required';
  END IF;
  IF v_privacy NOT IN ('standard', 'sensitive', 'restricted') THEN
    RAISE EXCEPTION 'invalid privacy tier: %', v_privacy;
  END IF;
  IF p_contact_ids IS NULL OR array_length(p_contact_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one contact_id is required';
  END IF;

  -- Resolve participants. Active, existing contacts are linked; missing or
  -- archived ones are collected as skipped rather than aborting the log.
  FOREACH v_contact_id IN ARRAY p_contact_ids
  LOOP
    IF v_contact_id IS NULL THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.crm_contacts c
      WHERE c.id = v_contact_id
        AND c.lifecycle_status <> 'archived'
    ) THEN
      IF NOT (v_contact_id = ANY(v_contact_ids)) THEN
        v_contact_ids := v_contact_ids || v_contact_id;
      END IF;
    ELSE
      v_skipped := v_skipped || v_contact_id;
    END IF;
  END LOOP;

  IF array_length(v_contact_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no active CRM contacts among the supplied ids';
  END IF;

  INSERT INTO public.crm_interactions (
    kind, occurred_at, duration_minutes, summary, thought_id, origin, privacy_tier, created_by, updated_by
  )
  VALUES (
    v_kind, v_occurred_at, p_duration_minutes, v_summary, p_thought_id, 'manual', v_privacy, v_actor, v_actor
  )
  RETURNING id INTO v_interaction_id;

  INSERT INTO public.crm_interaction_contacts (interaction_id, contact_id)
  SELECT v_interaction_id, unnest(v_contact_ids);

  -- Audit one change-log row per participant. The summary text is NOT copied
  -- into the log; only the interaction id and kind.
  FOREACH v_contact_id IN ARRAY v_contact_ids
  LOOP
    INSERT INTO public.crm_contact_change_log (contact_id, action, actor_label, changed_fields)
    VALUES (v_contact_id, 'interaction.log', v_actor,
            jsonb_build_object('interaction_id', v_interaction_id, 'kind', v_kind, 'occurred_at', v_occurred_at));
  END LOOP;

  RETURN jsonb_build_object(
    'interaction_id', v_interaction_id,
    'kind', v_kind,
    'occurred_at', v_occurred_at,
    'summary', v_summary,
    'contact_ids', to_jsonb(v_contact_ids),
    'skipped_contact_ids', to_jsonb(v_skipped)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.crm_log_interaction(UUID[], TEXT, TIMESTAMPTZ, TEXT, INTEGER, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_log_interaction(UUID[], TEXT, TIMESTAMPTZ, TEXT, INTEGER, TEXT, UUID, TEXT) TO service_role;

-- ─── crm_update_interaction — edit / soft-delete an interaction ─────────────

CREATE OR REPLACE FUNCTION public.crm_update_interaction(
  p_interaction_id   UUID,
  p_summary          TEXT DEFAULT NULL,
  p_occurred_at      TIMESTAMPTZ DEFAULT NULL,
  p_duration_minutes INTEGER DEFAULT NULL,
  p_privacy_tier     TEXT DEFAULT NULL,
  p_deleted          BOOLEAN DEFAULT NULL,
  p_actor            TEXT DEFAULT 'service'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor   TEXT := COALESCE(NULLIF(trim(p_actor), ''), 'service');
  v_privacy TEXT := NULLIF(trim(COALESCE(p_privacy_tier, '')), '');
  v_row     public.crm_interactions%ROWTYPE;
  v_summary TEXT;
BEGIN
  SELECT * INTO v_row
  FROM public.crm_interactions
  WHERE id = p_interaction_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'interaction not found: %', p_interaction_id;
  END IF;
  IF v_privacy IS NOT NULL AND v_privacy NOT IN ('standard', 'sensitive', 'restricted') THEN
    RAISE EXCEPTION 'invalid privacy tier: %', v_privacy;
  END IF;
  -- A deleted interaction is immutable unless the caller explicitly undeletes
  -- it (p_deleted = false). p_deleted = null on a deleted row is a no-op.
  IF v_row.deleted_at IS NOT NULL AND p_deleted IS DISTINCT FROM false THEN
    RETURN jsonb_build_object('interaction_id', v_row.id, 'changed', false, 'reason', 'already deleted');
  END IF;

  v_summary := COALESCE(NULLIF(trim(COALESCE(p_summary, '')), ''), v_row.summary);
  IF v_summary IS NULL OR trim(v_summary) = '' THEN
    RAISE EXCEPTION 'summary cannot be cleared';
  END IF;

  UPDATE public.crm_interactions
  SET summary          = v_summary,
      occurred_at      = COALESCE(p_occurred_at, occurred_at),
      duration_minutes = COALESCE(p_duration_minutes, duration_minutes),
      privacy_tier     = COALESCE(v_privacy, privacy_tier),
      deleted_at       = CASE
                           WHEN p_deleted IS true THEN timezone('utc', now())
                           WHEN p_deleted IS false THEN NULL
                           ELSE deleted_at
                         END,
      updated_at       = timezone('utc', now()),
      updated_by       = v_actor
  WHERE id = p_interaction_id;

  INSERT INTO public.crm_contact_change_log (contact_id, action, actor_label, changed_fields)
  SELECT ic.contact_id, 'interaction.update', v_actor,
         jsonb_build_object('interaction_id', p_interaction_id,
                            'deleted', COALESCE(p_deleted, v_row.deleted_at IS NOT NULL))
  FROM public.crm_interaction_contacts ic
  WHERE ic.interaction_id = p_interaction_id;

  RETURN jsonb_build_object('interaction_id', v_row.id, 'changed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_update_interaction(UUID, TEXT, TIMESTAMPTZ, INTEGER, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_update_interaction(UUID, TEXT, TIMESTAMPTZ, INTEGER, TEXT, BOOLEAN, TEXT) TO service_role;

-- ─── crm_contact_interactions — read the interaction log for a contact ──────

CREATE OR REPLACE FUNCTION public.crm_contact_interactions(
  p_contact_id         UUID,
  p_limit              INTEGER DEFAULT 50,
  p_offset             INTEGER DEFAULT 0,
  p_exclude_restricted BOOLEAN DEFAULT true
) RETURNS TABLE (
  interaction_id   UUID,
  kind             TEXT,
  occurred_at      TIMESTAMPTZ,
  duration_minutes INTEGER,
  summary          TEXT,
  privacy_tier     TEXT,
  origin           TEXT,
  thought_id       UUID,
  created_at       TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    ci.id,
    ci.kind,
    ci.occurred_at,
    ci.duration_minutes,
    ci.summary,
    ci.privacy_tier,
    ci.origin,
    ci.thought_id,
    ci.created_at
  FROM public.crm_interactions ci
  JOIN public.crm_interaction_contacts ic ON ic.interaction_id = ci.id
  WHERE ic.contact_id = p_contact_id
    AND ci.deleted_at IS NULL
    AND (NOT COALESCE(p_exclude_restricted, true) OR ci.privacy_tier <> 'restricted')
  ORDER BY ci.occurred_at DESC
  LIMIT greatest(1, least(COALESCE(p_limit, 50), 200))
  OFFSET greatest(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.crm_contact_interactions(UUID, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_contact_interactions(UUID, INTEGER, INTEGER, BOOLEAN) TO service_role;

-- ─── crm_contact_relationship_health — derived health for one contact ───────
-- Self-contained: reads ONLY engagement tables (tasks, important dates,
-- interactions) for this contact. No Gmail, no entity graph, no projection
-- cache. last_meaningful_interaction_at is the most recent non-deleted logged
-- interaction. "Gone quiet" (stale) fires when there is no interaction in the
-- last 90 days.

CREATE OR REPLACE FUNCTION public.crm_contact_relationship_health(
  p_contact_id         UUID,
  p_exclude_restricted BOOLEAN DEFAULT true
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
SET statement_timeout = '10s'
AS $$
  WITH params AS (
    SELECT COALESCE(p_exclude_restricted, true) AS v_exclude_restricted
  ),
  base AS (
    SELECT c.id, c.display_name, c.lifecycle_status
    FROM public.crm_contacts c
    WHERE c.id = p_contact_id
    LIMIT 1
  ),
  logged_interaction AS (
    SELECT max(ci.occurred_at) AS last_logged_interaction_at
    FROM base b
    JOIN public.crm_interaction_contacts ic ON ic.contact_id = b.id
    JOIN public.crm_interactions ci ON ci.id = ic.interaction_id
    CROSS JOIN params p
    WHERE ci.deleted_at IS NULL
      AND (NOT p.v_exclude_restricted OR ci.privacy_tier <> 'restricted')
  ),
  task_rollup AS (
    -- An "active" task is one that should draw attention right now: status
    -- 'open', OR 'snoozed' whose snooze has already expired (snoozed_until in
    -- the past). A task still snoozed into the future counts only toward
    -- snoozed_task_count, so expired snoozes resurface as overdue/due-soon.
    SELECT
      count(*) FILTER (
        WHERE t.status = 'open'
           OR (t.status = 'snoozed' AND COALESCE(t.snoozed_until, now()) <= now())
      )::integer AS open_task_count,
      count(*) FILTER (
        WHERE (t.status = 'open'
               OR (t.status = 'snoozed' AND COALESCE(t.snoozed_until, now()) <= now()))
          AND t.due_at IS NOT NULL AND t.due_at < now()
      )::integer AS overdue_task_count,
      count(*) FILTER (
        WHERE (t.status = 'open'
               OR (t.status = 'snoozed' AND COALESCE(t.snoozed_until, now()) <= now()))
          AND t.due_at IS NOT NULL
          AND t.due_at >= now() AND t.due_at <= now() + interval '14 days'
      )::integer AS due_soon_task_count,
      count(*) FILTER (
        WHERE t.status = 'snoozed' AND t.snoozed_until IS NOT NULL AND t.snoozed_until > now()
      )::integer AS snoozed_task_count,
      min(t.due_at) FILTER (
        WHERE (t.status = 'open'
               OR (t.status = 'snoozed' AND COALESCE(t.snoozed_until, now()) <= now()))
          AND t.due_at IS NOT NULL
      ) AS next_task_due_at,
      -- Id of the earliest-due active task — the specific task that drives an
      -- overdue/due-soon action. Carried into the suggestion so the key can
      -- version per source task (a new overdue task re-enters the queue) and so
      -- a convert action can link the existing task instead of duplicating it.
      -- Computed as an aggregate over the same joined task set (ordered by
      -- due_at then id) so it stays consistent with next_task_due_at.
      (array_agg(t.id ORDER BY t.due_at ASC NULLS LAST, t.id ASC) FILTER (
        WHERE (t.status = 'open'
               OR (t.status = 'snoozed' AND COALESCE(t.snoozed_until, now()) <= now()))
          AND t.due_at IS NOT NULL
      ))[1] AS next_task_id
    FROM base b
    JOIN public.crm_contact_tasks t ON t.contact_id = b.id
    CROSS JOIN params p
    WHERE t.deleted_at IS NULL
      AND (NOT p.v_exclude_restricted OR t.privacy_tier <> 'restricted')
  ),
  date_instances AS (
    SELECT
      d.label,
      CASE
        WHEN d.recurrence = 'annual' THEN
          -- Leap-safe annual recurrence: add whole years to the original date
          -- via interval arithmetic, which clamps Feb 29 to Feb 28 in non-leap
          -- years instead of raising a date-out-of-range error. Add one more
          -- year if this year's occurrence has already passed.
          (
            d.date_value
              + make_interval(years => greatest(0, (extract(year FROM current_date) - extract(year FROM d.date_value))::int))
          )
          + CASE
              WHEN (d.date_value
                     + make_interval(years => greatest(0, (extract(year FROM current_date) - extract(year FROM d.date_value))::int))
                   ) < current_date
                THEN interval '1 year'
              ELSE interval '0'
            END
        ELSE d.date_value
      END::date AS next_occurrence_on
    FROM base b
    JOIN public.crm_contact_important_dates d ON d.contact_id = b.id
    CROSS JOIN params p
    WHERE d.deleted_at IS NULL
      AND (NOT p.v_exclude_restricted OR d.privacy_tier <> 'restricted')
  ),
  date_rollup AS (
    SELECT
      count(*) FILTER (
        WHERE next_occurrence_on >= current_date AND next_occurrence_on <= current_date + 30
      )::integer AS upcoming_date_count,
      min(next_occurrence_on) FILTER (
        WHERE next_occurrence_on >= current_date AND next_occurrence_on <= current_date + 30
      ) AS next_upcoming_date_on,
      (array_agg(label ORDER BY next_occurrence_on) FILTER (
        WHERE next_occurrence_on >= current_date AND next_occurrence_on <= current_date + 30
      ))[1] AS next_upcoming_date_label
    FROM date_instances
  ),
  signals AS (
    SELECT
      b.display_name,
      (SELECT last_logged_interaction_at FROM logged_interaction) AS last_meaningful_interaction_at,
      COALESCE(tr.open_task_count, 0)    AS open_task_count,
      COALESCE(tr.overdue_task_count, 0) AS overdue_task_count,
      COALESCE(tr.due_soon_task_count, 0) AS due_soon_task_count,
      COALESCE(tr.snoozed_task_count, 0) AS snoozed_task_count,
      tr.next_task_due_at,
      tr.next_task_id,
      COALESCE(dr.upcoming_date_count, 0) AS upcoming_date_count,
      dr.next_upcoming_date_on,
      dr.next_upcoming_date_label,
      (
        (SELECT last_logged_interaction_at FROM logged_interaction) IS NULL
        OR (SELECT last_logged_interaction_at FROM logged_interaction) < now() - interval '90 days'
      ) AS stale
    FROM base b
    LEFT JOIN task_rollup tr ON true
    LEFT JOIN date_rollup dr ON true
  ),
  actions AS (
    SELECT
      s.*,
      CASE
        WHEN s.overdue_task_count > 0 THEN 'overdue_task'
        WHEN s.due_soon_task_count > 0 THEN 'due_task'
        WHEN s.upcoming_date_count > 0 THEN 'upcoming_date'
        WHEN s.stale THEN 'reconnect'
        ELSE 'none'
      END AS next_action_kind,
      CASE
        WHEN s.overdue_task_count > 0 THEN 'Follow up on overdue task'
        WHEN s.due_soon_task_count > 0 THEN 'Follow up soon'
        WHEN s.upcoming_date_count > 0 THEN 'Acknowledge upcoming date'
        WHEN s.stale THEN 'Keep in touch'
        ELSE 'No action needed'
      END AS next_action_label,
      CASE
        WHEN s.overdue_task_count > 0 THEN s.next_task_due_at
        WHEN s.due_soon_task_count > 0 THEN s.next_task_due_at
        WHEN s.upcoming_date_count > 0 THEN s.next_upcoming_date_on::timestamptz
        WHEN s.stale THEN COALESCE(s.last_meaningful_interaction_at + interval '90 days', now())
        ELSE NULL::timestamptz
      END AS next_action_at
    FROM signals s
  ),
  health AS (
    SELECT
      a.*,
      CASE
        WHEN a.overdue_task_count > 0 OR a.stale THEN 'needs_attention'
        WHEN a.due_soon_task_count > 0 OR a.upcoming_date_count > 0 THEN 'upcoming'
        WHEN a.last_meaningful_interaction_at IS NULL
          OR a.last_meaningful_interaction_at < now() - interval '365 days' THEN 'quiet'
        ELSE 'healthy'
      END AS status,
      least(
        100,
        (a.overdue_task_count * 40)
          + (a.due_soon_task_count * 25)
          + (a.upcoming_date_count * 15)
          + (CASE WHEN a.stale THEN 30 ELSE 0 END)
          + least(a.open_task_count * 5, 20)
      )::integer AS score,
      to_jsonb(array_remove(ARRAY[
        CASE WHEN a.overdue_task_count > 0 THEN 'overdue_task' END,
        CASE WHEN a.due_soon_task_count > 0 THEN 'due_task' END,
        CASE WHEN a.snoozed_task_count > 0 THEN 'snoozed_task' END,
        CASE WHEN a.upcoming_date_count > 0 THEN 'upcoming_date' END,
        CASE WHEN a.stale THEN 'stale' END,
        CASE WHEN a.last_meaningful_interaction_at IS NOT NULL THEN 'has_logged_interaction' END
      ]::text[], NULL)) AS reasons
    FROM actions a
  )
  SELECT jsonb_build_object(
    'status', h.status,
    'score', h.score,
    'last_meaningful_interaction_at', h.last_meaningful_interaction_at,
    'stale', h.stale,
    'open_task_count', h.open_task_count,
    'overdue_task_count', h.overdue_task_count,
    'due_soon_task_count', h.due_soon_task_count,
    'snoozed_task_count', h.snoozed_task_count,
    'next_task_id', h.next_task_id,
    'upcoming_date_count', h.upcoming_date_count,
    'next_upcoming_date_on', h.next_upcoming_date_on,
    'next_upcoming_date_label', h.next_upcoming_date_label,
    'next_action_kind', h.next_action_kind,
    'next_action_label', h.next_action_label,
    'next_action_at', h.next_action_at,
    'reasons', h.reasons
  )
  FROM health h;
$$;

REVOKE ALL ON FUNCTION public.crm_contact_relationship_health(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_contact_relationship_health(UUID, BOOLEAN) TO service_role;

-- ─── crm_keep_in_touch_suggestions — the review queue ───────────────────────
-- A self-contained keep-in-touch queue derived from each active contact's
-- relationship health. One suggestion per contact whose next_action_kind is not
-- 'none'. The latest review (dismiss / snooze / convert) decides whether the
-- suggestion is still "open". No Gmail, no entity graph, no projection cache.

-- This function's RETURNS TABLE shape gained a source_task_id column. Postgres
-- refuses to CREATE OR REPLACE a function with a changed OUT-parameter row type,
-- so an existing install must drop the old definition first. The DROP is keyed
-- on the exact argument signature and is a no-op on a fresh database. RPC-to-RPC
-- calls (crm_update_keep_in_touch_suggestion → this) create no hard dependency,
-- so the drop is safe to run before the recreate.
DROP FUNCTION IF EXISTS public.crm_keep_in_touch_suggestions(INTEGER, INTEGER, TEXT, UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION public.crm_keep_in_touch_suggestions(
  p_limit              INTEGER DEFAULT 50,
  p_offset             INTEGER DEFAULT 0,
  p_status             TEXT DEFAULT 'open',
  p_contact_id         UUID DEFAULT NULL,
  p_exclude_restricted BOOLEAN DEFAULT true
) RETURNS TABLE (
  contact_id            UUID,
  display_name          TEXT,
  suggestion_key        TEXT,
  suggestion_kind       TEXT,
  source_task_id        UUID,
  priority              TEXT,
  summary               TEXT,
  suggested_task_title  TEXT,
  suggested_task_due_at TIMESTAMPTZ,
  relationship_health   JSONB,
  review_state          JSONB,
  total_count           BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH params AS (
    SELECT
      greatest(1, least(COALESCE(p_limit, 50), 100)) AS v_limit,
      greatest(COALESCE(p_offset, 0), 0) AS v_offset,
      CASE
        WHEN COALESCE(NULLIF(trim(p_status), ''), 'open') IN ('open', 'snoozed', 'dismissed', 'converted', 'all')
          THEN COALESCE(NULLIF(trim(p_status), ''), 'open')
        ELSE 'open'
      END AS v_status,
      p_contact_id AS v_contact_id,
      COALESCE(p_exclude_restricted, true) AS v_exclude_restricted
  ),
  active_contacts AS (
    SELECT c.id, c.display_name, c.privacy_tier
    FROM public.crm_contacts c
    CROSS JOIN params p
    WHERE c.lifecycle_status <> 'archived'
      AND (p.v_contact_id IS NULL OR c.id = p.v_contact_id)
      AND (NOT p.v_exclude_restricted OR c.privacy_tier <> 'restricted')
  ),
  scored AS (
    SELECT
      ac.id AS contact_id,
      ac.display_name,
      public.crm_contact_relationship_health(ac.id, (SELECT v_exclude_restricted FROM params)) AS health
    FROM active_contacts ac
  ),
  suggestions AS (
    SELECT
      s.contact_id,
      s.display_name,
      -- The key carries a per-source-item discriminator so a dismissed or
      -- converted suggestion does not permanently suppress a genuinely NEW
      -- later suggestion of the same kind. For task-driven kinds the ref is the
      -- driving task's id (a new overdue task months later gets a fresh key);
      -- for an upcoming date it is that date's resolved occurrence (next year's
      -- instance is a new key); for reconnect it is the last-interaction epoch
      -- (going quiet again after a reconnect re-enters the queue). When no
      -- discriminator exists the key falls back to the bare kind.
      'keep_in_touch:' || s.contact_id::text || ':'
        || COALESCE(s.health->>'next_action_kind', 'none')
        || ':' || (
          CASE COALESCE(s.health->>'next_action_kind', 'none')
            WHEN 'overdue_task' THEN COALESCE(s.health->>'next_task_id', 'task')
            WHEN 'due_task'     THEN COALESCE(s.health->>'next_task_id', 'task')
            WHEN 'upcoming_date' THEN COALESCE(s.health->>'next_upcoming_date_on', 'date')
            -- Full last-interaction timestamp (not just the date) so a reconnect
            -- that happens after a dismissed quiet period always yields a fresh
            -- key, even within the same calendar day.
            WHEN 'reconnect'    THEN COALESCE(s.health->>'last_meaningful_interaction_at', 'never')
            ELSE 'none'
          END
        ) AS suggestion_key,
      COALESCE(s.health->>'next_action_kind', 'none') AS suggestion_kind,
      NULLIF(s.health->>'next_task_id', '')::uuid AS source_task_id,
      CASE
        WHEN COALESCE(s.health->>'next_action_kind', 'none') = 'overdue_task' THEN 'high'
        WHEN COALESCE((s.health->>'stale')::boolean, false) THEN 'high'
        WHEN COALESCE(s.health->>'next_action_kind', 'none') IN ('due_task', 'upcoming_date') THEN 'medium'
        ELSE 'low'
      END AS priority,
      CASE
        WHEN COALESCE(s.health->>'next_action_kind', 'none') = 'overdue_task'
          THEN 'Review overdue follow-up with ' || s.display_name || '.'
        WHEN COALESCE(s.health->>'next_action_kind', 'none') = 'due_task'
          THEN 'Prepare upcoming follow-up with ' || s.display_name || '.'
        WHEN COALESCE(s.health->>'next_action_kind', 'none') = 'upcoming_date'
          THEN 'Acknowledge upcoming date for ' || s.display_name || '.'
        WHEN COALESCE(s.health->>'next_action_kind', 'none') = 'reconnect'
          THEN 'Reconnect with ' || s.display_name || '; this relationship has gone quiet.'
        ELSE 'Review relationship context for ' || s.display_name || '.'
      END AS summary,
      CASE
        WHEN COALESCE(s.health->>'next_action_kind', 'none') = 'upcoming_date'
          THEN 'Acknowledge ' || COALESCE(s.health->>'next_upcoming_date_label', 'important date') || ' for ' || s.display_name
        WHEN COALESCE(s.health->>'next_action_kind', 'none') = 'reconnect'
          THEN 'Reconnect with ' || s.display_name
        ELSE 'Follow up with ' || s.display_name
      END AS suggested_task_title,
      COALESCE(
        NULLIF(s.health->>'next_action_at', '')::timestamptz,
        now() + interval '7 days'
      ) AS suggested_task_due_at,
      s.health AS relationship_health
    FROM scored s
    WHERE COALESCE(s.health->>'next_action_kind', 'none') <> 'none'
  ),
  latest_review AS (
    SELECT DISTINCT ON (r.contact_id, r.suggestion_key)
      r.contact_id, r.suggestion_key, r.action, r.snoozed_until, r.task_id, r.metadata, r.created_at, r.created_by
    FROM public.crm_contact_suggestion_reviews r
    ORDER BY r.contact_id, r.suggestion_key, r.created_at DESC
  ),
  reviewed AS (
    SELECT
      s.*,
      CASE
        WHEN lr.suggestion_key IS NULL THEN NULL::jsonb
        ELSE jsonb_build_object(
          'action', lr.action,
          'snoozed_until', lr.snoozed_until,
          'task_id', lr.task_id,
          'metadata', lr.metadata,
          'created_at', lr.created_at,
          'created_by', lr.created_by
        )
      END AS review_state,
      lr.action AS latest_action,
      lr.snoozed_until AS latest_snoozed_until
    FROM suggestions s
    LEFT JOIN latest_review lr
      ON lr.contact_id = s.contact_id AND lr.suggestion_key = s.suggestion_key
  ),
  filtered AS (
    SELECT r.*, count(*) OVER ()::bigint AS total_count
    FROM reviewed r
    CROSS JOIN params p
    WHERE (
      p.v_status = 'all'
      OR (
        p.v_status = 'open'
        AND (
          r.latest_action IS NULL
          OR (r.latest_action = 'snoozed' AND COALESCE(r.latest_snoozed_until, now() - interval '1 second') <= now())
        )
      )
      OR (p.v_status = 'snoozed' AND r.latest_action = 'snoozed' AND r.latest_snoozed_until > now())
      OR (p.v_status = 'dismissed' AND r.latest_action = 'dismissed')
      OR (p.v_status = 'converted' AND r.latest_action = 'converted_task')
    )
  )
  SELECT
    f.contact_id,
    f.display_name,
    f.suggestion_key,
    f.suggestion_kind,
    f.source_task_id,
    f.priority,
    f.summary,
    f.suggested_task_title,
    f.suggested_task_due_at,
    f.relationship_health,
    f.review_state,
    f.total_count
  FROM filtered f
  ORDER BY
    CASE f.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
    COALESCE((f.relationship_health->>'score')::integer, 0) DESC,
    f.suggested_task_due_at ASC NULLS LAST,
    f.display_name ASC
  LIMIT (SELECT v_limit FROM params)
  OFFSET (SELECT v_offset FROM params);
$$;

REVOKE ALL ON FUNCTION public.crm_keep_in_touch_suggestions(INTEGER, INTEGER, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_keep_in_touch_suggestions(INTEGER, INTEGER, TEXT, UUID, BOOLEAN) TO service_role;

-- ─── crm_update_keep_in_touch_suggestion — dismiss / snooze / convert ───────
-- Records a review for one suggestion. 'converted_task' also creates a real
-- follow-up task from the suggestion. Reviews live only in CRM-layer tables;
-- no thoughts, contacts, or other rows are mutated by a review action beyond
-- the optional new task and the change-log entry.

CREATE OR REPLACE FUNCTION public.crm_update_keep_in_touch_suggestion(
  p_contact_id    UUID,
  p_suggestion_key TEXT,
  p_action        TEXT,
  p_snoozed_until TIMESTAMPTZ DEFAULT NULL,
  p_actor         TEXT DEFAULT 'service'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor          TEXT := COALESCE(NULLIF(trim(p_actor), ''), 'service');
  v_action         TEXT := COALESCE(NULLIF(trim(p_action), ''), '');
  v_suggestion_key TEXT := NULLIF(trim(COALESCE(p_suggestion_key, '')), '');
  v_snoozed_until  TIMESTAMPTZ := p_snoozed_until;
  v_suggestion     RECORD;
  v_review_id      UUID;
  v_task           JSONB := NULL;
  v_task_id        UUID := NULL;
  v_linked_task    BOOLEAN := false;
BEGIN
  PERFORM public.crm_engagement_contact_guard(p_contact_id);
  IF v_suggestion_key IS NULL THEN
    RAISE EXCEPTION 'suggestion_key is required';
  END IF;
  IF v_action NOT IN ('dismissed', 'snoozed', 'converted_task') THEN
    RAISE EXCEPTION 'invalid suggestion action: %', v_action;
  END IF;
  IF v_action = 'snoozed' AND v_snoozed_until IS NULL THEN
    v_snoozed_until := now() + interval '7 days';
  END IF;

  -- Resolve the live suggestion so the review carries its kind / priority and
  -- a convert action gets the right task title and due date.
  SELECT * INTO v_suggestion
  FROM public.crm_keep_in_touch_suggestions(100, 0, 'all', p_contact_id, true) s
  WHERE s.suggestion_key = v_suggestion_key
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CRM keep-in-touch suggestion not found: %', v_suggestion_key;
  END IF;

  IF v_action = 'converted_task' THEN
    -- Task-driven suggestions (overdue_task / due_task) were ALREADY derived
    -- from an existing open CRM task. Converting must not mint a second,
    -- immediately-overdue duplicate of that task — instead link the review to
    -- the existing source task and return it unchanged. Only non-task kinds
    -- (upcoming_date / reconnect) have no backing task, so those create a real
    -- follow-up. If a task kind somehow lost its source id, fall back to
    -- creating one so the convert action is never a silent no-op.
    IF v_suggestion.suggestion_kind IN ('overdue_task', 'due_task')
       AND v_suggestion.source_task_id IS NOT NULL THEN
      v_task_id := v_suggestion.source_task_id;
      v_task := (
        SELECT to_jsonb(t.*)
        FROM public.crm_contact_tasks t
        WHERE t.id = v_suggestion.source_task_id
          AND t.deleted_at IS NULL
      );
      -- If the source task vanished between read and write, fall through to
      -- creating a fresh follow-up rather than recording a dangling link.
      IF v_task IS NULL THEN
        v_task_id := NULL;
      ELSE
        v_linked_task := true;
      END IF;
    END IF;

    IF v_task IS NULL THEN
      v_task := public.crm_add_contact_task(
        p_contact_id,
        v_suggestion.suggested_task_title,
        v_suggestion.summary,
        'follow_up',
        'open',
        v_suggestion.suggested_task_due_at,
        NULL,
        CASE WHEN v_suggestion.priority = 'high' THEN 'high' ELSE 'normal' END,
        'standard',
        v_actor
      );
      v_task_id := NULLIF(v_task->>'id', '')::uuid;
    END IF;
  END IF;

  INSERT INTO public.crm_contact_suggestion_reviews (
    contact_id, suggestion_key, action, snoozed_until, task_id, metadata, created_by
  )
  VALUES (
    p_contact_id, v_suggestion_key, v_action,
    CASE WHEN v_action = 'snoozed' THEN v_snoozed_until ELSE NULL END,
    v_task_id,
    jsonb_build_object(
      'suggestion_kind', v_suggestion.suggestion_kind,
      'priority', v_suggestion.priority,
      'summary', v_suggestion.summary,
      'source', 'crm_keep_in_touch_suggestions',
      'linked_existing_task', v_linked_task
    ),
    v_actor
  )
  RETURNING id INTO v_review_id;

  INSERT INTO public.crm_contact_change_log (contact_id, action, actor_label, changed_fields)
  VALUES (
    p_contact_id,
    CASE
      WHEN v_action = 'dismissed' THEN 'suggestion.dismiss'
      WHEN v_action = 'snoozed' THEN 'suggestion.snooze'
      ELSE 'suggestion.convert_task'
    END,
    v_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'suggestion_key', v_suggestion_key,
      'suggestion_action', v_action,
      'snoozed_until', CASE WHEN v_action = 'snoozed' THEN v_snoozed_until ELSE NULL END,
      'task_id', v_task_id,
      'linked_existing_task', CASE WHEN v_action = 'converted_task' THEN v_linked_task ELSE NULL END
    ))
  );

  RETURN jsonb_build_object(
    'review', (SELECT to_jsonb(r.*) FROM public.crm_contact_suggestion_reviews r WHERE r.id = v_review_id),
    'task', v_task,
    'suggestion_key', v_suggestion_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.crm_update_keep_in_touch_suggestion(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_update_keep_in_touch_suggestion(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO service_role;

-- ============================================================================
-- Row-level security + table grants (service_role only)
-- ============================================================================
-- Engagement data is reached through the service role on a trusted server. RLS
-- is enabled (default-deny for anon/authenticated), and direct privileges are
-- revoked from PUBLIC/anon/authenticated so a project that blanket-grants new
-- tables to its API roles cannot leave relationship data exposed.

ALTER TABLE public.crm_contact_notes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contact_tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contact_important_dates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_interactions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_interaction_contacts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contact_suggestion_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.crm_contact_notes              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_contact_tasks              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_contact_important_dates    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_interactions               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_interaction_contacts       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crm_contact_suggestion_reviews FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.crm_contact_notes              TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_contact_tasks              TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_contact_important_dates    TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_interactions               TO service_role;
GRANT SELECT, INSERT, DELETE ON public.crm_interaction_contacts       TO service_role;
GRANT SELECT, INSERT         ON public.crm_contact_suggestion_reviews TO service_role;

-- Make the new tables and RPCs visible to PostgREST immediately.
NOTIFY pgrst, 'reload schema';
