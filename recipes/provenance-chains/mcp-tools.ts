// Provenance Chains — MCP tool handlers for open-brain-mcp (Supabase Edge Function).
//
// Drop these two tool registrations into your existing open-brain-mcp
// index.ts after the other registerTool() calls. Both tools assume the
// schemas/provenance-chains SQL migration has been applied to your
// Supabase project (adds the derived_from / derivation_* columns and the
// trace_provenance / find_derivatives helper functions).
//
// The snippets below match the canonical Open Brain setup where
// public.thoughts.id is a UUID. If your project has migrated thoughts to a
// BIGINT primary key, swap z.string().uuid() for z.number().int().positive()
// and update the id casts accordingly.
//
// Expected surrounding context (already present in index.ts):
//   - `server`    instance of McpServer
//   - `supabase`  createClient<...>(…, service_role_key)
//   - `z`         imported from "npm:zod@3"
//   - `toolSuccess(msg, data?)` and `toolFailure(msg)` helpers that return
//     the standard MCP tool-result envelope
//
// ---------------------------------------------------------------------------
// Tool 1: trace_provenance
//   Walks derived_from upward and returns the ancestor tree. Answers
//   "show me the atomic thoughts that produced this derived one."
// ---------------------------------------------------------------------------

server.registerTool(
  "trace_provenance",
  {
    title: "Trace Provenance",
    description:
      "Walk a thought's derivation chain upward — show the atomic thoughts that fed this derived thought. Returns a tree. Restricted ancestors are redacted.",
    inputSchema: z.object({
      thought_id: z.string().uuid().describe("UUID of the thought to trace"),
      depth: z.number().int().min(1).max(10).optional()
        .describe("Max ancestor levels to walk (default 3, max 10)"),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const rootId = String(raw.thought_id ?? "").trim();
      const maxDepth = Math.min(Math.max(1, Number(raw.depth ?? 3) || 3), 10);
      const NODE_CAP = 250;

      if (!rootId) return toolFailure("thought_id is required");

      // Call the SQL helper. It returns a flat rowset, each row is one
      // visited thought with its depth, parent_id, and cycle flag.
      const { data, error } = await supabase.rpc("trace_provenance", {
        p_thought_id: rootId,
        p_max_depth: maxDepth,
        p_node_cap: NODE_CAP,
      });

      if (error) {
        return toolFailure(`trace_provenance failed: ${error.message}`);
      }

      type TraceRow = {
        thought_id: string;
        depth: number;
        parent_id: string | null;
        content: string | null;
        type: string | null;
        source_type: string | null;
        derivation_method: string | null;
        derivation_layer: string | null;
        sensitivity_tier: string | null;
        created_at: string;
        cycle: boolean;
        restricted: boolean;
      };

      const rows = (data ?? []) as TraceRow[];

      // Build an in-memory tree rooted at rootId. Each node has
      // { thought, parents: node[] }, keyed by thought_id for de-dup.
      type Node = {
        thought_id: string;
        depth: number;
        cycle: boolean;
        restricted: boolean;
        type: string | null;
        source_type: string | null;
        derivation_method: string | null;
        derivation_layer: string | null;
        created_at: string;
        content_preview: string | null;
        parents: Node[];
      };

      const nodeById = new Map<string, Node>();
      for (const r of rows) {
        if (!nodeById.has(r.thought_id)) {
          nodeById.set(r.thought_id, {
            thought_id: r.thought_id,
            depth: r.depth,
            cycle: r.cycle,
            restricted: r.restricted,
            type: r.type,
            source_type: r.source_type,
            derivation_method: r.derivation_method,
            derivation_layer: r.derivation_layer,
            created_at: r.created_at,
            // SQL already redacts restricted content to NULL; truncate rest.
            content_preview: r.content ? r.content.slice(0, 200) : null,
            parents: [],
          });
        }
      }
      for (const r of rows) {
        if (!r.parent_id) continue;
        const parent = nodeById.get(r.thought_id);
        const child = nodeById.get(r.parent_id);
        if (parent && child && !child.parents.some((p) => p.thought_id === parent.thought_id)) {
          child.parents.push(parent);
        }
      }

      const root = nodeById.get(rootId);
      if (!root) {
        return toolFailure(`Thought ${rootId} not found`);
      }

      const nodeCount = nodeById.size;
      const truncated = nodeCount >= NODE_CAP;
      const summary =
        `Traced provenance of ${rootId} (depth=${maxDepth}, ${nodeCount} nodes visited` +
        (truncated ? `, truncated at node_cap=${NODE_CAP}` : "") +
        `).`;

      return toolSuccess(summary, {
        tree: root,
        node_count: nodeCount,
        depth_limit: maxDepth,
        node_cap: NODE_CAP,
        truncated,
      });
    } catch (error) {
      console.error("trace_provenance failed", error);
      return toolFailure(String(error));
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 2: find_derivatives
//   Single-level reverse lookup — "what downstream thoughts cite this one?"
// ---------------------------------------------------------------------------

server.registerTool(
  "find_derivatives",
  {
    title: "Find Derivatives",
    description:
      "Find all thoughts that were derived from this one (single-level reverse lookup). Answers 'what uses this thought?'",
    inputSchema: z.object({
      thought_id: z.string().uuid().describe("UUID of the thought whose derivatives to find"),
      limit: z.number().int().min(1).max(500).optional()
        .describe("Max rows to return (default 100, max 500)"),
      exclude_restricted: z.boolean().optional()
        .describe("If true (default), restricted-tier derivatives are filtered out"),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const id = String(raw.thought_id ?? "").trim();
      const limit = Math.min(Math.max(1, Number(raw.limit ?? 100) || 100), 500);
      const excludeRestricted = raw.exclude_restricted === undefined
        ? true
        : Boolean(raw.exclude_restricted);

      if (!id) return toolFailure("thought_id is required");

      const { data, error } = await supabase.rpc("find_derivatives", {
        p_thought_id: id,
        p_limit: limit,
        p_exclude_restricted: excludeRestricted,
      });

      if (error) {
        return toolFailure(`find_derivatives failed: ${error.message}`);
      }

      type DerivativeRow = {
        id: string;
        content: string | null;
        type: string | null;
        source_type: string | null;
        derivation_method: string | null;
        derivation_layer: string | null;
        sensitivity_tier: string | null;
        created_at: string;
      };

      const rows = (data ?? []) as DerivativeRow[];

      const summary = rows.length === 0
        ? `No derivatives found for ${id}.`
        : `Found ${rows.length} derivative(s) of ${id}:\n` +
          rows.slice(0, 10).map((r) =>
            `  ${r.id} [${r.source_type ?? "?"}] ${String(r.content ?? "").slice(0, 100)}`
          ).join("\n");

      return toolSuccess(summary, {
        derivatives: rows,
        count: rows.length,
        exclude_restricted: excludeRestricted,
      });
    } catch (error) {
      console.error("find_derivatives failed", error);
      return toolFailure(String(error));
    }
  },
);
