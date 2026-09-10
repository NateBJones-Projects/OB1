-- Thought Lifecycle Receipts — actor hardening.
--
-- Run this ONLY AFTER the caller that writes receipts is emitting real actor
-- strings (e.g. user:chat, agent:review, system:scheduler). A caller that
-- still passes a placeholder actor of 'mcp' on every insert will have every
-- direct lifecycle write rejected once this constraint is in place.
--
-- NOT VALID by design: existing rows are left standing (the constraint binds
-- new rows only). Do not VALIDATE it — validation would fail on any historical
-- placeholder rows, and rewriting an append-only audit log is not an option.
--
-- Safe to run multiple times.

ALTER TABLE public.thought_lifecycle_events
  DROP CONSTRAINT IF EXISTS thought_lifecycle_events_actor_real;

ALTER TABLE public.thought_lifecycle_events
  ADD CONSTRAINT thought_lifecycle_events_actor_real
  CHECK (actor <> 'mcp' AND actor ~ '^[a-z0-9._-]+:[a-z0-9._-]+$')
  NOT VALID;

COMMENT ON CONSTRAINT thought_lifecycle_events_actor_real
  ON public.thought_lifecycle_events IS
  'New receipts must carry a real party:context actor; the schema-level DEFAULT ''mcp'' placeholder is not storable going forward. NOT VALID by design: pre-hardening rows stand as recorded.';
