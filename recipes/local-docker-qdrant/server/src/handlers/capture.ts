import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getEmbedding, extractMetadata } from "../bedrock.js";
import * as qdrant from "../qdrant.js";
import type { Identity } from "../identity.js";

export async function captureThought(
  content: string,
  identity: Identity,
  options: {
    source?: string;
    title?: string;
    url?: string;
    visibility?: "private" | "shared";
  } = {}
): Promise<{ id: string; type: string; topics: string[] }> {
  const [embedding, meta] = await Promise.all([
    getEmbedding(content),
    extractMetadata(content),
  ]);

  const id = crypto.randomUUID();

  await qdrant.upsertPoint({
    id,
    vector: embedding,
    payload: {
      content,
      type: meta.type,
      topics: meta.topics,
      people: meta.people,
      actions: meta.action_items,
      source: options.source ?? "mcp",
      ...(options.title ? { title: options.title } : {}),
      ...(options.url ? { url: options.url } : {}),
      owner_id: identity.owner_id,
      owner_email: identity.owner_email,
      visibility: options.visibility ?? "private",
      shared_with: [],
      created_at: new Date().toISOString(),
    },
  });

  return { id, type: meta.type, topics: meta.topics };
}

export function registerCaptureHandler(server: McpServer, identity: Identity): void {
  server.registerTool(
    "capture_thought",
    {
      title: "Capture Thought",
      description:
        "Save a new thought to the Open Brain. Generates an embedding and extracts metadata automatically.",
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
      },
      inputSchema: {
        content: z
          .string()
          .describe(
            "The thought to capture — a clear, standalone statement that will make sense when retrieved later"
          ),
        visibility: z
          .enum(["private", "shared"])
          .default("private")
          .describe("Who can see this thought"),
      },
    },
    async ({ content, visibility }) => {
      try {
        const result = await captureThought(content, identity, { visibility });
        return {
          content: [
            {
              type: "text" as const,
              text: `Captured as ${result.type} — ${result.topics.join(", ")}`,
            },
          ],
        };
      } catch (err) {
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
    }
  );
}
