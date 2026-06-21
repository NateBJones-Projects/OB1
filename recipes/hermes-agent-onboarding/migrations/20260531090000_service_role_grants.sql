-- Migration: Service Role GRANTs for OB1 tables (2026-05-31)
-- 
-- Context: Since May 30, 2026, Supabase requires explicit GRANT
-- for new tables in the public schema before they can be accessed
-- via PostgREST/Data API (even with service_role).
--
-- This migration adds missing service_role GRANTs to tables
-- that were created before this enforcement but are accessed
-- by Edge Functions using service_role JWT.
--
-- NOTA: This only adds GRANTs. It does NOT revoke existing grants
-- to anon/authenticated (that requires deeper audit).

-- ============================================================
-- Tables accessed by MCP Edge Functions (must work with service_role)
-- ============================================================

-- tech-knowledge-base (tech_kb MCP)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tech_knowledge_base TO service_role;

-- product-catalog (product-catalog MCP)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_catalog TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_bom_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_platforms TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_sales TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_production_deps TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_popularity TO service_role;

-- escape-catalog (escape-catalog MCP) — all subsidiary tables
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escape_companies TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escape_rooms TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escape_themes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escape_room_themes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escape_puzzle_types TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escape_room_puzzle_links TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escape_company_contacts TO service_role;

-- ============================================================
-- Tables accessed by identity layer (identity-self-audit, identity-cqrs)
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.thoughts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.identity_faults TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_capabilities TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.identity_milestones TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.identity_deliveries TO service_role;

-- ============================================================
-- Tables accessed by career-tracker MCP
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.capabilities TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capability_connections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capability_dependencies TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solved_problems TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.milestones TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deliveries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_partners TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_participations TO service_role;

-- ============================================================
-- Tables accessed by code-analyzer MCP
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_structure TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.algorithm_cache TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_pin_configs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_dependencies TO service_role;

-- ============================================================
-- Tables accessed by household / maintenance / calendar MCPs
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_vendors TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_tasks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_logs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_members TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activities TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.important_dates TO service_role;

-- ============================================================
-- Tables accessed by jobs MCP
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_postings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.applications TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interviews TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_contacts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunities TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_interactions TO service_role;

-- ============================================================
-- Tables accessed by CRM MCP
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_contacts TO service_role;

-- ============================================================
-- Tables accessed by work-operating-model MCP
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operating_model_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operating_model_entries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operating_model_checkpoints TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operating_model_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operating_model_exports TO service_role;

-- ============================================================
-- Tables accessed by product-inventory MCP
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electronic_components TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electronic_devices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.component_pinouts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.component_pins TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.component_packages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.component_datasheets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.component_suppliers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.component_library_links TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_pinouts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_modules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_sensors TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_datasheets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.er_boms TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.er_projects TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.er_puzzles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.er_puzzle_deps TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.er_maintenance_logs TO service_role;

-- ============================================================
-- Tables accessed by supabase-worklog MCP
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_log TO service_role;

-- ============================================================
-- Tables accessed by corporate-intelligence (mcp-brasil, etc.)
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_intel TO service_role;

-- ============================================================
-- Tables accessed by collaborative-work MCPs (cw_*)
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cw_ideas TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cw_projects TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cw_collaborations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cw_work_calendar TO service_role;

-- ============================================================
-- Tables accessed by test_api (if any)
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_api TO service_role;
