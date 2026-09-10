import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { extractMetadata } from "../bedrock.js";
import { scrollPoints, setPayload } from "../qdrant.js";
import { buildOwnerOnlyFilter } from "../acl.js";
import type { Identity } from "../identity.js";

export function registerEnrichHandler(server: McpServer, identity: Identity): void {
  server.registerTool(
    "enrich_thoughts",
    {
      title: "Enrich Untagged Thoughts",
      description: "Run metadata extraction on thoughts that have missing or minimal metadata.",
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      inputSchema: {
        limit: z.number().optional().default(20).describe("Max thoughts to process in one run"),
        ids: z.array(z.string().uuid()).optional().describe(
          "Specific thought IDs to enrich (if omitted, finds minimally-tagged thoughts)"
        ),
      },
    },
    async ({ limit, ids }) => {
      try {
        let processed = 0;
        let skipped = 0;

        const ownerFilter = buildOwnerOnlyFilter(identity);

        if (ids && ids.length > 0) {
          // Fetch all owned thoughts up to a generous limit so we can match against the supplied ids
          const fetchLimit = Math.max(ids.length * 2, 200);
          const points = await scrollPoints({ filter: ownerFilter, limit: fetchLimit });

          // Build lookup map from the scrolled results
          const pointMap = new Map(points.map((p) => [p.id, p]));

          for (const id of ids) {
            const point = pointMap.get(id);

            if (!point) {
              console.warn(`enrich: id ${id} not found or not owned by ${identity.owner_id} — skipping`);
              skipped++;
              continue;
            }

            // Double-check owner_id on the payload
            if (point.payload.owner_id !== identity.owner_id) {
              console.warn(
                `enrich: id ${id} has owner_id ${String(point.payload.owner_id)}, expected ${identity.owner_id} — skipping`
              );
              skipped++;
              continue;
            }

            const content = point.payload.content as string | undefined;
            if (!content) {
              console.warn(`enrich: id ${id} has no content — skipping`);
              skipped++;
              continue;
            }

            const meta = await extractMetadata(content);
            await setPayload(point.id, {
              type: meta.type,
              topics: meta.topics,
              people: meta.people,
              actions: meta.action_items,
            });
            processed++;
          }
        } else {
          // Find minimally-tagged thoughts owned by this user
          const points = await scrollPoints({ filter: ownerFilter, limit });

          const candidates = points.filter((p) => {
            const topics = p.payload.topics;
            const type = p.payload.type;
            const hasTopics =
              Array.isArray(topics) && (topics as unknown[]).length > 0;
            const hasType = typeof type === "string" && type.length > 0;
            return !hasTopics || !hasType;
          });

          for (const point of candidates) {
            // Verify owner_id before any write
            if (point.payload.owner_id !== identity.owner_id) {
              console.warn(
                `enrich: point ${point.id} has unexpected owner_id ${String(point.payload.owner_id)} — skipping`
              );
              skipped++;
              continue;
            }

            const content = point.payload.content as string | undefined;
            if (!content) {
              console.warn(`enrich: point ${point.id} has no content — skipping`);
              skipped++;
              continue;
            }

            const meta = await extractMetadata(content);
            await setPayload(point.id, {
              type: meta.type,
              topics: meta.topics,
              people: meta.people,
              actions: meta.action_items,
            });
            processed++;
          }
        }

        const skippedNote = skipped > 0 ? `, skipped ${skipped}` : "";
        return {
          content: [{ type: "text", text: `Enriched ${processed} thought(s)${skippedNote}.` }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error during enrichment: ${message}` }],
        };
      }
    }
  );
}
