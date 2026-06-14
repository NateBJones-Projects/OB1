-- ============================================================================
-- Persistent wiki pages — durable, revision-tracked, human-override-safe pages
-- ============================================================================
--
-- Most "wiki" generators treat a page as a throwaway artifact: regenerate it
-- and any human edit is shredded. This schema makes wiki pages persistent
-- database objects with per-section ownership and an append-only revision
-- history, so a machine can keep a page fresh WITHOUT ever stomping on prose a
-- human has taken ownership of.
--
-- The model has three tables:
--
--   wiki_pages            — the persistent page (a slug + title + free-form
--                           metadata). One row per page.
--   wiki_sections         — chapters within a page, with per-section ownership.
--                           A section whose origin is 'generated' is
--                           machine-owned and may be rewritten freely. A
--                           section whose origin is 'manual' (or one that is
--                           explicitly locked) only ever receives a PENDING
--                           draft that a human can review, then accept or leave.
--   wiki_section_revisions — append-only history written on every body change,
--                           so nothing a human (or machine) wrote is ever lost.
--
-- ── The regen guard (the headline) ──────────────────────────────────────────
-- The rule that makes regeneration safe lives in ONE place: the
-- wiki_write_section RPC, not in any generator script. Every writer — today's
-- and tomorrow's — goes through that single guard:
--
--   * A 'generated' write to a machine-owned section overwrites it in place
--     (and snapshots a revision).
--   * A 'generated' write to a HUMAN-owned section (origin='manual' or locked)
--     does NOT overwrite. It parks the new text in the section's
--     pending_generated_md buffer for a human to diff and decide on.
--   * wiki_accept_pending promotes a parked draft to the live body, snapshots a
--     revision, and keeps the section human-owned (the machine still proposes
--     next time; it never auto-applies).
--
-- Same trust model as a human-in-the-loop: machine writes propose, a human
-- accepts. This is durable, revision-tracked, override-safe page storage —
-- distinct from the wiki-compiler / wiki-synthesis recipes, which compile
-- throwaway markdown artifacts with no persistence or human-override guard.
--
-- ── ID contract ─────────────────────────────────────────────────────────────
-- OB1's canonical public.thoughts.id is a UUID. Every id here is UUID-aligned:
--   * wiki_pages.id, wiki_sections.id              — UUID (gen_random_uuid()).
--   * wiki_sections.page_id  -> wiki_pages.id      — UUID FK.
--   * wiki_section_revisions.section_id            — UUID FK to wiki_sections.id.
--   * wiki_sections.evidence_thought_ids           — UUID[] (references thoughts).
-- wiki_section_revisions.id is a BIGINT IDENTITY surrogate — it is an internal
-- revision sequence, never a thought id, so it does not need to be a UUID.
-- This schema never references brain_thoughts, never uses a bigint thought id,
-- and never installs a view trigger.
--
-- ── SQL hygiene ─────────────────────────────────────────────────────────────
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, CREATE OR
-- REPLACE FUNCTION, and a guarded ON CONFLICT seed insert. Additive only — it
-- never alters or removes a column on public.thoughts. It contains no
-- destructive table-removal statements and no unqualified row deletes, so it
-- satisfies the repo SQL-safety guardrail. Safe to re-run.
--
-- Requires pgcrypto (for gen_random_uuid). On Supabase / Postgres 13+ this is
-- already available; the CREATE EXTENSION below is a no-op if it is.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Pages ──────────────────────────────────────────────────────────────────
-- One row per page. `slug` is the stable handle (unique); `metadata` is
-- free-form jsonb for anything a generator wants to stash without a schema
-- change. No FK to entities or thoughts here — a page is identified by its slug.

CREATE TABLE IF NOT EXISTS public.wiki_pages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT        NOT NULL,
  title       TEXT        NOT NULL,
  page_kind   TEXT        NOT NULL DEFAULT 'topic'
                CHECK (page_kind IN ('topic', 'entity', 'autobiography', 'custom')),
  status      TEXT        NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'archived')),
  metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_by  TEXT        NOT NULL DEFAULT 'system',
  updated_by  TEXT        NOT NULL DEFAULT 'system'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_pages_slug ON public.wiki_pages (slug);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_kind ON public.wiki_pages (page_kind, status);

-- ─── Sections ───────────────────────────────────────────────────────────────
-- Chapters within a page. `origin` is the ownership marker that the regen guard
-- reads: 'generated' = machine-owned (free to overwrite), 'manual' = human-owned
-- (generated writes only ever park a pending draft). `locked` forces the
-- human-owned behavior regardless of origin. `pending_generated_md` is the
-- parking buffer for a machine draft awaiting human review.

