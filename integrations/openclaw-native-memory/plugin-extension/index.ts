import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { MemoryPromptSectionBuilder } from "openclaw/plugin-sdk/memory-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";

type CaptureParams = {
  content?: unknown;
  category?: unknown;
  tags?: unknown;
  source?: unknown;
};

type SearchParams = {
  query?: unknown;
  limit?: unknown;
  threshold?: unknown;
};

type ListParams = {
  limit?: unknown;
  type?: unknown;
  topic?: unknown;
  person?: unknown;
  days?: unknown;
};

type PluginConfig = {
  url: string;
  apiKey?: string;
  headers?: Record<string, string>;
  searchToolName: string;
  captureToolName: string;
  listToolName: string;
  deleteToolName: string;
  defaultLimit: number;
  timeoutMs: number;
  envelopeMode: boolean;
};

export const buildPromptSection: MemoryPromptSectionBuilder = ({ availableTools, citationsMode }) => {
  const hasSearch = availableTools.has("search_thoughts");
  const hasList = availableTools.has("list_thoughts");
  const hasCapture = availableTools.has("capture_thought");
  if (!hasSearch && !hasList && !hasCapture) return [];

  const lines = [
    "## OpenBrain Memory",
    "This runtime is connected to OpenBrain as a memory plugin. Prefer search_thoughts for recall, list_thoughts for recent memory inspection, capture_thought for durable saves, thought_stats for memory health overview, and delete_thought only for stale, wrong, or noisy entries.",
    "Duplicates are not automatically bad: repeated durable facts can reinforce retrieval. Prefer deletion for stale, contradictory, accidental, or low-value noisy entries rather than deduping everything.",
  ];
  if (citationsMode !== "off") {
    lines.push("When memory evidence matters, include concrete ids or quoted snippets from returned results so maintenance actions can target exact rows.");
  }
  lines.push("");
  return lines;
};

function normalizeTags(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function wrapContentWithEnvelope(content: string, metadata: { category?: string; tags?: string[]; source?: string }) {
  const lines = ["[OBMETA v1]"];
  if (metadata.category) lines.push(`category: ${metadata.category}`);
  if (metadata.tags && metadata.tags.length > 0) lines.push(`tags: ${metadata.tags.join(", ")}`);
  if (metadata.source) lines.push(`source: ${metadata.source}`);
  lines.push("---");
  lines.push(content);
  return lines.join("\n");
}

function extractTextFromMcpResult(payload: unknown): string {
  const result = (payload as { result?: { content?: Array<{ text?: string }> } })?.result;
  if (!result) {
    return JSON.stringify(payload);
  }
  const content = Array.isArray(result.content) ? result.content : [];
  const textBlocks = content
    .map((item) => (typeof item?.text === "string" ? item.text : ""))
    .filter(Boolean);
  if (textBlocks.length > 0) return textBlocks.join("\n\n");
  return JSON.stringify(result, null, 2);
}

function parseMcpPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("OpenBrain MCP returned empty payload");

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  const eventBlocks = trimmed
    .split(/\r?\n\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const candidates: unknown[] = [];
  for (const block of eventBlocks) {
    const dataParts = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s?/, ""));
    if (dataParts.length === 0) continue;

    const dataCombined = dataParts.join("\n").trim();
    if (!dataCombined || dataCombined === "[DONE]") continue;
    if (!dataCombined.startsWith("{")) continue;

    try {
      candidates.push(JSON.parse(dataCombined));
    } catch {
      // keep scanning other events
    }
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const c = candidates[i] as { result?: unknown; error?: unknown };
    if (c && (c.result !== undefined || c.error !== undefined)) {
      return c;
    }
  }
  if (candidates.length > 0) return candidates[candidates.length - 1];

  throw new Error(`OpenBrain MCP returned non-JSON payload: ${trimmed.slice(0, 400)}`);
}

