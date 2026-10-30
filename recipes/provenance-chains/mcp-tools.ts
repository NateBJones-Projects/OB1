// Provenance Chains — MCP tool handlers for open-brain-mcp (Supabase Edge Function).
//
// Drop these three tool registrations into your existing open-brain-mcp
// index.ts after the other registerTool() calls. All three assume the
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
//   - `server`          instance of McpServer
//   - `supabase`        createClient<...>(…, service_role_key)
//   - `z`               imported from "npm:zod@3"
//   - `getEmbedding`    (Tool 3 only) canonical index.ts helper — text → vector
//   - `extractMetadata` (Tool 3 only) canonical index.ts helper — text → metadata
//
// Tool 3 (capture_derived_thought) is a WRITE tool and is deliberately a
// SEPARATE tool from the canonical `capture_thought`, so the everyday
// capture hot path used by every connected client is left untouched. Use
// it only when saving an artifact derived from other thoughts.
//
// Return envelopes are inlined as the literal
//   { content: [{ type: "text", text: JSON.stringify(...) }] }
// shape that the canonical server/index.ts uses — no toolSuccess /
// toolFailure helper is required. Errors set `isError: true` on the
// envelope and put a plain-text explanation in the content block so
// Claude Desktop can render the failure inline.
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

      if (!rootId) {
        return {
          content: [{ type: "text", text: "thought_id is required" }],
          isError: true,
        };
      }

      // Call the SQL helper. It returns a flat rowset, each row is one
      // visited thought with its depth, parent_id, and cycle flag.
      //
      // Over-fetch by one row so we can detect truncation exactly: if the
      // SQL helper returns NODE_CAP + 1 rows, the traversal actually hit
      // the cap; if it returns NODE_CAP or fewer, nothing was cut off. The
      // +1 row is dropped before tree building so the emitted tree and
      // node_count stay bounded at NODE_CAP.
      const { data, error } = await supabase.rpc("trace_provenance", {
        p_thought_id: rootId,
        p_max_depth: maxDepth,
        p_node_cap: NODE_CAP + 1,
      });

      if (error) {
        return {
          content: [{
            type: "text",
            text: `trace_provenance failed: ${error.message}`,
          }],
          isError: true,
        };
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

      const rawRows = (data ?? []) as TraceRow[];

      // Detect truncation exactly via over-fetch-by-one. If SQL returned
      // NODE_CAP + 1 rows the traversal hit the cap; drop the extra row
      // before tree building so node_count and the emitted tree stay
      // bounded at NODE_CAP. A return of exactly NODE_CAP rows means the
      // whole graph fits without truncation.
      const truncated = rawRows.length > NODE_CAP;
      const rows = truncated ? rawRows.slice(0, NODE_CAP) : rawRows;

      // Build an in-memory tree rooted at rootId. Each node is a FRESH
      // object per traversal path (no dedupe). Cycles are detected via an
      // ancestor-path Set — when the path-to-root already contains the
      // current thought id, we emit a stub { thought_id, cycle: true } and
      // stop recursion. This is what breaks the JS object cycle and keeps
      // JSON.stringify safe; it also matches the README's advertised
      // `cycle: true` flag semantics.
      //
      // Why per-path (not global) visited: the same thought can legitimately
      // appear in multiple distinct subtrees of a DAG without it being a
      // cycle. Only an ancestor of itself is a cycle.
      type Node = {
        thought_id: string;
        depth?: number;
        cycle?: boolean;
        restricted?: boolean;
        type?: string | null;
        source_type?: string | null;
        derivation_method?: string | null;
        derivation_layer?: string | null;
        created_at?: string;
        content_preview?: string | null;
        parents?: Node[];
      };

      // Index rows by child -> list of parent ROWS (not just ids) so we can
      // walk upward with per-edge depth/metadata.
      //
      // SQL contract (schema.sql recursive CTE):
      //   - anchor row: thought_id = root, parent_id = NULL
      //   - step row:   thought_id = parent.id (the upstream node we just
      //                 reached), parent_id = w.thought_id (the downstream
      //                 node we walked from)
      //
      // So each step row encodes the edge "parent_id (child) ← thought_id
      // (parent)". To build child→parents we index by r.parent_id (the
      // child) and push the FULL row for the parent (the naming is counter-
      // intuitive but matches schema.sql:185,187 exactly).
      //
      // Why full rows per edge (not canonical-by-thought_id): in a DAG a
      // shared ancestor can legitimately appear at different depths on
      // different paths (e.g. root←A and root←B←A — the A reached via B
      // is at depth 2, not A's direct depth of 1). Storing the edge's own
      // row preserves per-path depth instead of collapsing to the first
      // occurrence.
      const anchorRow = rows.find((r) => r.thought_id === rootId && r.parent_id === null);
      const parentRowsByChild = new Map<string, TraceRow[]>();
      for (const r of rows) {
        if (r.parent_id) {
          // r.parent_id is the CHILD (downstream) in this edge.
          // r.thought_id is the PARENT (upstream) in this edge.
          const arr = parentRowsByChild.get(r.parent_id) ?? [];
          arr.push(r);
          parentRowsByChild.set(r.parent_id, arr);
        }
      }

      if (!anchorRow) {
        return {
          content: [{ type: "text", text: `Thought ${rootId} not found` }],
          isError: true,
        };
      }

      // buildFromRow takes a specific row so depth/metadata come from THAT
      // edge, not from a canonical-by-id lookup. The root case uses the
      // anchor row (depth 0, parent_id NULL).
      function buildFromRow(r: TraceRow, ancestors: Set<string>): Node {
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(r.thought_id);
        const parentRows = parentRowsByChild.get(r.thought_id) ?? [];
        const parents = parentRows.map((pr) => {
          // Ancestor-path cycle: emit a stub that references the thought but
          // does NOT recurse. This is the only place we produce
          // `{ thought_id, cycle: true }` without other fields — downstream
          // consumers and tests can distinguish stubs from fully-hydrated
          // nodes by the absence of `parents`.
          if (nextAncestors.has(pr.thought_id)) {
            return { thought_id: pr.thought_id, cycle: true } as Node;
          }
          return buildFromRow(pr, nextAncestors);
        });
        return {
          thought_id: r.thought_id,
          depth: r.depth,
          // SQL-reported cycle flag is also preserved — it may be true on
          // the row even when the ancestor-path check doesn't fire (e.g.,
          // the SQL helper detected the cycle and stopped recursion before
          // we did).
          cycle: r.cycle,
          restricted: r.restricted,
          type: r.type,
          source_type: r.source_type,
          derivation_method: r.derivation_method,
          derivation_layer: r.derivation_layer,
          created_at: r.created_at,
          // SQL already redacts restricted content to NULL; truncate rest.
          content_preview: r.content ? r.content.slice(0, 200) : null,
          parents,
        };
      }

      const root = buildFromRow(anchorRow, new Set<string>());

      // node_count reports row occurrences (post-slice), not unique ids,
      // so capped DAG traversals report correctly. truncated was computed
      // above via over-fetch-by-one and is exact: it is only true when the
      // SQL helper actually returned more than NODE_CAP rows.
      const nodeCount = rows.length;
      const summary =
        `Traced provenance of ${rootId} (depth=${maxDepth}, ${nodeCount} nodes visited` +
        (truncated ? `, truncated at node_cap=${NODE_CAP}` : "") +
        `).`;

      // Return the summary line plus the full tree as pretty JSON in the
      // same text block. Claude Desktop renders this cleanly and the
      // caller can re-parse the JSON if needed.
      //
      // Belt-and-suspenders: wrap JSON.stringify in try/catch. The fresh-
      // objects + ancestor-path check above should make cycles impossible,
      // but if some future edit reintroduces a shared reference we'd
      // rather return a structured error than blow up the tool.
      let payloadText: string;
      try {
        payloadText = JSON.stringify({
          tree: root,
          node_count: nodeCount,
          depth_limit: maxDepth,
          node_cap: NODE_CAP,
          truncated,
        }, null, 2);
      } catch (stringifyErr) {
        console.error("trace_provenance: JSON.stringify failed", stringifyErr);
        return {
          content: [{
            type: "text",
            text:
              `trace_provenance: failed to serialize tree for ${rootId} ` +
              `(${String(stringifyErr)}). This usually means the provenance ` +
              `graph contains a cycle that the cycle detector missed. ` +
              `Re-run with a smaller depth or file a bug.`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: "text",
          text: `${summary}\n\n${payloadText}`,
        }],
      };
    } catch (error) {
      console.error("trace_provenance failed", error);
      return {
        content: [{ type: "text", text: String(error) }],
        isError: true,
      };
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
      "Find all thoughts that were derived from this one (single-level reverse lookup). Answers 'what uses this thought?'. Restricted-tier derivatives are always hidden — there is no caller-visible override.",
    inputSchema: z.object({
      thought_id: z.string().uuid().describe("UUID of the thought whose derivatives to find"),
      limit: z.number().int().min(1).max(500).optional()
        .describe("Max rows to return (default 100, max 500)"),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const id = String(raw.thought_id ?? "").trim();
      const limit = Math.min(Math.max(1, Number(raw.limit ?? 100) || 100), 500);

      if (!id) {
        return {
          content: [{ type: "text", text: "thought_id is required" }],
          isError: true,
        };
      }

      // The RPC hardcodes restricted-row filtering at the SQL layer (see
      // schemas/provenance-chains/schema.sql). There is no parameter to
      // pass through — callers that want restricted rows need a separate
      // service-role-only admin path, which is out of scope here.
      const { data, error } = await supabase.rpc("find_derivatives", {
        p_thought_id: id,
        p_limit: limit,
      });

      if (error) {
        return {
          content: [{
            type: "text",
            text: `find_derivatives failed: ${error.message}`,
          }],
          isError: true,
        };
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

      return {
        content: [{
          type: "text",
          text: `${summary}\n\n${JSON.stringify({
            derivatives: rows,
            count: rows.length,
          }, null, 2)}`,
        }],
      };
    } catch (error) {
      console.error("find_derivatives failed", error);
      return {
        content: [{ type: "text", text: String(error) }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 3: capture_derived_thought
//   WRITE tool. Saves a synthesized/derived artifact (digest, wiki, summary)
//   together with its provenance — the parent thoughts it was built from —
//   so the derivation graph is populated at capture time instead of only by
//   the recipe's one-time backfill.mjs.
//
//   Deliberately a SEPARATE tool from the canonical `capture_thought`
//   (Option B): the everyday capture path used by every connected client is
//   never touched, so a bug here can only affect callers that opt into
//   provenance.
//
//   The 3-step write path mirrors canonical capture_thought because
//   upsert_thought writes only content/content_fingerprint/metadata and
//   MERGES metadata on a fingerprint conflict — it never touches the
//   top-level derived_from / derivation_* columns:
//     1. embed + extract metadata, folding a `provenance` mirror INTO
//        metadata so it rides through upsert_thought and survives the
//        conflict-time `metadata || EXCLUDED.metadata` merge on re-capture;
//     2. upsert_thought(content, { metadata }) -> id;
//     3. a single UPDATE writes the embedding AND the top-level provenance
//        columns that upsert_thought ignored.
// ---------------------------------------------------------------------------

server.registerTool(
  "capture_derived_thought",
  {
    title: "Capture Derived Thought",
    description:
      "Save a synthesized/derived artifact (digest, wiki, research summary, report) to Open Brain WITH its provenance. Use this instead of capture_thought ONLY when the thing you are saving was derived from other thoughts already in the brain. Records the parent thought IDs so 'why do I believe this?' and 'what uses this?' stay answerable.",
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: z.object({
      content: z.string().describe(
        "The derived artifact text — a clear, standalone statement that will make sense when retrieved later"),
      derived_from: z.array(z.string()).optional().describe(
        "Parent thought IDs this artifact was synthesized from. UUID strings only; non-UUID refs (e.g. legacy #412) are moved to metadata.provenance.unresolved_refs rather than rejected"),
      derivation_layer: z.enum(["primary", "derived"]).optional().describe(
        "'derived' for a synthesized artifact (default when derived_from is provided). The DB CHECK allows only these two values"),
      derivation_method: z.enum(["synthesis"]).optional().describe(
        "How it was produced. 'synthesis' is the only value a stock install accepts; defaults to 'synthesis' when derived_from is provided"),
      supersedes: z.string().uuid().optional().describe(
        "UUID of a prior thought this one replaces (e.g. a regenerated digest replacing yesterday's)"),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const content = String(raw.content ?? "").trim();
      if (!content) {
        return {
          content: [{ type: "text", text: "content is required" }],
          isError: true,
        };
      }

      // Partition derived_from into valid UUID parents vs. unresolved refs.
      // We accept z.array(z.string()) (not z.array(z.string().uuid())) on
      // purpose: a single legacy ref like "#412" must NOT reject the whole
      // capture. Valid UUIDs go into the derived_from column; everything else
      // is preserved under metadata.provenance.unresolved_refs so the loss is
      // visible instead of silently poisoning the array (trace_provenance
      // casts each element ::uuid and would raise 22P02 on a non-UUID).
      const UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const rawRefs = Array.isArray(raw.derived_from)
        ? (raw.derived_from as unknown[]).map((r) => String(r).trim())
        : [];
      const derivedFrom = rawRefs.filter((r) => UUID_RE.test(r));
      const unresolvedRefs = rawRefs.filter((r) => !UUID_RE.test(r));

      // Defaults: when parents are present but layer/method were omitted, fill
      // in the CHECK-valid values so the caller doesn't have to. z.enum already
      // guarantees any PROVIDED value is legal, so no clamping is needed.
      const layer =
        (raw.derivation_layer as string | undefined) ??
        (derivedFrom.length > 0 ? "derived" : undefined);
      const method =
        (raw.derivation_method as string | undefined) ??
        (derivedFrom.length > 0 ? "synthesis" : undefined);
      const supersedes = raw.supersedes as string | undefined;

      const hasProvenance =
        derivedFrom.length > 0 ||
        unresolvedRefs.length > 0 ||
        layer !== undefined ||
        method !== undefined ||
        supersedes !== undefined;

      // Step 1: embed + extract metadata, folding in the provenance mirror.
      // The mirror lives inside metadata so it survives upsert_thought's
      // conflict-time `metadata || EXCLUDED.metadata` merge: a later stock
      // capture of identical content won't drop it.
      const [embedding, extracted] = await Promise.all([
        getEmbedding(content),
        extractMetadata(content),
      ]);
      const metadata: Record<string, unknown> = { ...extracted, source: "mcp" };
      if (hasProvenance) {
        metadata.provenance = {
          ...(derivedFrom.length ? { derived_from: derivedFrom } : {}),
          ...(layer ? { derivation_layer: layer } : {}),
          ...(method ? { derivation_method: method } : {}),
          ...(supersedes ? { supersedes } : {}),
          ...(unresolvedRefs.length ? { unresolved_refs: unresolvedRefs } : {}),
        };
      }

      // Step 2: upsert content + metadata. upsert_thought returns the row id
      // and, on a fingerprint conflict, merges the incoming metadata.
      const { data: upsertResult, error: upsertError } = await supabase.rpc(
        "upsert_thought",
        { p_content: content, p_payload: { metadata } },
      );
      if (upsertError) {
        return {
          content: [{ type: "text", text: `Failed to capture: ${upsertError.message}` }],
          isError: true,
        };
      }
      const thoughtId = (upsertResult as { id?: string } | null)?.id;
      if (!thoughtId) {
        return {
          content: [{ type: "text", text: "upsert_thought returned no id" }],
          isError: true,
        };
      }

      // Step 3: one UPDATE for the embedding AND the top-level provenance
      // columns upsert_thought ignored. On a re-capture this overwrites the
      // columns with the new values, which is intended.
      const patch: Record<string, unknown> = { embedding };
      if (derivedFrom.length) patch.derived_from = derivedFrom;
      if (layer) patch.derivation_layer = layer;
      if (method) patch.derivation_method = method;
      if (supersedes) patch.supersedes = supersedes;

      const { error: patchError } = await supabase
        .from("thoughts")
        .update(patch)
        .eq("id", thoughtId);
      if (patchError) {
        // The thought IS saved; only the provenance/embedding write failed.
        // Surface it explicitly rather than pretending success.
        return {
          content: [{
            type: "text",
            text:
              `Captured thought ${thoughtId}, but failed to write provenance/embedding: ` +
              `${patchError.message}`,
          }],
          isError: true,
        };
      }

      // Confirmation.
      const parts = [`Captured derived thought ${thoughtId}`];
      if (derivedFrom.length) parts.push(`from ${derivedFrom.length} parent(s)`);
      if (layer) parts.push(`[layer=${layer}${method ? `, method=${method}` : ""}]`);
      if (supersedes) parts.push(`supersedes ${supersedes}`);
      if (unresolvedRefs.length) {
        parts.push(
          `— ${unresolvedRefs.length} non-UUID ref(s) moved to ` +
          `metadata.provenance.unresolved_refs: ${unresolvedRefs.join(", ")}`);
      }
      return { content: [{ type: "text", text: parts.join(" ") }] };
    } catch (error) {
      console.error("capture_derived_thought failed", error);
      return {
        content: [{ type: "text", text: String(error) }],
        isError: true,
      };
    }
  },
);