CREATE TABLE IF NOT EXISTS public.wiki_sections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id              UUID        NOT NULL REFERENCES public.wiki_pages(id) ON DELETE CASCADE,
  section_key          TEXT        NOT NULL,
  heading              TEXT,
  display_order        INTEGER     NOT NULL DEFAULT 100,
  origin               TEXT        NOT NULL DEFAULT 'generated'
                         CHECK (origin IN ('manual', 'generated')),
  body_md              TEXT        NOT NULL DEFAULT '',
  pending_generated_md TEXT,
  pending_generated_at TIMESTAMPTZ,
  generation_source    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- UUID[] references public.thoughts(id). A plain UUID array (not a per-element
  -- FK) so a section can cite many supporting thoughts cheaply; cleaned up by
  -- the application, not the database.
  evidence_thought_ids UUID[]      NOT NULL DEFAULT ARRAY[]::UUID[],
  locked               BOOLEAN     NOT NULL DEFAULT false,
  deleted_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_by           TEXT        NOT NULL DEFAULT 'system',
  updated_by           TEXT        NOT NULL DEFAULT 'system',
  UNIQUE (page_id, section_key)
);

CREATE INDEX IF NOT EXISTS idx_wiki_sections_page ON public.wiki_sections (page_id, display_order);

-- ─── Section revisions ──────────────────────────────────────────────────────
-- Append-only history: one row per body change. The BIGINT IDENTITY id is an
-- internal revision sequence — never a thought id.

