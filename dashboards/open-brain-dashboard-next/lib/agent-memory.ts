import "server-only";

import type {
  AgentMemory,
  AgentMemoryListResponse,
  AgentMemoryRecord,
  AgentMemoryReviewAction,
  AgentMemoryTraceResponse,
} from "./types";

const AGENT_MEMORY_API_URL =
  process.env.AGENT_MEMORY_API_URL ||
  process.env.NEXT_PUBLIC_AGENT_MEMORY_API_URL ||
  deriveAgentMemoryUrl(process.env.NEXT_PUBLIC_API_URL);

function deriveAgentMemoryUrl(restUrl?: string) {
  if (!restUrl) return undefined;
  return restUrl.replace(/\/open-brain-rest\/?$/, "/agent-memory-api");
}

function headers(apiKey: string): HeadersInit {
  return {
    "x-brain-key": apiKey,
    "Content-Type": "application/json",
  };
}

async function agentMemoryFetch<T>(
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  if (!AGENT_MEMORY_API_URL) {
    throw new Error(
      "AGENT_MEMORY_API_URL or NEXT_PUBLIC_AGENT_MEMORY_API_URL is required for Agent Memory dashboard pages."
    );
  }
  const res = await fetch(`${AGENT_MEMORY_API_URL}${path}`, {
    ...init,
    headers: { ...headers(apiKey), ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Agent Memory API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

export function agentMemoryDefaults() {
  return {
    workspaceId: process.env.AGENT_MEMORY_WORKSPACE_ID || "ob1-staging",
    projectId: process.env.AGENT_MEMORY_PROJECT_ID || "",
  };
}

export async function fetchAgentMemories(
  apiKey: string,
  params: {
    workspace_id: string;
    project_id?: string;
    review_status?: string;
    lifecycle_status?: string;
    runtime_name?: string;
    memory_type?: string;
    task_id_prefix?: string;
    limit?: number;
  }
): Promise<AgentMemoryListResponse> {
  const sp = new URLSearchParams({ workspace_id: params.workspace_id });
  for (const [key, value] of Object.entries(params)) {
    if (key === "workspace_id" || value === undefined || value === "") continue;
    sp.set(key, String(value));
  }
  return agentMemoryFetch<AgentMemoryListResponse>(apiKey, `/memories?${sp.toString()}`);
}

export async function fetchReviewQueue(
  apiKey: string,
  workspaceId: string,
  projectId?: string
): Promise<AgentMemory[]> {
  const sp = new URLSearchParams({ workspace_id: workspaceId });
  if (projectId) sp.set("project_id", projectId);
  const data = await agentMemoryFetch<{ memories: AgentMemory[] }>(
    apiKey,
    `/memories/review?${sp.toString()}`
  );
  return data.memories;
}

export async function fetchAgentMemory(
  apiKey: string,
  memoryId: string
): Promise<AgentMemoryRecord> {
  const data = await agentMemoryFetch<{ memory: AgentMemoryRecord }>(
    apiKey,
    `/memories/${memoryId}`
  );
  return data.memory;
}

export async function reviewAgentMemory(
  apiKey: string,
  memoryId: string,
  action: AgentMemoryReviewAction,
  options?: {
    actor_label?: string;
    notes?: string;
    content?: string;
    summary?: string;
    visibility?: string;
    related_memory_id?: string;
  }
): Promise<{ memory: AgentMemoryRecord }> {
  return agentMemoryFetch(apiKey, `/memories/${memoryId}/review`, {
    method: "PATCH",
    body: JSON.stringify({ action, ...options }),
  });
}

export async function fetchRecallTrace(
  apiKey: string,
  requestId: string
): Promise<AgentMemoryTraceResponse> {
  return agentMemoryFetch<AgentMemoryTraceResponse>(
    apiKey,
    `/recall-traces/${requestId}`
  );
}
