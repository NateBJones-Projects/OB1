-- Workflow Status Tracking
-- Adds status columns to the thoughts table for kanban-style workflow management.
-- Safe to run multiple times (uses IF NOT EXISTS).

-- Add status column (nullable — only task/idea types use it)
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT NULL;

-- Add timestamp for tracking when status last changed
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ DEFAULT now();

-- Index for fast status filtering (partial — only rows with a status)
CREATE INDEX IF NOT EXISTS idx_thoughts_status ON thoughts (status) WHERE status IS NOT NULL;

-- Backfill: set existing task and idea thoughts to 'new' status
UPDATE thoughts
SET status = 'new', status_updated_at = now()
WHERE type IN ('task', 'idea') AND status IS NULL;
