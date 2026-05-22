# OB-Graph: Knowledge Graph Layer for Open Brain

A knowledge graph you can build and query through your AI — powered by PostgreSQL, deployed as a Supabase Edge Function, and accessed via MCP.

## Why This Matters

Your Open Brain stores thoughts, but thoughts don't exist in isolation. Projects depend on tools. People work at companies. Concepts connect to other concepts. Without explicit relationships, your AI has to re-derive connections every time you ask "how is X related to Y?" OB-Graph gives your thoughts a relationship layer — nodes for entities, edges for connections, and graph traversal to surface paths you didn't know existed.

## What It Does

Adds two tables (`graph_nodes`, `graph_edges`) and an MCP server with 10 tools for:

- **Building** a knowledge graph — create nodes (people, projects, concepts, tools) and connect them with typed edges (works_on, depends_on, related_to)
- **Querying** relationships — get direct neighbors, multi-hop traversal, and shortest-path between any two nodes
- **Linking** to existing thoughts — nodes can optionally reference a thought via `thought_id`

All graph traversal runs in PostgreSQL using recursive CTEs — no external graph database needed.

## Prerequisites

- Working Open Brain setup ([Getting Started guide](../../docs/01-getting-started.md))
- Supabase project configured
- Supabase CLI installed and linked to your project

## Credential Tracker

```text
OB-GRAPH -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________
  Project ref:           ____________

GENERATED DURING SETUP
  Default User ID:       ____________
  MCP Access Key:        ____________
  MCP Server URL:        ____________
  MCP Connection URL:    ____________

--------------------------------------
```

## Setup Instructions

