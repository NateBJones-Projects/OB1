-- === HERMES AGENT ONBOARDING — IDENTITY TABLES ===
-- Migration order matters: 001 → 002 → 003 → 004
-- See migrations/ in recipes/hermes-agent-onboarding/migrations/ for full files

-- 001: User infrastructure
-- Creates: user_profiles, user_preferences, user_mbti, user_style, user_relations, user_beliefs

-- 002: Session checkpoints
-- Creates: session_checkpoints

-- 003: Service role GRANTs + identity tables
-- Creates: identity_faults, agent_capabilities, identity_milestones
-- GRANTs for all 10 tables

-- 004: Checkpoint working directory field
-- ALTER TABLE session_checkpoints ADD COLUMN working_dir

-- All tables use RLS with service_role-only access:
-- ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "service_role_only" ON public.<table> FOR ALL
--   USING ((auth.jwt() ->> 'role') = 'service_role');
