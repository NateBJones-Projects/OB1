-- OB-Graph: Knowledge Graph Layer for Open Brain
-- Adds graph database functionality on top of PostgreSQL using a nodes + edges
-- pattern. traverse_graph uses a recursive CTE (enumerates acyclic paths);
-- find_shortest_path uses an iterative plpgsql BFS (one row per reachable
-- node along the shortest path). Integrates with the core thoughts table
-- without modifying it.

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
--
-- Semantics: one row per acyclic path. If there are multiple paths to the
-- same node (e.g. A→B via two different relationship_types, or A→B→D and
-- A→C→D), each path is emitted as its own row. The per-path cycle check
-- (NOT n.id = ANY(gw.path)) prevents infinite recursion; bound execution
-- further with p_max_depth on dense graphs.
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
-- Helper: reconstruct_bfs_path
-- Walks a JSONB parent pointer map (built by the BFS functions below) from
-- a target node back to the start, returning the full path as a UUID[].
-- Kept as a separate SQL function so traverse_graph and find_shortest_path
-- share the same reconstruction logic.
-- ============================================================================
CREATE OR REPLACE FUNCTION reconstruct_bfs_path(
    p_parent_map JSONB,
    p_start_node_id UUID,
    p_target_node_id UUID
)
RETURNS UUID[] AS $$
DECLARE
    v_path UUID[] := ARRAY[p_target_node_id]::UUID[];
    v_current UUID := p_target_node_id;
    v_entry JSONB;
    v_guard INT := 0;
