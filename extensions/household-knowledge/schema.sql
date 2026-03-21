-- Extension 1: Household Knowledge Base
-- Schema for storing household facts and vendor contacts

-- Table: household_items
-- Stores facts about things in your home (paint colors, appliances, measurements, etc.)
CREATE TABLE IF NOT EXISTS household_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    category TEXT, -- e.g. 'paint', 'appliance', 'measurement', 'document'
    location TEXT, -- where in the home this item is
    details JSONB DEFAULT '{}', -- flexible metadata (model numbers, colors, specs, etc.)
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Table: household_vendors
-- Tracks service providers (plumbers, electricians, landscapers, etc.)
CREATE TABLE IF NOT EXISTS household_vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    service_type TEXT, -- e.g. 'plumber', 'electrician', 'landscaper'
    phone TEXT,
    email TEXT,
    website TEXT,
    notes TEXT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    last_used DATE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_household_items_user_category
    ON household_items(user_id, category);

CREATE INDEX IF NOT EXISTS idx_household_vendors_user_service
    ON household_vendors(user_id, service_type);

-- Row Level Security (RLS) policies
-- Enable RLS on both tables
ALTER TABLE household_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_vendors ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own household items
CREATE POLICY household_items_user_policy ON household_items
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can only see their own vendors
CREATE POLICY household_vendors_user_policy ON household_vendors
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on household_items
DROP TRIGGER IF EXISTS update_household_items_updated_at ON household_items;
CREATE TRIGGER update_household_items_updated_at
    BEFORE UPDATE ON household_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Sample data (optional - uncomment to insert examples)
-- INSERT INTO household_items (user_id, name, category, location, details, notes) VALUES
-- (auth.uid(), 'Living Room Paint', 'paint', 'Living Room', '{"brand": "Sherwin Williams", "color": "Sea Salt", "code": "SW 6204"}', 'Purchased 2 gallons in March 2025'),
-- (auth.uid(), 'Dishwasher', 'appliance', 'Kitchen', '{"brand": "Bosch", "model": "SHPM65Z55N", "serial": "FD12345678", "purchase_date": "2024-06-15"}', 'Still under warranty until June 2026');
