-- OB-Graph: Knowledge Graph Layer for Open Brain
-- Adds graph database functionality on top of PostgreSQL using a nodes + edges
-- pattern with recursive CTEs for traversal. Integrates with the core thoughts
-- table without modifying it.

-- ============================================================================
-- Table: graph_nodes
-- Represents entities in the knowledge graph. Nodes can optionally link to an
-- existing thought via thought_id, letting you layer graph structure over your
-- existing Open Brain data.
-- ============================================================================
CREATE TABLE IF NOT EXISTS graph_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    label TEXT NOT NULL,                     -- Human-readable name (e.g. "Supabase", "Project Alpha")
    node_type TEXT NOT NULL DEFAULT 'entity', -- Classification (e.g. "person", "project", "concept", "place", "tool")
    properties JSONB DEFAULT '{}',           -- Flexible metadata (tags, scores, urls, etc.)
    thought_id UUID,                         -- Optional FK to thoughts table for linking
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================================================
-- Table: graph_edges
-- Directed relationships between nodes. Each edge has a type (e.g. "works_on",
-- "depends_on", "knows") and optional weight + metadata.
-- ============================================================================
CREATE TABLE IF NOT EXISTS graph_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    source_node_id UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    target_node_id UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL,          -- e.g. "works_on", "depends_on", "related_to"
    weight REAL DEFAULT 1.0,                 -- Strength/confidence of relationship (0.0–1.0+)
    properties JSONB DEFAULT '{}',           -- Flexible edge metadata
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,

    -- Prevent duplicate edges of the same type between the same pair of nodes
    CONSTRAINT unique_edge UNIQUE (user_id, source_node_id, target_node_id, relationship_type)
);

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_graph_nodes_user_type
    ON graph_nodes(user_id, node_type);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_user_label
    ON graph_nodes(user_id, label);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_thought
    ON graph_nodes(thought_id);

CREATE INDEX IF NOT EXISTS idx_graph_edges_source
    ON graph_edges(user_id, source_node_id);

CREATE INDEX IF NOT EXISTS idx_graph_edges_target
    ON graph_edges(user_id, target_node_id);

CREATE INDEX IF NOT EXISTS idx_graph_edges_type
    ON graph_edges(user_id, relationship_type);

-- ============================================================================
-- Row Level Security
-- ============================================================================
ALTER TABLE graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY graph_nodes_user_policy ON graph_nodes
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY graph_edges_user_policy ON graph_edges
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- Triggers: auto-update updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_graph_nodes_updated_at ON graph_nodes;
CREATE TRIGGER update_graph_nodes_updated_at
    BEFORE UPDATE ON graph_nodes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Function: traverse_graph
-- Walks the graph from a starting node up to max_depth hops, returning all
-- reachable nodes and the paths taken. Uses a recursive CTE.
-- ============================================================================
CREATE OR REPLACE FUNCTION traverse_graph(
    p_user_id UUID,
    p_start_node_id UUID,
    p_max_depth INT DEFAULT 3,
    p_relationship_type TEXT DEFAULT NULL
)
RETURNS TABLE (
    node_id UUID,
    node_label TEXT,
    node_type TEXT,
    depth INT,
    path UUID[],
    via_relationship TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE graph_walk AS (
        -- Base case: the start node
        SELECT
            n.id AS node_id,
            n.label AS node_label,
            n.node_type AS node_type,
            0 AS depth,
            ARRAY[n.id] AS path,
            NULL::TEXT AS via_relationship
        FROM graph_nodes n
        WHERE n.id = p_start_node_id
          AND n.user_id = p_user_id

        UNION ALL

        -- Recursive case: follow outgoing edges
        SELECT
            n.id,
            n.label,
            n.node_type,
            gw.depth + 1,
            gw.path || n.id,
            e.relationship_type
        FROM graph_walk gw
        JOIN graph_edges e ON e.source_node_id = gw.node_id AND e.user_id = p_user_id
        JOIN graph_nodes n ON n.id = e.target_node_id AND n.user_id = p_user_id
        WHERE gw.depth < p_max_depth
          AND NOT n.id = ANY(gw.path)  -- prevent cycles
          AND (p_relationship_type IS NULL OR e.relationship_type = p_relationship_type)
    )
    SELECT * FROM graph_walk
    ORDER BY graph_walk.depth, graph_walk.node_label;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Function: find_shortest_path
-- BFS shortest path between two nodes. Returns the node IDs along the path
-- and the relationship types traversed.
-- ============================================================================
CREATE OR REPLACE FUNCTION find_shortest_path(
    p_user_id UUID,
    p_start_node_id UUID,
    p_end_node_id UUID,
    p_max_depth INT DEFAULT 6
)
RETURNS TABLE (
    step INT,
    node_id UUID,
    node_label TEXT,
    via_relationship TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE bfs AS (
        SELECT
            n.id AS node_id,
            n.label AS node_label,
            0 AS depth,
            ARRAY[n.id] AS path,
            ARRAY[NULL::TEXT] AS relationships
        FROM graph_nodes n
        WHERE n.id = p_start_node_id
          AND n.user_id = p_user_id

        UNION ALL

        SELECT
            n.id,
            n.label,
            b.depth + 1,
            b.path || n.id,
            b.relationships || e.relationship_type
        FROM bfs b
        JOIN graph_edges e ON (e.source_node_id = b.node_id OR e.target_node_id = b.node_id) AND e.user_id = p_user_id
        JOIN graph_nodes n ON n.id = CASE WHEN e.source_node_id = b.node_id THEN e.target_node_id ELSE e.source_node_id END
            AND n.user_id = p_user_id
        WHERE b.depth < p_max_depth
          AND NOT n.id = ANY(b.path)
    ),
    shortest AS (
        SELECT path, relationships
        FROM bfs
        WHERE node_id = p_end_node_id
        ORDER BY depth
        LIMIT 1
    )
    SELECT
        row_number() OVER (ORDER BY u.ordinality)::INT AS step,
        gn.id AS node_id,
        gn.label AS node_label,
        s.relationships[ordinality] AS via_relationship
    FROM shortest s,
         unnest(s.path) WITH ORDINALITY AS u(nid, ordinality)
    JOIN graph_nodes gn ON gn.id = u.nid;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Grant permissions to service_role (required on newer Supabase projects)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.graph_nodes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.graph_edges TO service_role;
