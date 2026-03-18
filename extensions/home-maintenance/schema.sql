-- Extension 2: Home Maintenance Tracker
-- Schema for tracking maintenance tasks and logging completed work

-- Table: maintenance_tasks
-- Recurring or one-time maintenance items
CREATE TABLE IF NOT EXISTS maintenance_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    category TEXT, -- e.g. 'hvac', 'plumbing', 'exterior', 'appliance', 'landscaping'
    frequency_days INTEGER, -- null for one-time tasks; e.g. 90 for quarterly, 365 for annual
    last_completed TIMESTAMPTZ, -- when was this last done
    next_due TIMESTAMPTZ, -- when is it due next
    priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Table: maintenance_logs
-- History of completed maintenance work
CREATE TABLE IF NOT EXISTS maintenance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES maintenance_tasks(id) ON DELETE CASCADE NOT NULL,
    user_id UUID NOT NULL,
    completed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    performed_by TEXT, -- who did the work (self, vendor name, etc.)
    cost DECIMAL(10, 2), -- cost in dollars (or your currency)
    notes TEXT,
    next_action TEXT -- what the tech/contractor recommended for next time
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_user_next_due
    ON maintenance_tasks(user_id, next_due);

CREATE INDEX IF NOT EXISTS idx_maintenance_logs_task_completed
    ON maintenance_logs(task_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_maintenance_logs_user_completed
    ON maintenance_logs(user_id, completed_at DESC);

-- Row Level Security (RLS) policies
ALTER TABLE maintenance_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own maintenance tasks
CREATE POLICY maintenance_tasks_user_policy ON maintenance_tasks
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can only see their own maintenance logs
CREATE POLICY maintenance_logs_user_policy ON maintenance_logs
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Function to automatically update updated_at timestamp on maintenance_tasks
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on maintenance_tasks
DROP TRIGGER IF EXISTS update_maintenance_tasks_updated_at ON maintenance_tasks;
CREATE TRIGGER update_maintenance_tasks_updated_at
    BEFORE UPDATE ON maintenance_tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to update task's last_completed and next_due after logging maintenance
-- This trigger runs when a new maintenance_log is inserted
CREATE OR REPLACE FUNCTION update_task_after_maintenance_log()
RETURNS TRIGGER AS $$
DECLARE
    task_frequency INTEGER;
BEGIN
    -- Get the frequency_days from the associated task
    SELECT frequency_days INTO task_frequency
    FROM maintenance_tasks
    WHERE id = NEW.task_id;

    -- Update the task's last_completed and next_due
    UPDATE maintenance_tasks
    SET
        last_completed = NEW.completed_at,
        next_due = CASE
            WHEN task_frequency IS NOT NULL THEN NEW.completed_at + (task_frequency || ' days')::INTERVAL
            ELSE NULL
        END,
        updated_at = now()
    WHERE id = NEW.task_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update parent task when maintenance is logged
DROP TRIGGER IF EXISTS update_task_after_log ON maintenance_logs;
CREATE TRIGGER update_task_after_log
    AFTER INSERT ON maintenance_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_task_after_maintenance_log();

-- Sample data (optional - uncomment to insert examples)
-- INSERT INTO maintenance_tasks (user_id, name, category, frequency_days, next_due, priority, notes) VALUES
-- (auth.uid(), 'HVAC Filter Replacement', 'hvac', 90, now() + INTERVAL '90 days', 'medium', 'Use 16x25x1 pleated filters'),
-- (auth.uid(), 'Gutter Cleaning', 'exterior', 180, now() + INTERVAL '180 days', 'medium', 'Best to do before rainy season'),
-- (auth.uid(), 'Water Heater Inspection', 'plumbing', 365, now() + INTERVAL '365 days', 'low', 'Check for leaks and sediment buildup');
