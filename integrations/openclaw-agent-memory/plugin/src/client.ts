export type AgentMemoryConfig = {
  endpoint: string;
  accessKey?: string;
  accessKeyEnv?: string;
  workspaceId: string;
  projectId?: string;
  requireReviewByDefault?: boolean;
  includeUnconfirmedRecall?: boolean;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
};

export class AgentMemoryClient {
  private endpoint: string;
  private accessKey: string;

  constructor(private config: AgentMemoryConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, "");
    const envKey = config.accessKeyEnv || "OB1_AGENT_MEMORY_KEY";
    this.accessKey = config.accessKey || process.env[envKey] || "";
    if (!this.accessKey) {
      throw new Error(`OB1 Agent Memory access key missing. Set accessKey or ${envKey}.`);
    }
  }

  async request(path: string, options: RequestOptions = {}) {
    const response = await fetch(`${this.endpoint}${path}`, {
      method: options.method || "GET",
      headers: {
        "content-type": "application/json",
        "x-brain-key": this.accessKey,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`OB1 Agent Memory API ${response.status}: ${data.error || text}`);
    }
    return data;
  }

  recall(input: Record<string, unknown>) {
    return this.request("/recall", {
      method: "POST",
      body: {
        workspace_id: this.config.workspaceId,
        project_id: this.config.projectId ?? null,
        ...input,
        scope: {
          include_unconfirmed: this.config.includeUnconfirmedRecall ?? false,
          ...(typeof input.scope === "object" && input.scope ? input.scope : {}),
        },
      },
    });
  }

  writeback(input: Record<string, unknown>) {
    return this.request("/writeback", {
      method: "POST",
      body: {
        workspace_id: this.config.workspaceId,
        project_id: this.config.projectId ?? null,
        ...input,
        provenance: {
          default_status: "generated",
          confidence: 0.5,
          requires_review: this.config.requireReviewByDefault ?? true,
          ...(typeof input.provenance === "object" && input.provenance ? input.provenance : {}),
        },
      },
    });
  }

  reportUsage(requestId: string, input: Record<string, unknown>) {
    return this.request(`/recall/${requestId}/usage`, { method: "POST", body: input });
  }

  inspectMemory(memoryId: string) {
    return this.request(`/memories/${memoryId}`);
  }

  listReviewQueue(input: { workspace_id?: string; project_id?: string } = {}) {
    const workspaceId = input.workspace_id || this.config.workspaceId;
    const projectId = input.project_id || this.config.projectId;
    const params = new URLSearchParams({ workspace_id: workspaceId });
    if (projectId) params.set("project_id", projectId);
    return this.request(`/memories/review?${params.toString()}`);
  }

  reviewMemory(memoryId: string, input: Record<string, unknown>) {
    return this.request(`/memories/${memoryId}/review`, { method: "PATCH", body: input });
  }

  getRecallTrace(requestId: string) {
    return this.request(`/recall-traces/${requestId}`);
  }
}
