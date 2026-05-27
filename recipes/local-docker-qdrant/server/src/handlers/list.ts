import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scrollPoints } from "../qdrant.js";
import type { QdrantFilter } from "../qdrant.js";
import { buildAclFilter } from "../acl.js";
import type { Identity } from "../identity.js";

export function registerListHandler(server: McpServer, identity: Identity): void {
  server.registerTool(
    "list_thoughts",
    {
      title: "List Recent Thoughts",
      description:
        "List recently captured thoughts with optional filters by type, topic, person, or time range.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        limit: z.number().optional().default(10),
        type: z
          .string()
          .optional()
          .describe("Filter by type: observation, task, idea, reference, person_note"),
        topic: z.string().optional().describe("Filter by topic tag"),
        person: z.string().optional().describe("Filter by person mentioned"),
        days: z.number().optional().describe("Only thoughts from the last N days"),
      },
    },
    async ({ limit, type, topic, person, days }) => {
      try {
        const conditions: unknown[] = [];

        if (type) {
          conditions.push({ key: "type", match: { value: type } });
        }
        if (topic) {
          // topics is a keyword-indexed array; match targets individual elements
          conditions.push({ key: "topics", match: { value: topic } });
        }
        if (person) {
          conditions.push({ key: "people", match: { value: person } });
        }
        if (days) {
          const since = new Date(Date.now() - days * 86400000).toISOString();
          conditions.push({ key: "created_at", range: { gte: since } });
        }

        const userFilter: QdrantFilter | undefined = conditions.length
          ? { must: conditions }
          : undefined;

        // ACL is the single enforcement point — always called, never skipped
        const filter = buildAclFilter(identity, userFilter);

        const points = await scrollPoints({
          filter,
          limit: limit ?? 10,
          order_by: { key: "created_at", direction: "desc" },
        });

        if (points.length === 0) {
          return { content: [{ type: "text", text: "No thoughts found." }] };
        }

        const lines = points.map((point, i) => {
          const p = point.payload;
          const date =
            typeof p.created_at === "string"
              ? p.created_at.slice(0, 10)
              : String(p.created_at ?? "");
          const pointType = typeof p.type === "string" ? p.type : "";
          const topics = Array.isArray(p.topics)
            ? (p.topics as string[]).filter((t) => typeof t === "string")
            : [];
          const content = typeof p.content === "string" ? p.content : String(p.content ?? "");
          const topicSuffix = topics.length ? " - " + topics.join(", ") : "";
          return `${i + 1}. [${date}] (${pointType}${topicSuffix})\n   ${content}`;
        });

        return { content: [{ type: "text", text: lines.join("\n\n") }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error listing thoughts: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
