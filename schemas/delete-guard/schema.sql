-- ============================================================================
-- Mass-delete guard + delete audit for public.thoughts
-- ============================================================================
--
-- Open Brain's contribution guard rails forbid an unqualified delete (a
-- `DELETE` with no WHERE clause) in any SQL file. This schema enforces the same
-- intent at the database layer for every install: a statement-level AFTER DELETE
-- trigger on public.thoughts that blocks any single DELETE statement removing
-- more than 50 rows, unless a privileged admin explicitly opts in for that
-- transaction. Every opted-in override is audit-logged.
--
-- Single-row deletes (delete one thought by id) and small batches keep working
-- unchanged. The dangerous real-world case — an unqualified delete of the whole
-- table, a too-broad WHERE, or a runaway script issuing one large delete — is a
-- single statement, and that is exactly what this blocks.
--
-- Why statement-level with a transition table (not a per-row counter):
-- the row count comes from PostgreSQL's server-computed transition table
-- (`REFERENCING OLD TABLE`). The caller cannot tamper with it. A per-row counter
-- kept in a temp table or a custom GUC is caller-controllable — a SQL-capable
-- role can pre-seed it to a huge negative value and make the guard fail open.
-- The transition-table count closes that bypass.
--
-- ID contract: public.thoughts.id is UUID in the canonical Open Brain setup, so
-- the audit table stores thought ids as UUID.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, and
-- DROP TRIGGER IF EXISTS ... ; CREATE TRIGGER. Additive only — it never alters
-- or drops a column on public.thoughts. Safe to re-run.
-- ============================================================================

-- ─── Audit table ────────────────────────────────────────────────────────────
-- Records every admin-approved mass-delete override, with the caller's identity
-- for forensics. thought_id is UUID to match thoughts.id (a sample of the rows
-- the override deleted); deleted_count records how many rows the statement
-- removed.
--
-- Note on blocked attempts: a blocked delete RAISEs an exception, which aborts
-- the whole transaction — including any audit row written inside the same
-- transaction (PostgreSQL has no built-in autonomous transactions). So blocked
-- attempts are NOT row-audited here; they surface in the Postgres server log
-- (the RAISE EXCEPTION text, with the actor visible in the log line), which on
-- Supabase appears in Logs → Postgres. Override events DO commit (the
-- transaction succeeds) and are the durable, queryable forensic record.
CREATE TABLE IF NOT EXISTS public.thoughts_delete_audit (
  audit_id            bigserial   PRIMARY KEY,
  attempted_at        timestamptz NOT NULL DEFAULT now(),
  operation           text        NOT NULL,
  thought_id          uuid,
  deleted_count       bigint,
  content_fingerprint text,
  actor_role          text        NOT NULL,
  actor_user          text        NOT NULL,
  session_user_name   text        NOT NULL,
  application_name    text,
  client_addr         inet,
  client_port         integer,
  backend_pid         integer     NOT NULL,
  txid                bigint       NOT NULL,
  request_headers     jsonb,
  request_jwt_claims  jsonb,
  row_data            jsonb       NOT NULL DEFAULT '{}'::jsonb
);

-- deleted_count is additive: add it if an older install of this table exists.
ALTER TABLE public.thoughts_delete_audit
  ADD COLUMN IF NOT EXISTS deleted_count bigint;

COMMENT ON TABLE public.thoughts_delete_audit IS
  'Forensic log of admin-approved mass-delete overrides on public.thoughts. thought_id is UUID (a sample row from the override). Blocked attempts are not stored here (the abort rolls them back); they appear in the Postgres server log.';