![Step 1](https://img.shields.io/badge/Step_1-Create_Database_Schema-2E86AB?style=for-the-badge)

<details>
<summary><strong>SQL: Create tables, indexes, RLS, and graph functions</strong> (click to expand)</summary>

Run the contents of `schema.sql` in your Supabase SQL Editor (Dashboard → SQL Editor → New Query → paste → Run).

The schema creates:

| Object | Purpose |
|--------|---------|
| `graph_nodes` | Entities in your knowledge graph |
| `graph_edges` | Directed relationships between nodes |
| `traverse_graph()` | Recursive CTE function for multi-hop traversal |
| `find_shortest_path()` | BFS shortest path between two nodes |
| RLS policies | User-scoped data isolation on both tables |
| Indexes | Fast lookups by user, type, label, source/target |

</details>

> [!IMPORTANT]
> The schema includes `GRANT` statements for `service_role`. These are required on newer Supabase projects — don't skip them.

Done when: You can see `graph_nodes` and `graph_edges` in the Supabase Table Editor, and both functions appear under Database → Functions.

---

![Step 2](https://img.shields.io/badge/Step_2-Deploy_the_MCP_Server-2E86AB?style=for-the-badge)

Follow the [Deploy an Edge Function](../../primitives/deploy-edge-function/) guide using these values:

| Setting | Value |
|---------|-------|
| Function name | `ob-graph-mcp` |
| Download path | `recipes/ob-graph` |

Before you deploy, generate an MCP access key and decide which Open Brain user this graph belongs to. Then set the function secrets from `.env.example`:

```bash
openssl rand -hex 32
supabase secrets set \
  MCP_ACCESS_KEY=your-generated-key \
  DEFAULT_USER_ID=your-user-uuid
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically by Supabase for Edge Functions. You only need to set `MCP_ACCESS_KEY` and `DEFAULT_USER_ID` manually.

Done when: The `ob-graph-mcp` function is deployed successfully and its secrets include `MCP_ACCESS_KEY` and `DEFAULT_USER_ID`.

---

![Step 3](https://img.shields.io/badge/Step_3-Connect_to_Your_AI-2E86AB?style=for-the-badge)

Follow the [Remote MCP Connection](../../primitives/remote-mcp/) guide to connect this recipe to Claude Desktop, ChatGPT, Claude Code, or any other MCP client.

| Setting | Value |
|---------|-------|
| Connector name | `OB-Graph` |
| URL | Your **MCP Connection URL** from the credential tracker |

Done when: Your AI client can connect to the OB-Graph MCP server without authentication errors and the tools appear in its MCP tool list.

---

![Step 4](https://img.shields.io/badge/Step_4-Test_the_Graph-2E86AB?style=for-the-badge)

Try these commands with your AI:

**Build a small graph:**

```
Create these graph nodes:
- "Supabase" (type: tool)
- "Open Brain" (type: project)
- "PostgreSQL" (type: tool)

Then connect them:
- Open Brain --depends_on--> Supabase
- Open Brain --depends_on--> PostgreSQL
- Supabase --built_with--> PostgreSQL
```

**Query relationships:**

```
What are all the neighbors of "Open Brain" in my graph?
```

```
Traverse my graph starting from "Supabase" up to 3 hops deep
```

```
Find the shortest path between "PostgreSQL" and "Open Brain"
```

Done when: Your AI can create nodes, connect them with edges, and traverse the graph to answer relationship questions.

## MCP Tools Reference

| Tool | Description |
|------|-------------|
| `create_node` | Add an entity node (person, project, concept, tool, place) |
| `create_edge` | Create a directed relationship between two nodes |
| `search_nodes` | Find nodes by label or type |
| `get_neighbors` | Get direct connections (incoming, outgoing, or both) |
| `traverse_graph` | Multi-hop walk from a starting node (recursive CTE) |
| `find_path` | Shortest path between two nodes (bidirectional BFS) |
| `update_node` | Update label, type, or merge new properties |
| `delete_node` | Remove a node and all its edges (CASCADE) |
| `delete_edge` | Remove a specific relationship |
| `list_edge_types` | List all relationship types in use with counts |

> [!TIP]
> As your graph grows, see the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) for strategies on managing tool context.

## How the Graph Traversal Works

OB-Graph uses PostgreSQL recursive CTEs instead of a dedicated graph database. Here's the pattern:

```sql
WITH RECURSIVE graph_walk AS (
    -- Base case: start node
    SELECT id, label, 0 AS depth, ARRAY[id] AS path
    FROM graph_nodes WHERE id = start_id

    UNION ALL

    -- Recursive case: follow edges, prevent cycles via path check
    SELECT n.id, n.label, gw.depth + 1, gw.path || n.id
    FROM graph_walk gw
    JOIN graph_edges e ON e.source_node_id = gw.id
    JOIN graph_nodes n ON n.id = e.target_node_id
    WHERE gw.depth < max_depth
      AND NOT n.id = ANY(gw.path)  -- cycle prevention
)
SELECT * FROM graph_walk;
```

This approach works well for knowledge graphs with thousands of nodes. It stays within Supabase's free tier limits (no extra services or extensions required) and gives you traversal, pathfinding, and neighbor queries — the core operations you need for relationship exploration.

> [!NOTE]
> Recursive CTEs are bounded by `max_depth` and cycle prevention. For very large graphs (100k+ edges), consider adding a `weight` threshold filter to prune low-confidence edges during traversal.

## Expected Outcome

After setup, your AI can:

1. Build a knowledge graph of entities and relationships as you talk about them
2. Answer "how is X related to Y?" with concrete graph paths
3. Explore multi-hop connections ("what's 3 degrees from this project?")
4. List all relationship types to understand your graph's structure
5. Link graph nodes back to existing thoughts for full context

## Troubleshooting

### "relation 'graph_nodes' does not exist"

You haven't run the SQL from Step 1 yet. Copy `schema.sql` into your Supabase SQL Editor and run it.

### "function traverse_graph does not exist"

The SQL functions at the bottom of `schema.sql` didn't run. Make sure you execute the **entire** file, not just the `CREATE TABLE` statements. The functions (`traverse_graph`, `find_shortest_path`) are defined after the tables.

> [!WARNING]
> If you ran only part of the SQL, run the full file again — all statements use `IF NOT EXISTS` or `CREATE OR REPLACE`, so re-running is safe.

### "duplicate key value violates constraint unique_edge"

You're trying to create an edge that already exists (same source, target, and relationship type). This is by design — the `unique_edge` constraint prevents duplicate relationships. If you want to update an existing edge's weight or properties, delete the old edge first and create a new one.