CREATE TABLE IF NOT EXISTS public.wiki_section_revisions (
  id          BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  section_id  UUID        NOT NULL REFERENCES public.wiki_sections(id) ON DELETE CASCADE,
  body_md     TEXT        NOT NULL,
  origin      TEXT        NOT NULL,
  actor       TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_wiki_section_revisions_section
  ON public.wiki_section_revisions (section_id, created_at DESC);

-- ─── RLS + grants ───────────────────────────────────────────────────────────
-- Wiki pages are written and regenerated by server-side jobs running as the
-- service role. RLS denies everything by default; the explicit REVOKE makes the
-- service-role-only intent unambiguous even on a project that blanket-grants new
-- tables to its API roles (defense in depth).

ALTER TABLE public.wiki_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wiki_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wiki_section_revisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wiki_pages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.wiki_sections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.wiki_section_revisions FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wiki_pages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wiki_sections TO service_role;
-- Revision history is append-only: SELECT + INSERT only, never UPDATE/DELETE, so
-- the advertised immutable history cannot be rewritten outside the RPCs. (Rows
-- are still removed by the ON DELETE CASCADE when their parent section is
-- deleted — that is a section deletion, not history mutation.)
GRANT SELECT, INSERT ON public.wiki_section_revisions TO service_role;

COMMENT ON TABLE public.wiki_pages IS
  'Persistent wiki pages. One row per page, keyed by slug. No thought/entity FK — a page is identified by its slug.';
COMMENT ON TABLE public.wiki_sections IS
  'Chapters within a wiki page with per-section ownership. origin=generated is machine-owned; origin=manual (or locked) is human-owned and only receives pending drafts from generated writes.';
COMMENT ON COLUMN public.wiki_sections.evidence_thought_ids IS
  'UUID[] of public.thoughts(id) that support this section. Plain array, not a per-element FK.';
COMMENT ON COLUMN public.wiki_sections.pending_generated_md IS
  'A machine draft parked for human review because the section is human-owned. Promoted by wiki_accept_pending.';
COMMENT ON TABLE public.wiki_section_revisions IS
  'Append-only revision history for section bodies. One row per body change. id is an internal sequence, never a thought id.';

-- ─── Page upsert ────────────────────────────────────────────────────────────
-- Create or update a page by slug. Generators and any REST caller share this so
-- a page is always addressed the same way. Returns the page id and whether it
-- was newly created.

CREATE OR REPLACE FUNCTION public.wiki_upsert_page(
  p_slug         TEXT,
  p_title        TEXT,
  p_page_kind    TEXT  DEFAULT 'topic',
  p_metadata     JSONB DEFAULT '{}'::jsonb,
  p_actor        TEXT  DEFAULT 'system'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_slug    TEXT := nullif(trim(coalesce(p_slug, '')), '');
  v_title   TEXT := nullif(trim(coalesce(p_title, '')), '');
  v_actor   TEXT := coalesce(nullif(trim(p_actor), ''), 'system');
  v_id      UUID;
  v_created BOOLEAN := false;
BEGIN
  IF v_slug IS NULL THEN RAISE EXCEPTION 'slug is required'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'title is required'; END IF;

  INSERT INTO public.wiki_pages (slug, title, page_kind, metadata, created_by, updated_by)
  VALUES (
    v_slug, v_title,
    coalesce(nullif(trim(p_page_kind), ''), 'topic'),
    coalesce(p_metadata, '{}'::jsonb),
    v_actor, v_actor
  )
  ON CONFLICT (slug) DO UPDATE
    SET title      = EXCLUDED.title,
        metadata   = public.wiki_pages.metadata || EXCLUDED.metadata,
        updated_at = timezone('utc', now()),
        updated_by = v_actor
  RETURNING id, (xmax = 0) INTO v_id, v_created;

  RETURN jsonb_build_object('page_id', v_id, 'created', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.wiki_upsert_page(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wiki_upsert_page(TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;

COMMENT ON FUNCTION public.wiki_upsert_page IS
  'Create or update a wiki page by slug. Returns {page_id, created}. Shared by generators and REST callers.';

-- ─── The single write guard for section content (the regen guard) ───────────
-- Every section write goes through here. New sections are created and snapshot a
-- first revision. For an existing section, the ownership rule applies: a
-- 'generated' write to a human-owned section (origin='manual' or locked) parks
-- a pending draft instead of overwriting; any other write updates in place and
-- snapshots a revision when the body actually changed.

CREATE OR REPLACE FUNCTION public.wiki_write_section(
  p_page_id              UUID,
  p_section_key          TEXT,
  p_body_md              TEXT,
  p_origin               TEXT    DEFAULT 'generated',
  p_heading              TEXT    DEFAULT NULL,
  p_generation_source    JSONB   DEFAULT '{}'::jsonb,
  p_evidence_thought_ids UUID[]  DEFAULT NULL,
  p_display_order        INTEGER DEFAULT NULL,
  p_actor                TEXT    DEFAULT 'system'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_key   TEXT := nullif(trim(coalesce(p_section_key, '')), '');
  v_actor TEXT := coalesce(nullif(trim(p_actor), ''), 'system');
  v_row   public.wiki_sections%ROWTYPE;
  v_now   TIMESTAMPTZ := timezone('utc', now());
BEGIN
  IF v_key IS NULL THEN RAISE EXCEPTION 'section_key is required'; END IF;
  IF p_origin NOT IN ('manual', 'generated') THEN
    RAISE EXCEPTION 'invalid section origin: %', p_origin;
  END IF;

  -- New section: insert race-safely. Two concurrent first writes to the same
  -- (page_id, section_key) both reach this INSERT; the unique constraint
  -- serializes them, so ON CONFLICT DO NOTHING lets the loser fall through to
  -- the existing-section path instead of raising a unique violation. The winner
  -- gets a row back here and snapshots the first revision.
  INSERT INTO public.wiki_sections (
    page_id, section_key, heading, display_order, origin, body_md,
    generation_source, evidence_thought_ids, created_by, updated_by
  )
  VALUES (
    p_page_id, v_key, nullif(trim(coalesce(p_heading, '')), ''),
    coalesce(p_display_order, 100), p_origin, coalesce(p_body_md, ''),
    coalesce(p_generation_source, '{}'::jsonb),
    coalesce(p_evidence_thought_ids, ARRAY[]::UUID[]),
    v_actor, v_actor
  )
  ON CONFLICT (page_id, section_key) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NOT NULL THEN
    INSERT INTO public.wiki_section_revisions (section_id, body_md, origin, actor)
    VALUES (v_row.id, v_row.body_md, p_origin, v_actor);

    RETURN jsonb_build_object('section_id', v_row.id, 'action', 'created');
  END IF;

  -- The section already existed (ON CONFLICT fired). Lock the existing row for
  -- the duration of the transaction so concurrent writers cannot race the
  -- ownership check below.
  SELECT * INTO v_row
  FROM public.wiki_sections
  WHERE page_id = p_page_id AND section_key = v_key
  FOR UPDATE;

  -- THE REGEN RULE: a machine ('generated') may never overwrite a section a
  -- human owns ('manual' or locked). The new draft parks in the pending buffer
  -- for diff/accept; the live body is left untouched.
  IF p_origin = 'generated' AND (v_row.origin = 'manual' OR v_row.locked) THEN
    UPDATE public.wiki_sections
    SET pending_generated_md = coalesce(p_body_md, ''),
        pending_generated_at = v_now,
        generation_source    = coalesce(p_generation_source, generation_source),
        updated_at           = v_now,
        updated_by           = v_actor
    WHERE id = v_row.id;
    RETURN jsonb_build_object('section_id', v_row.id, 'action', 'pending');
  END IF;

  -- Otherwise update in place. A 'manual' write takes ownership of the section;
  -- a 'generated' write to a still-machine-owned section refreshes it. Either
  -- way the pending buffer is cleared and a revision is snapshotted on a real
  -- body change.
  UPDATE public.wiki_sections
  SET body_md              = coalesce(p_body_md, ''),
      heading              = coalesce(nullif(trim(coalesce(p_heading, '')), ''), heading),
      origin               = CASE WHEN p_origin = 'manual' THEN 'manual' ELSE origin END,
      display_order        = coalesce(p_display_order, display_order),
      generation_source    = CASE WHEN p_origin = 'generated' THEN coalesce(p_generation_source, generation_source) ELSE generation_source END,
      evidence_thought_ids = coalesce(p_evidence_thought_ids, evidence_thought_ids),
      pending_generated_md = NULL,
      pending_generated_at = NULL,
      deleted_at           = NULL,
      updated_at           = v_now,
      updated_by           = v_actor
  WHERE id = v_row.id;

  IF coalesce(p_body_md, '') IS DISTINCT FROM v_row.body_md THEN
    INSERT INTO public.wiki_section_revisions (section_id, body_md, origin, actor)
    VALUES (v_row.id, coalesce(p_body_md, ''), p_origin, v_actor);
  END IF;

  RETURN jsonb_build_object('section_id', v_row.id, 'action', 'updated');
END;
$$;

REVOKE ALL ON FUNCTION public.wiki_write_section(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID[], INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wiki_write_section(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID[], INTEGER, TEXT) TO service_role;

COMMENT ON FUNCTION public.wiki_write_section IS
  'The single write guard for section content. A generated write to a human-owned (manual/locked) section parks a pending draft instead of overwriting; all other writes update in place and snapshot a revision. Returns {section_id, action} where action is created|pending|updated.';

-- ─── Accept a parked draft (a deliberate human decision) ────────────────────
-- Promote pending_generated_md to the live body, snapshot a revision, and keep
-- the section human-owned. If there is no pending draft this is a no-op.

CREATE OR REPLACE FUNCTION public.wiki_accept_pending(
  p_section_id UUID,
  p_actor      TEXT DEFAULT 'system'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor TEXT := coalesce(nullif(trim(p_actor), ''), 'system');
  v_row   public.wiki_sections%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.wiki_sections WHERE id = p_section_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'section not found: %', p_section_id; END IF;
  IF v_row.pending_generated_md IS NULL THEN
    RETURN jsonb_build_object('section_id', v_row.id, 'action', 'no_pending');
  END IF;

  -- Accepting keeps the section human-owned ('manual'): the machine still
  -- proposes next time (its writes keep parking as pending). Releasing the
  -- section back to auto-generated is a separate, explicit choice — set origin
  -- back to 'generated' directly.
  UPDATE public.wiki_sections
  SET body_md              = v_row.pending_generated_md,
      origin               = 'manual',
      pending_generated_md = NULL,
      pending_generated_at = NULL,
      updated_at           = timezone('utc', now()),
      updated_by           = v_actor
  WHERE id = v_row.id;

  INSERT INTO public.wiki_section_revisions (section_id, body_md, origin, actor)
  VALUES (v_row.id, v_row.pending_generated_md, 'generated', v_actor);

  RETURN jsonb_build_object('section_id', v_row.id, 'action', 'accepted');
END;
$$;

REVOKE ALL ON FUNCTION public.wiki_accept_pending(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wiki_accept_pending(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.wiki_accept_pending IS
  'Promote a parked pending draft to the live section body, snapshot a revision, and keep the section human-owned. No-op when there is no pending draft.';

-- ─── One fictional seed page (idempotent) ───────────────────────────────────
-- A single generic example so a fresh install has something to look at. Guarded
-- by ON CONFLICT so re-running schema.sql never duplicates or errors. Contains
-- no real content — a "Getting Started" page with one trivial generated section.

INSERT INTO public.wiki_pages (slug, title, page_kind, metadata, created_by, updated_by)
VALUES (
  'getting-started',
  'Getting Started',
  'topic',
  jsonb_build_object('seed', true, 'note', 'Example page created by schema.sql. Safe to edit or delete.'),
  'system', 'system'
)
ON CONFLICT (slug) DO NOTHING;

-- Seed one section on the example page, only if the page exists and the section
-- does not already exist (ON CONFLICT on the (page_id, section_key) unique key).
INSERT INTO public.wiki_sections (page_id, section_key, heading, display_order, origin, body_md, created_by, updated_by)
SELECT p.id, 'intro', 'Welcome', 10, 'generated',
       'This is an example wiki section. Generated sections like this one can be '
       || 'regenerated freely. Once a human edits a section (making it manual) or '
       || 'locks it, later machine writes park as pending drafts instead of '
       || 'overwriting it.',
       'system', 'system'
FROM public.wiki_pages p
WHERE p.slug = 'getting-started'
ON CONFLICT (page_id, section_key) DO NOTHING;

-- Make the new tables and RPCs visible to PostgREST immediately.
NOTIFY pgrst, 'reload schema';
