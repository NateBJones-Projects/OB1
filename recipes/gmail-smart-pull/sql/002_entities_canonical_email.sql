-- Email correspondents as first-class entities.
--
-- Adds canonical_email to public.entities so email correspondents (Gmail
-- From/To/Cc headers today; Telegram, ChatGPT participants later) can be
-- upserted by a normalized email address (lowercase, trimmed). Existing
-- uniqueness on (entity_type, normalized_name) is preserved because two
-- people may legitimately share a display name; email is the stable
-- identifier for disambiguation.
--
-- Allowed mention_role values on thought_entities for email-sourced edges
-- (soft convention, no CHECK constraint, easy to extend):
--   author    — From: header
--   recipient — To:   header
--   cc        — Cc:   header
--   mentioned — already used for LLM content extraction (unchanged)
--
-- Prerequisite: this migration requires a `public.entities` table to exist
-- (with at least `id`, `entity_type`, `canonical_name`, `normalized_name`).
-- If your Open Brain deployment doesn't have entities yet, install an
-- entities schema first (see other recipes under schemas/ that define one).
-- The migration uses IF NOT EXISTS guards so re-running is safe.

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS canonical_email TEXT;

-- Global uniqueness on canonical_email where present. Two entities can
-- still co-exist without emails (other entity_types like project/topic).
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_canonical_email
  ON public.entities (canonical_email)
  WHERE canonical_email IS NOT NULL;

-- Fast per-type lookup, e.g. "find all person entities with email X".
CREATE INDEX IF NOT EXISTS idx_entities_email_type
  ON public.entities (entity_type, canonical_email)
  WHERE canonical_email IS NOT NULL;

COMMENT ON COLUMN public.entities.canonical_email IS
  'Normalized lowercase email address. Stable identifier for person entities '
  'discovered from message headers (Gmail From/To/Cc; future: Telegram, etc). '
  'NULL for non-person entities (projects, topics, tools).';
