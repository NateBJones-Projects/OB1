import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { countPoints, scrollPoints } from "../qdrant.js";
import type { QdrantFilter } from "../qdrant.js";
import { buildAclFilter } from "../acl.js";
import type { Identity } from "../identity.js";

export function registerStatsHandler(server: McpServer, identity: Identity): void {
  server.registerTool(
    "thought_stats",
    {
      title: "Thought Statistics",
      description:
        "Get a summary of all captured thoughts: totals, types, top topics, and people.",
      annotations: { readOnlyHint: true },
      inputSchema: {},
    },
    async () => {
      try {
        const baseFilter = buildAclFilter(identity);

        // Total count
        const total = await countPoints(baseFilter);

        // Count by type — run in parallel
        const typeNames = [
          "observation",
          "task",
          "idea",
          "reference",
          "person_note",
        ] as const;

        const typeCounts = await Promise.all(
          typeNames.map((typeName) =>
            countPoints(
              buildAclFilter(identity, {
                must: [{ key: "type", match: { value: typeName } }],
              })
            )
          )
        );

        // Scroll up to 1000 points for client-side topic/people aggregation
        // Note: topic/people aggregation is client-side; accurate up to 1000 most recent thoughts
        const sample = await scrollPoints({
          filter: baseFilter,
          limit: 1000,
        });

        // Aggregate topics
        const topicFreq: Record<string, number> = {};
        for (const point of sample) {
          const topics = point.payload.topics;
          if (Array.isArray(topics)) {
            for (const topic of topics) {
              if (typeof topic === "string") {
                topicFreq[topic] = (topicFreq[topic] ?? 0) + 1;
              }
            }
          }
        }

        // Aggregate people
        const peopleFreq: Record<string, number> = {};
        for (const point of sample) {
          const people = point.payload.people;
          if (Array.isArray(people)) {
            for (const person of people) {
              if (typeof person === "string") {
                peopleFreq[person] = (peopleFreq[person] ?? 0) + 1;
              }
            }
          }
        }

        // Date range — oldest is last element of sample, newest is first
        const newestDate =
          sample.length > 0
            ? String(sample[0].payload.created_at ?? "unknown")
            : "unknown";
        const oldestDate =
          sample.length > 0
            ? String(sample[sample.length - 1].payload.created_at ?? "unknown")
            : "unknown";

        // Sort topics and people by frequency descending, take top 10
        const topTopics = Object.entries(topicFreq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);

        const topPeople = Object.entries(peopleFreq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);

        // Build output
        const lines: string[] = [];

        lines.push(`Total thoughts: ${total}`);
        lines.push(`Date range: ${oldestDate} → ${newestDate}`);
        lines.push("");
        lines.push("Types:");
        for (let i = 0; i < typeNames.length; i++) {
          lines.push(`  ${typeNames[i]}: ${typeCounts[i]}`);
        }

        if (topTopics.length > 0) {
          lines.push("");
          lines.push("Top topics:");
          for (const [topic, count] of topTopics) {
            lines.push(`  ${topic}: ${count}`);
          }
        }

        if (topPeople.length > 0) {
          lines.push("");
          lines.push("People mentioned:");
          for (const [person, count] of topPeople) {
            lines.push(`  ${person}: ${count}`);
          }
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error retrieving stats: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