async function callMcpTool({
  url,
  apiKey,
  headers,
  timeoutMs,
  toolName,
  args,
}: {
  url: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const reqHeaders: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(headers || {}),
    };

    if (apiKey && !reqHeaders.Authorization && !reqHeaders.authorization) {
      reqHeaders.Authorization = `Bearer ${apiKey}`;
    }

    const body = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`OpenBrain MCP HTTP ${response.status}: ${raw.slice(0, 400)}`);
    }

    const payload = parseMcpPayload(raw) as { error?: unknown; result?: unknown };
    if (payload?.error) {
      throw new Error(`OpenBrain MCP tool error: ${JSON.stringify(payload.error)}`);
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function parseConfig(api: OpenClawPluginApi): PluginConfig {
  const raw = (api.pluginConfig || {}) as Partial<PluginConfig>;
  return {
    url: String(raw.url || ""),
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : undefined,
    headers: raw.headers && typeof raw.headers === "object" ? raw.headers : undefined,
  searchToolName: String(raw.searchToolName || "search_thoughts"),
  captureToolName: String(raw.captureToolName || "capture_thought"),
  listToolName: String(raw.listToolName || "list_thoughts"),
  deleteToolName: String(raw.deleteToolName || "delete_thought"),
    defaultLimit: Number.isFinite(raw.defaultLimit) ? Number(raw.defaultLimit) : 8,
    timeoutMs: Number.isFinite(raw.timeoutMs) ? Number(raw.timeoutMs) : 25000,
    envelopeMode: raw.envelopeMode !== false,
  };
}

export default definePluginEntry({
  id: "openbrain-native",
  name: "OpenBrain Native",
  description: "Direct OpenBrain MCP tools without shell wrappers",
  kind: "memory",
  configSchema: {
    type: "object",
    additionalProperties: false,
      properties: {
        url: { type: "string" },
        apiKey: { type: "string" },
        headers: { type: "object", additionalProperties: { type: "string" } },
        searchToolName: { type: "string", default: "search_thoughts" },
        captureToolName: { type: "string", default: "capture_thought" },
        listToolName: { type: "string", default: "list_thoughts" },
        deleteToolName: { type: "string", default: "delete_thought" },
        defaultLimit: { type: "number", default: 8 },
        timeoutMs: { type: "number", default: 25000 },
        envelopeMode: { type: "boolean", default: true },
      },
    required: ["url"],
  },
  register(api) {
    const cfg = parseConfig(api);
    api.logger.info?.("openbrain-native: registering tools");
    api.registerMemoryPromptSection(buildPromptSection);

    if (!cfg.url) {
      api.logger.warn?.("openbrain-native: no MCP url configured yet; plugin installed but tools will return configuration errors until plugins.entries.openbrain-native.config.url is set");
    }

    api.registerTool(
      {
        name: "search_thoughts",
        label: "OpenBrain Search",
        description: "Search OpenBrain semantic memory directly via MCP.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Max results" },
            threshold: { type: "number", description: "Similarity threshold" },
          },
          required: ["query"],
        },
        async execute(_toolCallId: string, params: SearchParams) {
          const query = String(params?.query || "").trim();
          if (!cfg.url) return { content: [{ type: "text", text: "openbrain-native is not configured: set plugins.entries.openbrain-native.config.url" }] };
          if (!query) return { content: [{ type: "text", text: "query is required" }] };

          const args: Record<string, unknown> = {
            query,
            limit: Number.isFinite(params?.limit as number) ? Number(params?.limit) : cfg.defaultLimit,
          };
          if (Number.isFinite(params?.threshold as number)) args.threshold = Number(params?.threshold);

          try {
            const payload = await callMcpTool({
              url: cfg.url,
              apiKey: cfg.apiKey,
              headers: cfg.headers,
              timeoutMs: cfg.timeoutMs,
              toolName: cfg.searchToolName,
              args,
            });
            return { content: [{ type: "text", text: extractTextFromMcpResult(payload) }], details: (payload as { result?: unknown })?.result ?? null };
          } catch (err) {
            return { content: [{ type: "text", text: `openbrain_search failed: ${err instanceof Error ? err.message : String(err)}` }] };
          }
        },
      } as AnyAgentTool,
      { optional: true },
    );

    // Register Delete Thought tool
    api.registerTool(
      {
        name: "delete_thought",
        label: "OpenBrain Delete Thought",
        description: "Delete one or more thoughts in OpenBrain via MCP.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "Single thought id to delete" },
            ids: { type: "array", items: { type: "string" }, description: "Array of thought ids to delete" },
          },
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          if (!cfg.url) return { content: [{ type: "text", text: "openbrain-native is not configured: set plugins.entries.openbrain-native.config.url" }] };
          const id = typeof params?.id === "string" && params.id.trim() ? params.id.trim() : undefined;
          const ids = Array.isArray(params?.ids) ? (params.ids as unknown[]).filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim()) : undefined;
          if (!id && (!ids || ids.length === 0)) {
            return { content: [{ type: "text", text: "id or ids is required" }] };
          }

          const args: Record<string, unknown> = {};
          if (id) args.id = id;
          if (ids && ids.length > 0) args.ids = ids;

          try {
            const payload = await callMcpTool({
              url: cfg.url,
              apiKey: cfg.apiKey,
              headers: cfg.headers,
              timeoutMs: cfg.timeoutMs,
              toolName: cfg.deleteToolName,
              args,
            });
            return { content: [{ type: "text", text: extractTextFromMcpResult(payload) }], details: (payload as { result?: unknown })?.result ?? null };
          } catch (err) {
            return { content: [{ type: "text", text: `openbrain_delete failed: ${err instanceof Error ? err.message : String(err)}` }] };
          }
        },
      } as AnyAgentTool,
      { optional: true },
    );

    api.registerTool(
      {
        name: "capture_thought",
        label: "OpenBrain Capture",
        description: "Capture a thought into OpenBrain via MCP.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "Thought content to capture" },
            category: { type: "string", description: "Optional category label" },
            tags: { type: "array", items: { type: "string" }, description: "Tag array" },
            source: { type: "string", description: "Optional source label" },
          },
          required: ["content"],
        },
        async execute(_toolCallId: string, params: CaptureParams) {
          const base = String(params?.content || "").trim();
          if (!cfg.url) return { content: [{ type: "text", text: "openbrain-native is not configured: set plugins.entries.openbrain-native.config.url" }] };
          if (!base) return { content: [{ type: "text", text: "content is required" }] };

          const category = typeof params?.category === "string" ? params.category.trim() : "";
          const tags = normalizeTags(params?.tags);
          const source = typeof params?.source === "string" ? params.source.trim() : "";

          const args: Record<string, unknown> = cfg.envelopeMode
            ? { content: wrapContentWithEnvelope(base, { category, tags, source }) }
            : {
                content: base,
                ...(category ? { category } : {}),
                ...(tags.length > 0 ? { tags } : {}),
                ...(source ? { source } : {}),
              };

          try {
            const payload = await callMcpTool({
              url: cfg.url,
              apiKey: cfg.apiKey,
              headers: cfg.headers,
              timeoutMs: cfg.timeoutMs,
              toolName: cfg.captureToolName,
              args,
            });
            return { content: [{ type: "text", text: extractTextFromMcpResult(payload) }], details: (payload as { result?: unknown })?.result ?? null };
          } catch (err) {
            return { content: [{ type: "text", text: `openbrain_capture failed: ${err instanceof Error ? err.message : String(err)}` }] };
          }
        },
      } as AnyAgentTool,
      { optional: true },
    );

    api.registerTool(
      {
        name: "list_thoughts",
        label: "OpenBrain List Recent",
        description: "List recent thoughts from OpenBrain.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number" },
            type: { type: "string" },
            topic: { type: "string" },
            person: { type: "string" },
            days: { type: "number" },
          },
        },
        async execute(_toolCallId: string, params: ListParams) {
          if (!cfg.url) return { content: [{ type: "text", text: "openbrain-native is not configured: set plugins.entries.openbrain-native.config.url" }] };
          const args: Record<string, unknown> = {};
          for (const key of ["limit", "type", "topic", "person", "days"] as const) {
            const value = params?.[key];
            if (value !== undefined && value !== null && value !== "") args[key] = value;
          }
          if (args.limit === undefined) args.limit = cfg.defaultLimit;

          try {
            const payload = await callMcpTool({
              url: cfg.url,
              apiKey: cfg.apiKey,
              headers: cfg.headers,
              timeoutMs: cfg.timeoutMs,
              toolName: cfg.listToolName,
              args,
            });
            return { content: [{ type: "text", text: extractTextFromMcpResult(payload) }], details: (payload as { result?: unknown })?.result ?? null };
          } catch (err) {
            return { content: [{ type: "text", text: `openbrain_list_recent failed: ${err instanceof Error ? err.message : String(err)}` }] };
          }
        },
      } as AnyAgentTool,
      { optional: true },
    );
    // Register Thought Stats tool
    api.registerTool(
      {
        name: "thought_stats",
        label: "OpenBrain Statistics",
        description: "Get a summary of all captured thoughts (totals, types, top topics, people, etc.).",
        parameters: { type: "object", properties: {} },
        async execute(_toolCallId: string, _params: Record<string, unknown>) {
          if (!cfg.url) return { content: [{ type: "text", text: "openbrain-native is not configured: set plugins.entries.openbrain-native.config.url" }] };
          try {
            const payload = await callMcpTool({
              url: cfg.url,
              apiKey: cfg.apiKey,
              headers: cfg.headers,
              timeoutMs: cfg.timeoutMs,
              toolName: "thought_stats",
              args: {},
            });
            return {
              content: [{ type: "text", text: extractTextFromMcpResult(payload) }],
              details: (payload as { result?: unknown })?.result ?? null,
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `openbrain_stats failed: ${err instanceof Error ? err.message : String(err)}` }],
            };
          }
        },
      } as AnyAgentTool,
      { optional: true },
    );
  },
});
