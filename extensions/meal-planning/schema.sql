-- Extension 4: Meal Planning
-- Complete meal planning system with RLS for shared household access

-- Recipe collection
CREATE TABLE recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    cuisine TEXT,
    prep_time_minutes INTEGER,
    cook_time_minutes INTEGER,
    servings INTEGER,
    ingredients JSONB NOT NULL DEFAULT '[]', -- array of {name, quantity, unit}
    instructions JSONB NOT NULL DEFAULT '[]', -- array of step strings
    tags TEXT[] DEFAULT '{}',
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Weekly meal planning
CREATE TABLE meal_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    week_start DATE NOT NULL, -- should be a Monday
    day_of_week TEXT NOT NULL, -- 'monday', 'tuesday', etc.
    meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
    recipe_id UUID REFERENCES recipes,
    custom_meal TEXT, -- for meals without a recipe
    servings INTEGER,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-generated or manual grocery lists
CREATE TABLE shopping_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    week_start DATE NOT NULL,
    items JSONB NOT NULL DEFAULT '[]', -- array of {name, quantity, unit, purchased: bool, recipe_id}
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_recipes_user_cuisine ON recipes(user_id, cuisine);
CREATE INDEX idx_recipes_user_tags ON recipes USING GIN (tags);
CREATE INDEX idx_meal_plans_user_week ON meal_plans(user_id, week_start);
CREATE INDEX idx_shopping_lists_user_week ON shopping_lists(user_id, week_start);

-- Enable Row Level Security
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_lists ENABLE ROW LEVEL SECURITY;

-- RLS Policies for recipes
CREATE POLICY "Users can CRUD their own recipes"
    ON recipes
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Household members can view recipes"
    ON recipes
    FOR SELECT
    USING (
        auth.jwt() ->> 'role' = 'household_member'
        OR auth.uid() = user_id
    );

-- RLS Policies for meal_plans
CREATE POLICY "Users can CRUD their own meal plans"
    ON meal_plans
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Household members can view meal plans"
    ON meal_plans
    FOR SELECT
    USING (
        auth.jwt() ->> 'role' = 'household_member'
        OR auth.uid() = user_id
    );

-- RLS Policies for shopping_lists
CREATE POLICY "Users can CRUD their own shopping lists"
    ON shopping_lists
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Household members can view shopping lists"
    ON shopping_lists
    FOR SELECT
    USING (
        auth.jwt() ->> 'role' = 'household_member'
        OR auth.uid() = user_id
    );

CREATE POLICY "Household members can update shopping lists"
    ON shopping_lists
    FOR UPDATE
    USING (
        auth.jwt() ->> 'role' = 'household_member'
        OR auth.uid() = user_id
    )
    WITH CHECK (
        auth.jwt() ->> 'role' = 'household_member'
        OR auth.uid() = user_id
    );
