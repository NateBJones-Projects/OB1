import "server-only";

type JsonRpcSuccess<T> = {
  jsonrpc: "2.0";
  id?: string | number | null;
  result: T;
};

type JsonRpcError = {
  jsonrpc: "2.0";
  id?: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type JsonRpcEnvelope<T> = JsonRpcSuccess<T> | JsonRpcError;

type ToolCallResult = {
  content?: Array<{
    type: string;
    text?: string;
  }>;
  isError?: boolean;
};

type SearchHit = {
  id: string;
  title: string;
  url?: string;
};

export type McpThoughtDocument = {
  id: string;
  title: string;
  text: string;
  url?: string;
  metadata: Record<string, unknown> & {
    created_at?: string;
    updated_at?: string | null;
  };
};

const MCP_URL = process.env.OPEN_BRAIN_MCP_URL;

function requireMcpUrl() {
  if (!MCP_URL) {
    throw new Error("OPEN_BRAIN_MCP_URL is not configured");
  }
  return MCP_URL;
}

function buildHeaders(apiKey: string): HeadersInit {
  return {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "x-brain-key": apiKey,
  };
}

function parseEventStreamPayload<T>(body: string): JsonRpcEnvelope<T> {
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  if (dataLines.length === 0) {
    throw new Error("MCP event stream returned no data payload");
  }

  return JSON.parse(dataLines.join("\n")) as JsonRpcEnvelope<T>;
}

async function parseJsonRpc<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();

  const payload = contentType.includes("text/event-stream")
    ? parseEventStreamPayload<T>(raw)
    : (JSON.parse(raw) as JsonRpcEnvelope<T>);

  if ("error" in payload) {
    throw new Error(payload.error.message);
  }

  return payload.result;
}

async function mcpPost<T>({
  apiKey,
  body,
}: {
  apiKey: string;
  body: Record<string, unknown>;
}): Promise<T> {
  const response = await fetch(requireMcpUrl(), {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `MCP request failed (${response.status})`);
  }

  return parseJsonRpc<T>(response);
}

function extractToolText(result: ToolCallResult): string {
  const firstText = result.content?.find((item) => item.type === "text")?.text;
  if (!firstText) {
    throw new Error("MCP tool returned no text payload");
  }
  if (result.isError) {
    throw new Error(firstText);
  }
  return firstText;
}

async function callToolText(
  apiKey: string,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const result = await mcpPost<ToolCallResult>({
    apiKey,
    body: {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    },
  });

  return extractToolText(result);
}

async function callTool<T>(
  apiKey: string,
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  return JSON.parse(await callToolText(apiKey, name, args)) as T;
}

export async function validateMcpKey(apiKey: string): Promise<void> {
  await callTool<{ results: SearchHit[] }>(apiKey, "search", {
    query: "test",
  });
}

export async function mcpSearchThoughts(
  apiKey: string,
  query: string
): Promise<McpThoughtDocument[]> {
  const search = await callTool<{ results: SearchHit[] }>(apiKey, "search", {
    query,
  });

  const hits = search.results ?? [];
  return Promise.all(
    hits.slice(0, 10).map((hit) => callTool<McpThoughtDocument>(apiKey, "fetch", { id: hit.id }))
  );
}

export async function mcpFetchThought(
  apiKey: string,
  id: string
): Promise<McpThoughtDocument> {
  return callTool<McpThoughtDocument>(apiKey, "fetch", { id });
}

export async function mcpThoughtStats(apiKey: string): Promise<string> {
  return callToolText(apiKey, "thought_stats", {});
}
