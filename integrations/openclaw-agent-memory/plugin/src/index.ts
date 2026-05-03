import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { AgentMemoryClient, type AgentMemoryConfig } from "./client.js";

function clientFromApi(api: { pluginConfig?: unknown }) {
  const raw = (api.pluginConfig || {}) as Record<string, unknown>;
  if (typeof raw.endpoint !== "string" || raw.endpoint.length === 0) {
    throw new Error("OpenBrain Agent Memory plugin requires config.endpoint");
  }
  if (typeof raw.workspaceId !== "string" || raw.workspaceId.length === 0) {
    throw new Error("OpenBrain Agent Memory plugin requires config.workspaceId");
  }
  if (typeof raw.accessKey !== "string" || raw.accessKey.length === 0) {
    throw new Error("OpenBrain Agent Memory plugin requires config.accessKey. Use OpenClaw config env substitution for environment-backed secrets.");
  }
  const config: AgentMemoryConfig = {
    endpoint: raw.endpoint,
    accessKey: raw.accessKey,
    workspaceId: raw.workspaceId,
    projectId: typeof raw.projectId === "string" ? raw.projectId : undefined,
    requireReviewByDefault: typeof raw.requireReviewByDefault === "boolean" ? raw.requireReviewByDefault : true,
    includeUnconfirmedRecall: typeof raw.includeUnconfirmedRecall === "boolean" ? raw.includeUnconfirmedRecall : false,
  };
  return new AgentMemoryClient(config);
}

function toolResult(value: unknown) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
    details: value,
  };
}

function registerTool(api: any, tool: { name: string; label: string; description: string; parameters: unknown; run: (client: AgentMemoryClient, input: any) => Promise<unknown> }) {
  api.registerTool({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    async execute(_id: string, params: unknown) {
      const result = await tool.run(clientFromApi(api), params);
      return toolResult(result);
    },
  });
}

export default definePluginEntry({
  id: "openbrain-agent-memory",
  name: "OpenBrain Agent Memory",
  description: "Recall and write governed OB1 memory from OpenClaw workflows.",
  kind: "memory",
  register(api) {
    registerTool(api, {
      name: "openbrain_recall",
      label: "OpenBrain recall",
      description: "Recall scoped OB1 Agent Memory before meaningful work begins.",
      parameters: Type.Record(Type.String(), Type.Any()),
      run: (client, input) => client.recall(input),
    });

    registerTool(api, {
      name: "openbrain_writeback",
      label: "OpenBrain write-back",
      description: "Write compact, provenance-labeled OB1 Agent Memory after work finishes.",
      parameters: Type.Record(Type.String(), Type.Any()),
      run: (client, input) => client.writeback(input),
    });

    registerTool(api, {
      name: "openbrain_report_usage",
      label: "OpenBrain report usage",
      description: "Report which recalled memories were used or ignored.",
      parameters: Type.Object({
        request_id: Type.String(),
        used_memory_ids: Type.Optional(Type.Array(Type.String())),
        ignored: Type.Optional(Type.Array(Type.Object({
          memory_id: Type.String(),
          reason: Type.Optional(Type.String()),
        }))),
      }),
      run: (client, input) => client.reportUsage(input.request_id, {
        used_memory_ids: input.used_memory_ids || [],
        ignored: input.ignored || [],
      }),
    });

    registerTool(api, {
      name: "openbrain_inspect_memory",
      label: "OpenBrain inspect memory",
      description: "Inspect one OB1 Agent Memory record, including provenance and source references.",
      parameters: Type.Object({ memory_id: Type.String() }),
      run: (client, input) => client.inspectMemory(input.memory_id),
    });

    registerTool(api, {
      name: "openbrain_list_review_queue",
      label: "OpenBrain review queue",
      description: "List agent-written memories pending human review.",
      parameters: Type.Object({
        workspace_id: Type.Optional(Type.String()),
        project_id: Type.Optional(Type.String()),
      }),
      run: (client, input) => client.listReviewQueue(input),
    });

    registerTool(api, {
      name: "openbrain_review_memory",
      label: "OpenBrain review memory",
      description: "Confirm, edit, evidence-only, restrict, stale, dispute, supersede, or reject a memory.",
      parameters: Type.Object({
        memory_id: Type.String(),
        action: Type.Union([
          Type.Literal("confirm"),
          Type.Literal("edit"),
          Type.Literal("evidence_only"),
          Type.Literal("restrict_scope"),
          Type.Literal("mark_stale"),
          Type.Literal("merge"),
          Type.Literal("reject"),
          Type.Literal("dispute"),
          Type.Literal("supersede"),
        ]),
        actor_id: Type.Optional(Type.String()),
        actor_label: Type.Optional(Type.String()),
        notes: Type.Optional(Type.String()),
        content: Type.Optional(Type.String()),
        summary: Type.Optional(Type.String()),
        visibility: Type.Optional(Type.String()),
        related_memory_id: Type.Optional(Type.String()),
      }),
      run: (client, input) => {
        const { memory_id, ...body } = input;
        return client.reviewMemory(memory_id, body);
      },
    });

    registerTool(api, {
      name: "openbrain_get_recall_trace",
      label: "OpenBrain recall trace",
      description: "Fetch a recall trace to debug which memories were returned and used.",
      parameters: Type.Object({ request_id: Type.String() }),
      run: (client, input) => client.getRecallTrace(input.request_id),
    });
  },
});
