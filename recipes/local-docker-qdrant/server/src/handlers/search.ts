import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getEmbedding } from "../bedrock.js";
import { searchPoints } from "../qdrant.js";
import type { QdrantFilter } from "../qdrant.js";
import { buildAclFilter } from "../acl.js";
import type { Identity } from "../identity.js";

export function registerSearchHandler(server: McpServer, identity: Identity): void {
  server.registerTool(
    "search_thoughts",
    {
      title: "Search Thoughts",
      description:
        "Search captured thoughts by meaning. Use this when the user asks about a topic, person, or idea they've previously captured.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().describe("What to search for"),
        limit: z.number().optional().default(10),
        threshold: z.number().optional().default(0.25),
        scope: z
          .enum(["private", "shared", "all"])
          .optional()
          .default("all")
          .describe(
            "Filter by visibility: 'private' (mine only), 'shared' (shared thoughts only), 'all' (both)"
          ),
      },
    },
    async ({ query, limit, threshold, scope }) => {
      try {
        const vector = await getEmbedding(query);

        let filter: QdrantFilter;

        if (scope === "private") {
          filter = buildAclFilter(identity, {
            must: [
              { key: "visibility", match: { value: "private" } },
              { key: "owner_id", match: { value: identity.owner_id } },
            ],
          });
        } else if (scope === "shared") {
          filter = buildAclFilter(identity, {
            must: [{ key: "visibility", match: { value: "shared" } }],
          });
        } else {
          // scope === "all"
          filter = buildAclFilter(identity);
        }

        const hits = await searchPoints({
          vector,
          filter,
          limit: limit ?? 10,
          score_threshold: threshold ?? 0.25,
        });

        if (hits.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No thoughts found matching "${query}".`,
              },
            ],
          };
        }

        const formatted = hits.map((hit, index) => {
          const p = hit.payload;
          const date = p["captured_at"]
            ? new Date(p["captured_at"] as string).toLocaleDateString()
            : "Unknown";
          const type = (p["type"] as string) ?? "unknown";
          const topics = Array.isArray(p["topics"])
            ? (p["topics"] as string[]).join(", ")
            : (p["topics"] as string) ?? "";
          const people = Array.isArray(p["people"])
            ? (p["people"] as string[]).join(", ")
            : typeof p["people"] === "string"
            ? p["people"]
            : null;
          const actions = Array.isArray(p["actions"])
            ? (p["actions"] as string[]).join(", ")
            : typeof p["actions"] === "string"
            ? p["actions"]
            : null;
          const content = (p["content"] as string) ?? "";
          const scorePercent = (hit.score * 100).toFixed(1);

          const lines = [
            `--- Result ${index + 1} (${scorePercent}% match) ---`,
            `Captured: ${date}`,
            `Type: ${type}`,
            `Topics: ${topics}`,
          ];
          if (people) lines.push(`People: ${people}`);
          if (actions) lines.push(`Actions: ${actions}`);
          lines.push("", content);

          return lines.join("\n");
        });

        return {
          content: [
            {
              type: "text",
              text: `Found ${hits.length} thought(s):\n\n${formatted.join("\n\n")}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Search failed: ${message}`,
            },
          ],
        };
      }
    }
  );
}
