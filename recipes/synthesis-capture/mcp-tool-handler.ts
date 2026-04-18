/**
 * capture_synthesis — MCP tool handler for Open Brain
 *
 * Paste this inside your open-brain-mcp Edge Function's server setup, next to
 * the existing `capture_thought` registerTool call (see OB1's server/index.ts).
 *
 * What it does
 * ------------
 * Lets an AI client save its own synthesis of multiple source thoughts as a
 * NEW thought, with `derived_from` pointing back to every source ID. The
 * "Query-as-Ingest" pattern: once a complex question has been answered by
 * combining atomic thoughts, the answer becomes reusable knowledge instead of
 * something the model has to re-derive every time.
 *
 * Requirements
 * ------------
 * This handler writes to three provenance columns on `public.thoughts`:
 *   - derivation_layer  (text: 'primary' | 'derived')
 *   - derivation_method (text: 'synthesis')
 *   - derived_from      (jsonb: array of parent thought IDs)
 *
 * Those columns are added by the `provenance-chains` recipe's schema
 * migration. This recipe will NOT work without that migration applied.
 *
 * Safety rules enforced here
 * --------------------------
 *  1. At least 3 source thought IDs required (Zod `.min(3)`).
 *  2. All source IDs must resolve to existing rows in `public.thoughts`.
 *  3. At least one source must have `derivation_layer = 'primary'` — forbids
 *     pure synthesis-of-synthesis chains that would compound noise.
 *  4. Rejects sources that are themselves `source_type = 'synthesis'` so the
 *     system cannot loop on its own derived output.
 *
 * Assumes in scope
 * ----------------
 *   - `server`    : your McpServer instance (from @modelcontextprotocol/sdk)
 *   - `supabase`  : your Supabase service-role client
 *   - `z`         : zod
 *   - `getEmbedding(text)`   : your existing embedding helper (OB1 default)
 *   - `extractMetadata(text)`: your existing metadata helper (OB1 default)
 *
 * If your `open-brain-mcp` already wraps these differently, adapt the two
 * helper calls below — the rest of the logic is independent.
 */

