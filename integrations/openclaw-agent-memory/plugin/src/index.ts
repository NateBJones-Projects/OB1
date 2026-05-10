import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { resolveConfiguredSecretInputString } from "openclaw/plugin-sdk/secret-input-runtime";
import { AgentMemoryClient, type AgentMemoryConfig } from "./client.js";
import { createOB1Runtime } from "./search-manager.js";

async function clientFromApi(api: { pluginConfig?: unknown; config?: unknown }) {
  const raw = (api.pluginConfig || {}) as Record<string, unknown>;
  if (typeof raw.endpoint !== "string" || raw.endpoint.length === 0) {
    throw new Error("OB1 Agent Memory plugin requires config.endpoint");
  }
  if (typeof raw.workspaceId !== "string" || raw.workspaceId.length === 0) {
    throw new Error("OB1 Agent Memory plugin requires config.workspaceId");
  }

  const accessKey = await resolveConfiguredSecretInputString({
    config: (api.config || {}) as any,
    env: process.env,
    value: raw.accessKey,
    path: "plugins.entries.nbj-ob1-agent-memory.config.accessKey",
    unresolvedReasonStyle: "detailed",
  });

  if (!accessKey.value) {
    const reason = accessKey.unresolvedRefReason ? ` ${accessKey.unresolvedRefReason}` : "";
    throw new Error(`OB1 Agent Memory plugin requires config.accessKey.${reason}`);
  }

  const config: AgentMemoryConfig = {
    endpoint: raw.endpoint,
    accessKey: accessKey.value,
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

function clampInt(n: number, lo: number, hi: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function clampFloat(n: number, lo: number, hi: number): number {
  const v = typeof n === "number" && !Number.isNaN(n) ? n : lo;
  return Math.max(lo, Math.min(hi, v));
}

// LLM tool callers occasionally JSON.stringify nested-object parameters,
// which the Edge Function's zod schema then rejects as "expected object,
// received string." Coerce string-shaped fields back to objects before
// sending. Walks one level deep — that is what the contract needs and any
// further nesting that arrived as a string would be a separate caller bug.
function coerceObjectFields(input: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  for (const key of fields) {
    const value = out[key];
    if (typeof value === "string") {
      try {
        out[key] = JSON.parse(value);
      } catch {
        // leave as string; let the server return a structured error
      }
    }
  }
  return out;
}

// Resolve the OB1 workspace_id for a given agent, mirroring the same
// workspaceMode logic the SearchManager uses. Phase 9 multi-tenant: when
// workspaceMode="per-agent", each agent's writeback lands in its own
// isolated workspace so that recall (also scoped to that workspace) finds
// only its own prior writes. When workspaceMode="shared" or unset, every
// agent uses the configured workspaceId (back-compat with PR #282 single
// tenant default).
function resolveAgentWorkspaceId(api: any, agentId: string | undefined): string {
  const raw = ((api as any).pluginConfig || {}) as Record<string, unknown>;
  const fallback = typeof raw.workspaceId === "string" && raw.workspaceId.length > 0
    ? raw.workspaceId
    : "default";
  const mode = typeof raw.workspaceMode === "string" ? raw.workspaceMode : "shared";
  if (mode !== "per-agent") return fallback;
  const id = String(agentId || "").trim();
  if (!id) return fallback;
  const prefix = typeof raw.workspacePrefix === "string" ? raw.workspacePrefix : "";
  return prefix + id;
}

function registerTool(api: any, tool: { name: string; label: string; description: string; parameters: unknown; run: (client: AgentMemoryClient, input: any) => Promise<unknown> }) {
  api.registerTool({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    async execute(_id: string, params: unknown) {
      const result = await tool.run(await clientFromApi(api), params);
      return toolResult(result);
    },
  });
}

export default definePluginEntry({
  id: "nbj-ob1-agent-memory",
  name: "NBJ OB1 Agent Memory for OpenClaw",
  description: "Recall and write governed Nate Jones OB1 memory from OpenClaw workflows.",
  kind: "memory",
  register(api) {
    registerTool(api, {
      name: "openbrain_recall",
      label: "NBJ OB1 recall",
      description: "Recall scoped Nate Jones OB1 Agent Memory before meaningful work begins.",
      parameters: Type.Record(Type.String(), Type.Any()),
      run: (client, input) => client.recall(
        coerceObjectFields(input, ["scope", "limits", "runtime", "model_intent", "channel", "entities", "sensitivity"]),
      ),
    });

    // openbrain_writeback uses the factory form so we get ctx.agentId from
    // the per-call OpenClawPluginToolContext. Phase 9: per-agent workspace
    // resolution requires agentId at write time (not just at search time).
    // Factory registrations REQUIRE the {names: [...]} opts so the host can
    // discover the tool without invoking the factory eagerly.
    api.registerTool((ctx: any) => ({
      name: "openbrain_writeback",
      label: "NBJ OB1 write-back",
      description: "Write compact, provenance-labeled Nate Jones OB1 Agent Memory after work finishes.",
      parameters: Type.Record(Type.String(), Type.Any()),
      async execute(_id: string, params: unknown) {
        const client = await clientFromApi(api);
        const input = (params || {}) as Record<string, unknown>;
        const coerced = coerceObjectFields(input, ["memory_payload", "provenance", "runtime", "models_used", "source_refs", "retention", "visibility", "channel"]);
        // Default runtime.name to "openclaw" so writes are correctly
        // attributed without requiring the agent to know the contract.
        const runtime = (typeof coerced.runtime === "object" && coerced.runtime) ? coerced.runtime as Record<string, unknown> : {};
        if (!runtime.name) runtime.name = "openclaw";
        coerced.runtime = runtime;
        // Per-agent workspace override. Explicit input.workspace_id still wins.
        if (!coerced.workspace_id) {
          coerced.workspace_id = resolveAgentWorkspaceId(api, ctx?.agentId);
        }
        // Tag flow_id with agent identity so traces are attributable even
        // when the agent didn't pass one.
        if (!coerced.flow_id && ctx?.agentId) {
          coerced.flow_id = String(ctx.agentId);
        }
        const result = await client.writeback(coerced);
        return toolResult(result);
      },
    }), { names: ["openbrain_writeback"] });

    registerTool(api, {
      name: "openbrain_report_usage",
      label: "NBJ OB1 report usage",
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
      label: "NBJ OB1 inspect memory",
      description: "Inspect one Nate Jones OB1 Agent Memory record, including provenance and source references.",
      parameters: Type.Object({ memory_id: Type.String() }),
      run: (client, input) => client.inspectMemory(input.memory_id),
    });

    registerTool(api, {
      name: "openbrain_list_review_queue",
      label: "NBJ OB1 review queue",
      description: "List agent-written memories pending human review.",
      parameters: Type.Object({
        workspace_id: Type.Optional(Type.String()),
        project_id: Type.Optional(Type.String()),
      }),
      run: (client, input) => client.listReviewQueue(input),
    });

    registerTool(api, {
      name: "openbrain_review_memory",
      label: "NBJ OB1 review memory",
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
      label: "NBJ OB1 recall trace",
      description: "Fetch a recall trace to debug which memories were returned and used.",
      parameters: Type.Object({ request_id: Type.String() }),
      run: (client, input) => client.getRecallTrace(input.request_id),
    });

    // ------------------------------------------------------------------
    // Memory-host hooks (fix for #279).
    //
    // The plugin registers tools above, but without participating in the
    // OpenClaw memory-host lifecycle, agents only invoke OB1 if they
    // remember to. We register two additive memory hooks so OB1 lands
    // in every turn automatically:
    //
    //   1. registerMemoryPromptSupplement — auto-injects an OB1 discipline
    //      block into the system prompt (recall-before / writeback-after
    //      reminder, instruction-vs-evidence semantics, tool list).
    //   2. registerMemoryCorpusSupplement — exposes OB1 as a searchable
    //      corpus so OpenClaw's native recall flow queries OB1 alongside
    //      whatever other corpora are active.
    //
    // Both are additive (per the SDK contract), coexist with the active
    // exclusive memory plugin, and no-op cleanly when OB1 isn't configured.
    // ------------------------------------------------------------------

    const OB1_TOOL_NAMES = [
      "openbrain_recall",
      "openbrain_writeback",
      "openbrain_report_usage",
      "openbrain_inspect_memory",
      "openbrain_list_review_queue",
      "openbrain_review_memory",
      "openbrain_get_recall_trace",
    ] as const;

    function isConfigured(): boolean {
      const raw = ((api as any).pluginConfig || {}) as Record<string, unknown>;
      return typeof raw.endpoint === "string"
        && raw.endpoint.length > 0
        && typeof raw.workspaceId === "string"
        && raw.workspaceId.length > 0;
    }

    if (typeof (api as any).registerMemoryPromptSupplement === "function") {
      (api as any).registerMemoryPromptSupplement((params: { availableTools: Set<string> }) => {
        if (!isConfigured()) return [];
        const present = OB1_TOOL_NAMES.filter((t) => params.availableTools.has(t));
        if (present.length === 0) return [];
        return [
          "## OB1 Agent Memory",
          "Long-term governed memory is available via OB1. Use it as a discipline, not a fallback.",
          "",
          "Workflow:",
          "- Before meaningful work, call `openbrain_recall` with a task-scoped query.",
          "- Treat returned memories tagged `instruction` as binding rules; `evidence`-tagged ones as supporting context only.",
          "- After meaningful work, call `openbrain_writeback` with compact, provenance-labeled findings (decisions, lessons, constraints, outputs, failures).",
          "- After acting on recalled memories, call `openbrain_report_usage` with `request_id` and the IDs you used vs. ignored — closes the recall-quality loop.",
          "",
          `Available tools: ${present.map((t) => "`" + t + "`").join(", ")}.`,
        ];
      });
    }

    // ------------------------------------------------------------------
    // Active-memory capability (#282).
    //
    // The supplements above (#281) layer additive context onto whatever the
    // active memory plugin is. To make OB1 *be* the active memory plugin
    // (so OpenClaw routes its native memory_search / memory_get tools and
    // the active-memory pipeline through us), we also register a real
    // MemoryCapability with a search-manager runtime.
    //
    // Selection still requires user config: plugins.slots.memory =
    // "nbj-ob1-agent-memory". registerMemoryCapability alone declares
    // candidacy; the slots config flips the switch.
    // ------------------------------------------------------------------

    if (typeof (api as any).registerMemoryCapability === "function") {
      const ob1Runtime = createOB1Runtime({
        // Per-agent client: each call picks up the current pluginConfig +
        // resolved access key. The agent-scoped workspace selection happens
        // inside the search manager via workspaceIdFor below — the client
        // itself stays config-defaulted; per-request workspace overrides are
        // injected in the search() body.
        buildClient: (_agentId: string) => clientFromApi(api),
        // Multi-tenant resolution (Phase 9). Three modes via plugin config:
        //   workspaceMode="shared" (default): every agent uses the configured
        //     workspaceId. Fleet-wide single-tenant.
        //   workspaceMode="per-agent": workspace_id = workspacePrefix + agentId.
        //     Each agent's writes/recalls live in their own isolated workspace.
        //   workspacePrefix is optional; defaults to empty (raw agentId used).
        // Falls back to configured workspaceId for empty agentId in per-agent
        // mode so the runtime never sends an empty workspace.
        workspaceIdFor: (agentId: string) => {
          const raw = ((api as any).pluginConfig || {}) as Record<string, unknown>;
          const fallback = typeof raw.workspaceId === "string" && raw.workspaceId.length > 0
            ? raw.workspaceId
            : "default";
          const mode = typeof raw.workspaceMode === "string" ? raw.workspaceMode : "shared";
          if (mode !== "per-agent") return fallback;
          const id = String(agentId || "").trim();
          if (!id) return fallback;
          const prefix = typeof raw.workspacePrefix === "string" ? raw.workspacePrefix : "";
          return prefix + id;
        },
      });

      (api as any).registerMemoryCapability({
        // Mirror the supplement section so it shows up even when OB1 is the
        // active memory plugin (no other promptBuilder will run).
        promptBuilder: (params: { availableTools: Set<string> }) => {
          if (!isConfigured()) return [];
          const present = OB1_TOOL_NAMES.filter((t) => params.availableTools.has(t));
          if (present.length === 0) return [];
          return [
            "## OB1 Agent Memory (active backend)",
            "Long-term governed memory is available via OB1 as the active memory backend.",
            "",
            "Workflow:",
            "- Use `memory_search` (or `openbrain_recall`) to recall relevant prior memory before meaningful work.",
            "- Treat returned memories tagged `instruction` as binding rules; `evidence`-tagged ones as supporting context only.",
            "- Use `openbrain_writeback` to capture compact, provenance-labeled findings (decisions, lessons, constraints, outputs, failures).",
            "- After acting on recalled memories, call `openbrain_report_usage` to close the recall-quality loop.",
          ];
        },
        runtime: ob1Runtime,
      });
    }

    // Standard memory_search / memory_get tool wrappers — these are the
    // names the active-memory plugin and OpenClaw's prompt template look
    // for. The seven openbrain_* tools above stay as the advanced surface
    // (governance review queue, recall traces, etc.).

    // memory_search: factory form so per-agent workspace_id is resolved
    // per call. The SearchManager-driven recall path (active memory pipeline)
    // also routes through workspaceIdFor below — this tool path mirrors it.
    api.registerTool((ctx: any) => ({
      name: "memory_search",
      label: "Memory search (OB1)",
      description: "Search long-term memory for relevant prior decisions, lessons, constraints, or notes.",
      parameters: Type.Object({
        query: Type.String({ description: "Natural-language search query." }),
        max_results: Type.Optional(Type.Number({ description: "Maximum results, 1-50.", default: 10 })),
      }),
      async execute(_id: string, params: any) {
        const client = await clientFromApi(api);
        const max = clampInt(params?.max_results ?? 10, 1, 50);
        const result = await client.recall({
          workspace_id: resolveAgentWorkspaceId(api, ctx?.agentId),
          query: String(params?.query ?? "").slice(0, 2000),
          task_type: "search",
          limits: { max_items: max, max_tokens: 4000 },
          scope: {
            visibility: "personal",
            project_only: false,
            include_unconfirmed: true,
            include_stale: false,
          },
          runtime: { name: "openclaw" },
          flow_id: ctx?.agentId ? String(ctx.agentId) : undefined,
        });
        return toolResult(result);
      },
    }), { names: ["memory_search"] });

    api.registerTool((ctx: any) => ({
      name: "memory_get",
      label: "Memory get (OB1)",
      description: "Inspect one specific OB1 memory by id, including provenance.",
      parameters: Type.Object({
        memory_id: Type.String({ description: "OB1 memory id (uuid)." }),
      }),
      async execute(_id: string, params: any) {
        // Note: inspectMemory queries a memory by ID directly without a
        // workspace_id filter (the ID is globally unique). Per-agent
        // isolation is preserved at write/recall time, not at inspect time.
        // We intentionally don't gate inspect by ctx.agentId so that
        // governance review tools can fetch any memory by id.
        void ctx; // keep ctx in scope for symmetry / future audit hooks
        const client = await clientFromApi(api);
        const memory = await client.inspectMemory(String(params?.memory_id ?? ""));
        return toolResult(memory);
      },
    }), { names: ["memory_get"] });

    // memory_store: factory form so we can read ctx.agentId for per-agent
    // workspace resolution.
    api.registerTool((ctx: any) => ({
      name: "memory_store",
      label: "Memory store (OB1)",
      description:
        "Store a compact, governed memory in OB1 — decisions, lessons, constraints, outputs, or failures. Lands as pending review by default.",
      parameters: Type.Object({
        content: Type.String({ description: "The memory content. Compact, single point per call." }),
        memory_type: Type.Optional(
          Type.Union(
            [
              Type.Literal("decision"),
              Type.Literal("lesson"),
              Type.Literal("constraint"),
              Type.Literal("output"),
              Type.Literal("failure"),
              Type.Literal("next_step"),
              Type.Literal("unresolved_question"),
            ],
            { description: "OB1 governance category. Defaults to 'output'.", default: "output" },
          ),
        ),
        confidence: Type.Optional(
          Type.Number({ description: "Self-reported confidence 0-1.", default: 0.7 }),
        ),
      }),
      async execute(_id: string, params: any) {
        const client = await clientFromApi(api);
        const content = String(params?.content ?? "").trim();
        if (!content) {
          return toolResult({ error: "memory_store requires non-empty content" });
        }
        const type = String(params?.memory_type ?? "output");
        const conf = clampFloat(params?.confidence ?? 0.7, 0, 1);
        const categoryMap: Record<string, string> = {
          decision: "decisions",
          lesson: "lessons",
          constraint: "constraints",
          output: "outputs",
          failure: "failures",
          next_step: "next_steps",
          unresolved_question: "unresolved_questions",
        };
        const bucket = categoryMap[type] ?? "outputs";
        const result = await client.writeback({
          workspace_id: resolveAgentWorkspaceId(api, ctx?.agentId),
          memory_payload: { [bucket]: [content] },
          runtime: { name: "openclaw" },
          flow_id: ctx?.agentId ? String(ctx.agentId) : undefined,
          provenance: {
            default_status: "generated",
            confidence: conf,
            requires_review: true,
          },
        });
        return toolResult(result);
      },
    }), { names: ["memory_store"] });

    if (typeof (api as any).registerMemoryCorpusSupplement === "function") {
      (api as any).registerMemoryCorpusSupplement({
        async search(input: { query: string; maxResults?: number; agentSessionKey?: string }) {
          if (!isConfigured()) return [];
          let client: AgentMemoryClient;
          try {
            client = await clientFromApi(api);
          } catch {
            return [];
          }
          const limit = Math.min(Math.max(input.maxResults ?? 10, 1), 50);
          let response: any;
          try {
            response = await client.recall({
              query: input.query.slice(0, 2000),
              task_type: "general",
              limits: { max_items: limit, max_tokens: 4000 },
              scope: { project_only: false, include_unconfirmed: false, include_stale: false },
            });
          } catch {
            return [];
          }
          const memories: any[] = Array.isArray(response?.memories) ? response.memories : [];
          return memories.map((m, i) => {
            const policy = m?.use_policy ?? {};
            const provenance = policy?.can_use_as_instruction
              ? "instruction"
              : policy?.can_use_as_evidence
                ? "evidence"
                : undefined;
            return {
              corpus: "openbrain",
              path: `openbrain://memory/${m?.id ?? i}`,
              title: typeof m?.summary === "string" ? m.summary.slice(0, 80) : undefined,
              kind: "memory",
              score: typeof m?.score === "number" ? m.score : Math.max(0, 1 - i / Math.max(memories.length, 1)),
              snippet: String(m?.summary ?? m?.content ?? "").slice(0, 600),
              id: typeof m?.id === "string" ? m.id : undefined,
              provenanceLabel: provenance,
              source: "openbrain.agent_memory",
              sourceType: "openbrain.agent_memory",
              updatedAt: typeof m?.updated_at === "string" ? m.updated_at : undefined,
            };
          });
        },
        async get(input: { lookup: string }) {
          if (!isConfigured()) return null;
          const id = input.lookup.replace(/^openbrain:\/\/memory\//, "");
          if (!id) return null;
          let client: AgentMemoryClient;
          try {
            client = await clientFromApi(api);
          } catch {
            return null;
          }
          let memory: any;
          try {
            memory = await client.inspectMemory(id);
          } catch {
            return null;
          }
          if (!memory || typeof memory !== "object") return null;
          const policy = (memory as any)?.use_policy ?? {};
          const provenance = policy?.can_use_as_instruction
            ? "instruction"
            : policy?.can_use_as_evidence
              ? "evidence"
              : undefined;
          const content = String((memory as any)?.content ?? (memory as any)?.summary ?? "");
          return {
            corpus: "openbrain",
            path: input.lookup,
            title: typeof (memory as any)?.summary === "string" ? (memory as any).summary.slice(0, 80) : undefined,
            kind: "memory",
            content,
            fromLine: 1,
            lineCount: content.split("\n").length,
            id: typeof (memory as any)?.id === "string" ? (memory as any).id : id,
            provenanceLabel: provenance,
            sourceType: "openbrain.agent_memory",
            updatedAt: typeof (memory as any)?.updated_at === "string" ? (memory as any).updated_at : undefined,
          };
        },
      });
    }
  },
});
