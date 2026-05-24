/**
 * OB-Graph: Knowledge Graph MCP Server for Open Brain
 *
 * Provides tools for building and querying a knowledge graph on top of
 * PostgreSQL. Uses a nodes + edges model: traverse_graph is a recursive CTE
 * (enumerates acyclic paths); find_shortest_path is an iterative plpgsql BFS
 * with a seen-set.
 *
 * Tools:
 *   - create_node       — Add a node to the graph
 *   - create_edge       — Create a relationship between two nodes
 *   - search_nodes      — Find nodes by label, type, or properties
 *   - get_neighbors     — Get direct connections of a node
 *   - traverse_graph    — Multi-hop traversal from a starting node
 *   - find_path         — Shortest path between two nodes
 *   - update_node       — Update a node's label, type, or properties
 *   - delete_node       — Remove a node and all its edges
 *   - delete_edge       — Remove a specific edge
 *   - list_edge_types   — List all relationship types in use
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const app = new Hono();

app.post("*", async (c) => {
  // Fix: Claude Desktop connectors don't send the Accept header that
  // StreamableHTTPTransport requires. Build a patched request if missing.
  if (!c.req.header("accept")?.includes("text/event-stream")) {
    const headers = new Headers(c.req.raw.headers);
    headers.set("Accept", "application/json, text/event-stream");
    const patched = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: c.req.raw.body,
      // @ts-ignore -- duplex required for streaming body in Deno
      duplex: "half",
    });
    Object.defineProperty(c.req, "raw", { value: patched, writable: true });
  }

  const key = c.req.query("key") || c.req.header("x-access-key");
  const expected = Deno.env.get("MCP_ACCESS_KEY");
  if (!key || key !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const userId = Deno.env.get("DEFAULT_USER_ID");
  if (!userId) {
    return c.json({ error: "DEFAULT_USER_ID not configured" }, 500);
  }

  const server = new McpServer(
    { name: "ob-graph", version: "1.0.1" },
  );

  // ==========================================================================
  // Tool: create_node
  // ==========================================================================
  server.tool(
    "create_node",
    "Add a node to the knowledge graph. Nodes represent entities like people, projects, concepts, tools, or places.",
    {
      label: z.string().describe("Human-readable name for the node (e.g. 'Supabase', 'Project Alpha')"),
      node_type: z.string().optional().describe("Classification: person, project, concept, place, tool, etc. Defaults to 'entity'"),
      properties: z.string().optional().describe("JSON string of flexible metadata (e.g. '{\"url\": \"https://...\", \"priority\": \"high\"}')"),
      thought_id: z.string().optional().describe("Optional UUID linking this node to an existing thought"),
    },
    async ({ label, node_type, properties, thought_id }) => {
      try {
        let parsedProps = {};
        if (properties) {
          parsedProps = JSON.parse(properties);
        }

        const { data, error } = await supabase
          .from("graph_nodes")
          .insert({
            user_id: userId,
            label,
            node_type: node_type || "entity",
            properties: parsedProps,
            thought_id: thought_id || null,
          })
          .select()
          .single();

        if (error) throw new Error(`Failed to create node: ${error.message}`);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: `Created node: ${label}`, node: data }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: msg }) }], isError: true };
      }
    },
  );

  // ==========================================================================
  // Tool: create_edge
  // ==========================================================================
  server.tool(
    "create_edge",
    "Create a directed relationship (edge) between two nodes in the graph.",
    {
      source_node_id: z.string().describe("UUID of the source node"),
      target_node_id: z.string().describe("UUID of the target node"),
      relationship_type: z.string().describe("Type of relationship (e.g. 'works_on', 'depends_on', 'knows', 'related_to')"),
      weight: z.number().optional().describe("Strength/confidence of relationship, 0.0–1.0+. Defaults to 1.0"),
      properties: z.string().optional().describe("JSON string of edge metadata"),
    },
    async ({ source_node_id, target_node_id, relationship_type, weight, properties }) => {
      try {
        let parsedProps = {};
        if (properties) {
          parsedProps = JSON.parse(properties);
        }

        const { data, error } = await supabase
          .from("graph_edges")
          .insert({
            user_id: userId,
            source_node_id,
            target_node_id,
            relationship_type,
            weight: weight ?? 1.0,
            properties: parsedProps,
          })
          .select()
          .single();

        if (error) throw new Error(`Failed to create edge: ${error.message}`);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: `Created edge: ${relationship_type}`, edge: data }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: msg }) }], isError: true };
      }
    },
  );

  // ==========================================================================
  // Tool: search_nodes
  // ==========================================================================
  server.tool(
    "search_nodes",
    "Search for nodes by label, type, or properties. Returns matching nodes.",
    {
      query: z.string().optional().describe("Search term — matches against node label (case-insensitive)"),
      node_type: z.string().optional().describe("Filter by node type (e.g. 'person', 'project')"),
      limit: z.number().optional().describe("Max results to return. Defaults to 25"),
    },
    async ({ query, node_type, limit }) => {
      try {
        let qb = supabase
          .from("graph_nodes")
          .select("*")
          .eq("user_id", userId);

        if (query) {
          qb = qb.ilike("label", `%${query}%`);
        }
        if (node_type) {
          qb = qb.eq("node_type", node_type);
        }

        const { data, error } = await qb
          .order("updated_at", { ascending: false })
          .limit(limit || 25);

        if (error) throw new Error(`Failed to search nodes: ${error.message}`);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, count: data.length, nodes: data }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: msg }) }], isError: true };
      }
    },
  );

  // ==========================================================================
  // Tool: get_neighbors
  // ==========================================================================
  server.tool(
    "get_neighbors",
    "Get all nodes directly connected to a given node (both incoming and outgoing edges).",
    {
      node_id: z.string().describe("UUID of the node to get neighbors for"),
      relationship_type: z.string().optional().describe("Filter by relationship type"),
      direction: z.enum(["outgoing", "incoming", "both"]).optional().describe("Edge direction. Defaults to 'both'"),
    },
    async ({ node_id, relationship_type, direction }) => {
      try {
        const dir = direction || "both";
        const results: Array<Record<string, unknown>> = [];

        // Outgoing edges
        if (dir === "outgoing" || dir === "both") {
          let qb = supabase
            .from("graph_edges")
            .select("id, relationship_type, weight, properties, target_node_id, graph_nodes!graph_edges_target_node_id_fkey(id, label, node_type, properties)")
            .eq("user_id", userId)
            .eq("source_node_id", node_id);

          if (relationship_type) {
            qb = qb.eq("relationship_type", relationship_type);
          }

          const { data, error } = await qb;
          if (error) throw new Error(`Failed to get outgoing neighbors: ${error.message}`);

          for (const edge of data || []) {
            results.push({
              direction: "outgoing",
              edge_id: edge.id,
              relationship_type: edge.relationship_type,
              weight: edge.weight,
              edge_properties: edge.properties,
              neighbor: edge.graph_nodes,
            });
          }
        }

        // Incoming edges
        if (dir === "incoming" || dir === "both") {
          let qb = supabase
            .from("graph_edges")
            .select("id, relationship_type, weight, properties, source_node_id, graph_nodes!graph_edges_source_node_id_fkey(id, label, node_type, properties)")
            .eq("user_id", userId)
            .eq("target_node_id", node_id);

          if (relationship_type) {
            qb = qb.eq("relationship_type", relationship_type);
          }

          const { data, error } = await qb;
          if (error) throw new Error(`Failed to get incoming neighbors: ${error.message}`);

          for (const edge of data || []) {
            results.push({
              direction: "incoming",
              edge_id: edge.id,
              relationship_type: edge.relationship_type,
              weight: edge.weight,
              edge_properties: edge.properties,
              neighbor: edge.graph_nodes,
            });
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, count: results.length, neighbors: results }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: msg }) }], isError: true };
      }
    },
  );

  // ==========================================================================
  // Tool: traverse_graph
  // ==========================================================================
  server.tool(
    "traverse_graph",
    "Walk the graph from a starting node up to N hops deep. Returns all reachable nodes with paths. Uses the traverse_graph SQL function.",
    {
      start_node_id: z.string().describe("UUID of the node to start traversal from"),
      max_depth: z.number().optional().describe("Maximum number of hops. Defaults to 3"),
      relationship_type: z.string().optional().describe("Only follow edges of this type. Omit to follow all."),
    },
    async ({ start_node_id, max_depth, relationship_type }) => {
      try {
        const { data, error } = await supabase.rpc("traverse_graph", {
          p_user_id: userId,
          p_start_node_id: start_node_id,
          p_max_depth: max_depth ?? 3,
          p_relationship_type: relationship_type || null,
        });

        if (error) throw new Error(`Traversal failed: ${error.message}`);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, count: data.length, nodes: data }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: msg }) }], isError: true };
      }
    },
  );

  // ==========================================================================
  // Tool: find_path
  // ==========================================================================
  server.tool(
    "find_path",
    "Find the shortest path between two nodes in the graph. Follows edges in both directions.",
    {
      start_node_id: z.string().describe("UUID of the starting node"),
      end_node_id: z.string().describe("UUID of the target node"),
      max_depth: z.number().optional().describe("Maximum path length. Defaults to 6"),
    },
    async ({ start_node_id, end_node_id, max_depth }) => {
      try {
        const { data, error } = await supabase.rpc("find_shortest_path", {
          p_user_id: userId,
          p_start_node_id: start_node_id,
          p_end_node_id: end_node_id,
          p_max_depth: max_depth ?? 6,
        });

        if (error) throw new Error(`Pathfinding failed: ${error.message}`);

        if (!data || data.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ success: true, path_found: false, message: "No path found between these nodes" }, null, 2),
            }],
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, path_found: true, steps: data.length, path: data }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: msg }) }], isError: true };
      }
    },
  );

  // ==========================================================================
  // Tool: update_node
  // ==========================================================================
  server.tool(
    "update_node",
    "Update an existing node's label, type, or properties.",
    {
      node_id: z.string().describe("UUID of the node to update"),
      label: z.string().optional().describe("New label for the node"),
      node_type: z.string().optional().describe("New node type"),
      properties: z.string().optional().describe("JSON string of properties to merge into existing properties"),
    },
    async ({ node_id, label, node_type, properties }) => {
      try {
        const updates: Record<string, unknown> = {};
        if (label) updates.label = label;
        if (node_type) updates.node_type = node_type;

        if (properties) {
          // Merge new properties with existing
          const { data: existing } = await supabase
            .from("graph_nodes")
            .select("properties")
            .eq("id", node_id)
            .eq("user_id", userId)
            .single();

          const existingProps = existing?.properties || {};
          const newProps = JSON.parse(properties);
          updates.properties = { ...existingProps, ...newProps };
        }

        if (Object.keys(updates).length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({ success: false, error: "No fields to update" }) }],
            isError: true,
          };
        }

        const { data, error } = await supabase
          .from("graph_nodes")
          .update(updates)
          .eq("id", node_id)
          .eq("user_id", userId)
          .select()
          .single();

        if (error) throw new Error(`Failed to update node: ${error.message}`);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: `Updated node: ${data.label}`, node: data }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: msg }) }], isError: true };
      }
    },
  );

  // ==========================================================================
  // Tool: delete_node
  // ==========================================================================
  server.tool(
    "delete_node",
    "Remove a node and all its connected edges from the graph.",
    {
      node_id: z.string().describe("UUID of the node to delete"),
    },
    async ({ node_id }) => {
      try {
        // Edges are deleted automatically via ON DELETE CASCADE
        const { error } = await supabase
          .from("graph_nodes")
          .delete()
          .eq("id", node_id)
          .eq("user_id", userId);

        if (error) throw new Error(`Failed to delete node: ${error.message}`);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: "Node and connected edges deleted" }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: msg }) }], isError: true };
      }
    },
  );

  // ==========================================================================
  // Tool: delete_edge
  // ==========================================================================
  server.tool(
    "delete_edge",
    "Remove a specific edge (relationship) from the graph.",
    {
      edge_id: z.string().describe("UUID of the edge to delete"),
    },
    async ({ edge_id }) => {
      try {
        const { error } = await supabase
          .from("graph_edges")
          .delete()
          .eq("id", edge_id)
          .eq("user_id", userId);

        if (error) throw new Error(`Failed to delete edge: ${error.message}`);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: "Edge deleted" }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: msg }) }], isError: true };
      }
    },
  );

  // ==========================================================================
  // Tool: list_edge_types
  // ==========================================================================
  server.tool(
    "list_edge_types",
    "List all distinct relationship types currently in your graph, with counts.",
    {},
    async () => {
      try {
        const { data, error } = await supabase
          .from("graph_edges")
          .select("relationship_type")
          .eq("user_id", userId);

        if (error) throw new Error(`Failed to list edge types: ${error.message}`);

        // Count occurrences of each type
        const counts: Record<string, number> = {};
        for (const row of data || []) {
          counts[row.relationship_type] = (counts[row.relationship_type] || 0) + 1;
        }

        const types = Object.entries(counts)
          .map(([type, count]) => ({ relationship_type: type, count }))
          .sort((a, b) => b.count - a.count);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, count: types.length, types }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: msg }) }], isError: true };
      }
    },
  );

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

app.get("*", (c) => c.json({ status: "ok", service: "OB-Graph MCP", version: "1.0.1" }));

Deno.serve(app.fetch);