server.registerTool(
  "capture_synthesis",
  {
    title: "Capture Synthesis",
    description:
      "Capture a derived-synthesis thought from 3+ source thoughts (Query-as-Ingest). At least one source must be a primary (atomic) thought. No source may already be a synthesis. Use this after answering a complex question so the answer itself becomes reusable knowledge with provenance back to the sources.",
    inputSchema: {
      // Size cap rationale: 50KB of UTF-8 covers a very long synthesis
      // (~10k words) without leaving the endpoint wide open for DoS or
      // accidental prompt-injection payload floods. Adjust upward only if
      // you actually need longer syntheses — the embedding and DB write
      // costs scale with content length.
      content: z
        .string()
        .min(1)
        .max(50_000, "content must be 50KB or less")
        .describe("The synthesized answer/prose to save as a new thought (max 50KB)."),
      // Accepts numeric IDs (BIGINT installs) or string IDs (UUID installs).
      // The handler below treats IDs as opaque and only compares by equality.
      // Cap at 50 to keep the `.in("id", ...)` query plan sane — a real
      // synthesis rarely cites more than a dozen sources.
      source_thought_ids: z
        .array(z.union([z.number().int().positive(), z.string().min(1)]))
        .min(3)
        .max(50, "source_thought_ids must be 50 or fewer items")
        .describe("Parent thought IDs the synthesis was derived from (minimum 3, maximum 50). Accepts integers or UUID strings depending on your thoughts.id type."),
      question: z
        .string()
        .max(2_000, "question must be 2000 chars or less")
        .optional()
        .describe("Optional: the original question that prompted the synthesis."),
      topics: z.array(z.string().max(200)).max(20).optional(),
      tags: z.array(z.string().max(200)).max(20).optional(),
    },
  },
  async ({ content, source_thought_ids, question, topics, tags }) => {
    try {
      const trimmed = String(content ?? "").trim();
      if (!trimmed) {
        return {
          content: [{ type: "text" as const, text: "Error: content is required" }],
          isError: true,
        };
      }

      // De-dupe IDs before we hit the database — callers sometimes repeat.
      const sourceIds = Array.from(new Set(source_thought_ids));
      if (sourceIds.length < 3) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: source_thought_ids must include at least 3 distinct IDs",
            },
          ],
          isError: true,
        };
      }

      // ── Safety check 1: all sources must exist ──────────────────────────
      const { data: parents, error: parentsError } = await supabase
        .from("thoughts")
        .select("id, derivation_layer, source_type")
        .in("id", sourceIds);

      if (parentsError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: parent lookup failed: ${parentsError.message}`,
            },
          ],
          isError: true,
        };
      }

      // `id` is typed broadly because OB1 installs vary — the stock base
      // schema in docs/01-getting-started.md uses UUID, while the enhanced /
      // provenance-chains variants may use BIGINT. Both compare via Set.has()
      // on the original value, so either shape works here.
      const parentRows = (parents ?? []) as Array<{
        id: number | string;
        derivation_layer: string | null;
        source_type: string | null;
      }>;
      const foundIds = new Set(parentRows.map((p) => p.id));
      const missing = sourceIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: parent thoughts not found: ${missing.join(", ")}`,
            },
          ],
          isError: true,
        };
      }

      // ── Safety check 2: reject synthesis-of-synthesis ───────────────────
      const synthSources = parentRows.filter((p) => p.source_type === "synthesis");
      if (synthSources.length > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "Error: source thoughts [" +
                synthSources.map((p) => p.id).join(", ") +
                "] are themselves syntheses. Synthesis-of-synthesis is forbidden — pick primary (atomic) thoughts instead.",
            },
          ],
          isError: true,
        };
      }

      // ── Safety check 3: at least one primary parent ─────────────────────
      const anyPrimary = parentRows.some((p) => p.derivation_layer === "primary");
      if (!anyPrimary) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "Error: all source thoughts are derived; at least one must be a primary (atomic) thought to prevent self-referential synthesis chains.",
            },
          ],
          isError: true,
        };
      }

      // ── Build the synthesis row ─────────────────────────────────────────
      // We reuse the OB1 pattern from capture_thought: embedding + metadata in
      // parallel, upsert_thought RPC, then patch embedding.
      const [embedding, autoMetadata] = await Promise.all([
        getEmbedding(trimmed),
        extractMetadata(trimmed),
      ]);

      const mergedMetadata: Record<string, unknown> = {
        ...(autoMetadata as Record<string, unknown>),
        source: "mcp_synthesis",
      };
      if (question) mergedMetadata.question = String(question);
      if (Array.isArray(topics) && topics.length > 0) {
        mergedMetadata.topics = topics;
      }
      if (Array.isArray(tags) && tags.length > 0) {
        mergedMetadata.tags = tags;
      }

      const { data: upsertResult, error: upsertError } = await supabase.rpc(
        "upsert_thought",
        {
          p_content: trimmed,
          p_payload: {
            source_type: "synthesis",
            metadata: mergedMetadata,
            derivation_layer: "derived",
            derivation_method: "synthesis",
            derived_from: sourceIds,
          },
        },
      );

      if (upsertError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: synthesis capture failed: ${upsertError.message}`,
            },
          ],
          isError: true,
        };
      }

      const thoughtId = (upsertResult as { id?: number | string } | null)?.id;
      if (!thoughtId) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: upsert_thought returned no thought ID",
            },
          ],
          isError: true,
        };
      }

      // Patch the embedding in a second write to match OB1's existing pattern.
      const { error: embError } = await supabase
        .from("thoughts")
        .update({ embedding })
        .eq("id", thoughtId);

      if (embError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Captured synthesis #${thoughtId} but embedding update failed: ${embError.message}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Captured synthesis #${thoughtId} from ${sourceIds.length} source thoughts. Future queries on this topic can reuse it directly.`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
);