-- ─── Safe JSON helper ───────────────────────────────────────────────────────
-- Parses a text setting as jsonb, returning NULL on empty or malformed input
-- instead of raising. The override audit INSERT records request.headers /
-- request.jwt.claims for forensics, but those GUCs are only well-formed JSON
-- under PostgREST; a direct SQL caller (psql, the CLI, a worker) may leave them
-- unset or non-JSON. Without this guard, a bad `::jsonb` cast inside the override
-- path would abort the audit INSERT and roll back an otherwise-legitimate bulk
-- delete the admin explicitly authorized. Degrade to NULL instead.
CREATE OR REPLACE FUNCTION public.thoughts_delete_safe_jsonb(p_text text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_text IS NULL OR p_text = '' THEN
    RETURN NULL;
  END IF;
  RETURN p_text::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.thoughts_delete_safe_jsonb(text) IS
  'Parses text as jsonb, returning NULL on empty/malformed input instead of raising. Used so forensic GUC capture never aborts an authorized override.';

-- ─── Override authorization ─────────────────────────────────────────────────
-- Decides whether the CURRENT request may use the mass-delete override. Returns
-- true only when the EFFECTIVE request role is genuinely trusted — a superuser
-- or service_role — so a plain anon/authenticated PostgREST request cannot lift
-- the guard just by setting a GUC. This is the single place to widen the policy.
--
-- Why the effective role, not session_user:
--   In Supabase/PostgREST every API request logs in as the shared `authenticator`
--   role, which must be GRANTed membership in anon, authenticated, AND
--   service_role so it can `SET ROLE` into whichever the JWT names. So
--   session_user is `authenticator` for every API request, and a membership test
--   like pg_has_role(session_user, 'service_role', ...) can pass for an
--   anon/authenticated request whenever that membership carries INHERIT — which
--   silently lifts the guard for untrusted clients. The check must look at the
--   role the request is actually RUNNING AS, not the login that could switch into
--   service_role.
--
-- How we read the effective role inside a SECURITY DEFINER guard:
--   The guard is SECURITY DEFINER, so current_user is rewritten to the definer
--   (the table owner) and is useless here. But the `role` GUC — what PostgREST
--   does `SET LOCAL ROLE` to from the verified JWT — is NOT reset by SECURITY
--   DEFINER and is readable via current_setting('role'). Critically, a role can
--   only land in that GUC by actually executing `SET ROLE`, which Postgres permits
--   only for a role the caller is truly a member of. So an anon/authenticated
--   request cannot make current_setting('role') report 'service_role' without
--   genuinely holding service_role — which makes this signal unforgeable, unlike
--   the request.jwt.claims GUC (a raw-SQL caller could set that to anything).
--
--   current_setting('role') returns 'none' when no SET ROLE is in effect (a direct
--   connection, e.g. a superuser psql session or the Supabase SQL editor); in that
--   case the effective role IS session_user, so we fall back to it.
--
-- Default privileged role: 'service_role' (Supabase's trusted server-side role).
CREATE OR REPLACE FUNCTION public.thoughts_delete_override_allowed()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_role_guc       text := current_setting('role', true);
  v_effective_role text;
  v_is_super       boolean;
BEGIN
  -- Effective role = the SET ROLE target if one is in effect, else session_user.
  -- 'none' / '' / NULL all mean "no SET ROLE", i.e. a direct connection.
  IF v_role_guc IS NULL OR v_role_guc = '' OR v_role_guc = 'none' THEN
    v_effective_role := session_user;
  ELSE
    v_effective_role := v_role_guc;
  END IF;

  -- The privileged server-side role. A request only reaches this value by really
  -- being service_role (direct login) or by SET ROLE service_role, which requires
  -- genuine membership — so anon/authenticated can never satisfy it.
  IF v_effective_role = 'service_role' THEN
    RETURN true;
  END IF;

  -- Superuser (direct admin session). Look up the effective role's superuser bit.
  SELECT rolsuper INTO v_is_super
    FROM pg_roles
   WHERE rolname = v_effective_role;

  RETURN COALESCE(v_is_super, false);
END;
$$;

COMMENT ON FUNCTION public.thoughts_delete_override_allowed() IS
  'Returns true only if the EFFECTIVE request role (current_setting(role) SET ROLE target, else session_user) is service_role or a superuser. An anon/authenticated PostgREST request is always denied — even if authenticator inherits service_role and even if it forges request.jwt.claims — because the role GUC can only report service_role after a real SET ROLE that requires membership. Edit this function to change the override policy.';

-- ─── Guard function ─────────────────────────────────────────────────────────
-- Statement-level AFTER DELETE. The transition table `deleted_rows` holds every
-- row the statement removed, counted server-side (tamper-proof). If the count
-- exceeds the limit:
--   * override flag set AND caller privileged → audit one MASS_DELETE_OVERRIDE
--     row and let the delete stand;
--   * otherwise → RAISE (which rolls the whole statement back), logged to the
--     Postgres server log.
-- Under the limit, it does nothing.
--
-- SECURITY DEFINER so the override audit INSERT always succeeds even when the
-- deleting role has no direct INSERT grant on the audit table; search_path is
-- pinned to public to keep the definer context safe.
CREATE OR REPLACE FUNCTION public.thoughts_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit        constant bigint := 50;
  v_count        bigint;
  v_override     boolean;
  v_priv         boolean;
  v_sample_id    uuid;
  v_sample_fp    text;
BEGIN
  -- Server-computed count of rows this statement deleted. Cannot be tampered
  -- with by the caller.
  SELECT count(*) INTO v_count FROM deleted_rows;

  -- Within the limit: nothing to do.
  IF v_count <= v_limit THEN
    RETURN NULL;
  END IF;

  -- Over the limit. The override requires BOTH an explicit opt-in flag AND a
  -- privileged caller.
  v_override := COALESCE(
    current_setting('app.allow_mass_delete', true)::boolean,
    false
  );
  v_priv := public.thoughts_delete_override_allowed();

  IF v_override AND v_priv THEN
    -- Grab one sample row for the audit record.
    SELECT id, content_fingerprint
      INTO v_sample_id, v_sample_fp
      FROM deleted_rows
      LIMIT 1;

    INSERT INTO public.thoughts_delete_audit (
      operation, thought_id, deleted_count, content_fingerprint,
      actor_role, actor_user, session_user_name,
      application_name, client_addr, client_port,
      backend_pid, txid,
      request_headers, request_jwt_claims, row_data
    ) VALUES (
      'MASS_DELETE_OVERRIDE', v_sample_id, v_count, v_sample_fp,
      current_role, current_user, session_user,
      current_setting('application_name', true),
      inet_client_addr(), inet_client_port(),
      pg_backend_pid(), txid_current(),
      public.thoughts_delete_safe_jsonb(current_setting('request.headers', true)),
      public.thoughts_delete_safe_jsonb(current_setting('request.jwt.claims', true)),
      jsonb_build_object('deleted_count', v_count, 'limit', v_limit, 'sample_id', v_sample_id)
    );

    RETURN NULL; -- allow the delete to stand
  END IF;

  -- Over the limit and not allowed to override: reject. No audit row is written
  -- (the RAISE aborts the statement and would roll it back anyway); the block is
  -- recorded in the Postgres server log via the RAISE text below, with the
  -- deleting role attached.
  IF v_override AND NOT v_priv THEN
    RAISE EXCEPTION
      'Mass delete blocked: app.allow_mass_delete is set but the current role is not permitted to override (% rows > limit %). The override requires a superuser or a member of the privileged delete role.',
      v_count, v_limit;
  END IF;

  RAISE EXCEPTION
    'Mass delete blocked: a single statement cannot delete more than % thoughts (attempted %). Delete in smaller batches, or a privileged admin can opt in for this transaction with: SET LOCAL app.allow_mass_delete = ''on'';',
    v_limit, v_count;

  RETURN NULL; -- unreachable; RAISE EXCEPTION aborts the statement
END;
$$;

COMMENT ON FUNCTION public.thoughts_delete_guard() IS
  'Safety guard: blocks any single DELETE statement removing more than 50 thoughts unless app.allow_mass_delete is set AND the caller is privileged (see thoughts_delete_override_allowed). Override events are row-audited to thoughts_delete_audit; blocked attempts surface in the Postgres server log.';

-- ─── Trigger ────────────────────────────────────────────────────────────────
-- Recreated idempotently. AFTER DELETE, statement-level, with an OLD transition
-- table so the guard sees the exact server-computed row count. AFTER (not
-- BEFORE) is required: transition tables are only available to AFTER triggers.
-- The RAISE still rolls the whole statement back, so no rows are actually lost
-- on a block.
DROP TRIGGER IF EXISTS trg_thoughts_delete_guard ON public.thoughts;
CREATE TRIGGER trg_thoughts_delete_guard
  AFTER DELETE ON public.thoughts
  REFERENCING OLD TABLE AS deleted_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.thoughts_delete_guard();

-- ─── Permissions ────────────────────────────────────────────────────────────
-- The audit table is service-role only; no client should read or write it. It
-- holds forensic data (request headers, JWT claims, client address), so leaking
-- it to anon/authenticated would be a real exposure.
--
-- Why REVOKE FROM PUBLIC is not enough: a Supabase project commonly runs a
-- blanket `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,
-- authenticated` so new public tables are reachable from the API. Those are
-- ROLE-SPECIFIC grants on anon/authenticated, which `REVOKE ... FROM PUBLIC` does
-- NOT remove (PUBLIC and a named role are separate grant targets). So we must
-- REVOKE from anon and authenticated explicitly, and additionally enable RLS with
-- no permissive policy as a belt-and-suspenders default-deny. service_role has
-- BYPASSRLS in Supabase, so its grant below still works; anon/authenticated end
-- with no privileges AND no RLS policy → no access either way.
REVOKE ALL ON public.thoughts_delete_audit FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.thoughts_delete_audit FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.thoughts_delete_audit FROM authenticated';
  END IF;
END
$$;

-- Default-deny via RLS: no policy is created, so every non-BYPASSRLS, non-owner
-- role is denied all row access regardless of any stray table grant. service_role
-- keeps access through BYPASSRLS. The SECURITY DEFINER guard inserts as the table
-- owner, which is exempt from RLS unless FORCE is set — so do NOT FORCE here, or
-- the override audit INSERT would be blocked.
ALTER TABLE public.thoughts_delete_audit ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.thoughts_delete_audit TO service_role;

-- Reload PostgREST's schema cache so the new table is visible to the API layer.
NOTIFY pgrst, 'reload schema';
