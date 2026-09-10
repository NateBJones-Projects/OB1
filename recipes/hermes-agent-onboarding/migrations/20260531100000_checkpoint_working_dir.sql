-- Migration: Add working_dir and repo_path to session_checkpoints (2026-05-31)
-- 
-- working_dir: filesystem path of the project being worked on
-- repo_path: Git repository path (if applicable)
-- 
-- These fields save filesystem searches across sessions.

ALTER TABLE public.session_checkpoints
  ADD COLUMN IF NOT EXISTS working_dir TEXT,
  ADD COLUMN IF NOT EXISTS repo_path TEXT;