BEGIN
    -- v_guard caps the walk at a sane length so a malformed parent_map
    -- (shouldn't happen, but defence-in-depth) can't spin forever.
    WHILE v_current IS NOT NULL AND v_current <> p_start_node_id AND v_guard < 10000 LOOP
        v_entry := p_parent_map -> (v_current::text);
        IF v_entry IS NULL THEN
            RETURN NULL;
        END IF;
        v_current := (v_entry ->> 'parent')::UUID;
        v_path := v_current || v_path;
        v_guard := v_guard + 1;
    END LOOP;

    IF v_current IS NULL OR v_current <> p_start_node_id THEN
        RETURN NULL;
    END IF;

    RETURN v_path;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- Function: find_shortest_path
-- Shortest path between two nodes, following edges in either direction.
-- Returns one row per step along the path (starting at step 1) with the node
-- that was reached and the relationship used to get there.
--
-- Implemented as an iterative plpgsql BFS with a global seen-set. Each node
-- is visited at most once, so the function stays bounded even when the graph
-- contains cycles (A → B → A) or hub nodes with thousands of neighbours —
-- both of which could cause the previous recursive-CTE version to blow past
-- statement_timeout or exhaust memory.
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
DECLARE
    v_depth INT := 0;
    v_frontier UUID[] := ARRAY[p_start_node_id]::UUID[];
    v_seen UUID[] := ARRAY[p_start_node_id]::UUID[];
    v_parent_map JSONB := '{}'::jsonb;
    v_next_ids UUID[];
    v_next_map JSONB;
    v_found BOOLEAN := false;
    v_path UUID[];
    v_start_exists BOOLEAN;
    v_end_exists BOOLEAN;
BEGIN
    IF p_start_node_id IS NULL OR p_end_node_id IS NULL THEN
        RETURN;
    END IF;

    -- Validate both endpoints exist for this user. If either is missing or
    -- belongs to someone else, RLS would have excluded it anyway; return an
    -- empty result set rather than silently falling through the BFS.
    SELECT EXISTS (
        SELECT 1 FROM graph_nodes
        WHERE id = p_start_node_id AND user_id = p_user_id
    ) INTO v_start_exists;
    SELECT EXISTS (
        SELECT 1 FROM graph_nodes
        WHERE id = p_end_node_id AND user_id = p_user_id
    ) INTO v_end_exists;
    IF NOT v_start_exists OR NOT v_end_exists THEN
        RETURN;
    END IF;

    -- Trivial case: start == end. The original recursive-CTE version would
    -- have emitted the single start node; preserve that shape.
    IF p_start_node_id = p_end_node_id THEN
        RETURN QUERY
        SELECT 1::INT AS step,
               n.id AS node_id,
               n.label AS node_label,
               NULL::TEXT AS via_relationship
        FROM graph_nodes n
        WHERE n.id = p_start_node_id
          AND n.user_id = p_user_id;
        RETURN;
    END IF;

    -- Iterative BFS. Edges are followed in either direction (bidirectional
    -- pathfinding, matching the original CTE's semantics). For each newly
    -- discovered node we record the parent + relationship that first reached
    -- it; DISTINCT ON (next_id) ensures only the first discovery wins.
    WHILE v_depth < p_max_depth
          AND NOT v_found
          AND v_frontier IS NOT NULL
          AND array_length(v_frontier, 1) IS NOT NULL LOOP

        SELECT
            COALESCE(array_agg(next_id), ARRAY[]::UUID[]),
            COALESCE(
                jsonb_object_agg(
                    next_id::text,
                    jsonb_build_object('parent', parent_id, 'relation', relation_type)
                ),
                '{}'::jsonb
            )
        INTO v_next_ids, v_next_map
        FROM (
            SELECT DISTINCT ON (next_id) next_id, parent_id, relation_type
            FROM (
                SELECT
                    e.target_node_id AS next_id,
                    e.source_node_id AS parent_id,
                    e.relationship_type AS relation_type
                FROM graph_edges e
                WHERE e.user_id = p_user_id
                  AND e.source_node_id = ANY(v_frontier)
                  AND NOT (e.target_node_id = ANY(v_seen))

                UNION ALL

                SELECT
                    e.source_node_id AS next_id,
                    e.target_node_id AS parent_id,
                    e.relationship_type AS relation_type
                FROM graph_edges e
                WHERE e.user_id = p_user_id
                  AND e.target_node_id = ANY(v_frontier)
                  AND NOT (e.source_node_id = ANY(v_seen))
            ) layer
            JOIN graph_nodes n ON n.id = layer.next_id
                              AND n.user_id = p_user_id
            ORDER BY next_id
        ) dedup;

        IF v_next_ids IS NULL OR array_length(v_next_ids, 1) IS NULL THEN
            EXIT;
        END IF;

        v_parent_map := v_parent_map || v_next_map;
        v_seen := v_seen || v_next_ids;

        IF p_end_node_id = ANY(v_next_ids) THEN
            v_found := true;
            EXIT;
        END IF;

        v_frontier := v_next_ids;
        v_depth := v_depth + 1;
    END LOOP;

    IF NOT v_found THEN
        RETURN;
    END IF;

    -- Reconstruct the path end → start by walking parent pointers, then emit
    -- one row per step. Step 1 is the start node with NULL via_relationship;
    -- each subsequent step carries the relationship used to arrive there.
    v_path := reconstruct_bfs_path(v_parent_map, p_start_node_id, p_end_node_id);
    IF v_path IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        u.ordinality::INT AS step,
        gn.id AS node_id,
        gn.label AS node_label,
        CASE WHEN u.ordinality = 1 THEN NULL
             ELSE v_parent_map -> (u.nid::text) ->> 'relation'
        END AS via_relationship
    FROM unnest(v_path) WITH ORDINALITY AS u(nid, ordinality)
    JOIN graph_nodes gn ON gn.id = u.nid AND gn.user_id = p_user_id
    ORDER BY u.ordinality;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Grant permissions to service_role (required on newer Supabase projects)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.graph_nodes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.graph_edges TO service_role;

-- ============================================================================
-- Lock down internal helper
-- reconstruct_bfs_path is plumbing for find_shortest_path (and any future
-- BFS helper). It should not be exposed as a PostgREST RPC to anon or
-- authenticated roles — only server-side callers (service_role) need it.
-- ============================================================================
REVOKE ALL ON FUNCTION public.reconstruct_bfs_path(jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconstruct_bfs_path(jsonb, uuid, uuid) TO service_role;

-- ============================================================================
-- Lock down RPC entry points
-- find_shortest_path and traverse_graph are intended for server-side callers
-- (edge functions using SUPABASE_SERVICE_ROLE_KEY). Revoke default PUBLIC
-- EXECUTE so PostgREST rejects anon/authenticated calls at the entry point
-- rather than crashing inside reconstruct_bfs_path on a permission error.
-- ============================================================================
REVOKE ALL ON FUNCTION public.find_shortest_path(uuid, uuid, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_shortest_path(uuid, uuid, uuid, int) TO service_role;

REVOKE ALL ON FUNCTION public.traverse_graph(uuid, uuid, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.traverse_graph(uuid, uuid, int, text) TO service_role;
