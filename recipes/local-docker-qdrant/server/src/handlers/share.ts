import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getPoint, setPayload } from "../qdrant.js";
import type { Identity } from "../identity.js";

export function registerShareHandler(server: McpServer, identity: Identity): void {
  server.registerTool(
    "share_thought",
    {
      title: "Share Thought",
      description:
        "Change the visibility of a thought you own. Set to 'shared' to make it visible to all users, or 'private' to restrict it to yourself.",
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      inputSchema: {
        thought_id: z.string().uuid().describe("UUID of the thought to update"),
        visibility: z.enum(["private", "shared"]).describe("New visibility setting"),
      },
    },
    async ({ thought_id, visibility }) => {
      try {
        const point = await getPoint(thought_id);

        if (point === null) {
          return {
            content: [{ type: "text", text: "Thought not found." }],
            isError: true,
          };
        }

        if (point.payload.owner_id !== identity.owner_id) {
          return {
            content: [
              {
                type: "text",
                text: "Permission denied: you do not own this thought.",
              },
            ],
            isError: true,
          };
        }

        await setPayload(thought_id, { visibility });

        return {
          content: [
            {
              type: "text",
              text: `Visibility updated to "${visibility}" for thought ${thought_id}.`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error updating visibility: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
