export type AgentMemoryConfig = {
  endpoint: string;
  accessKey: string;
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
    this.accessKey = config.accessKey;
    if (!this.accessKey) {
      throw new Error("OB1 Agent Memory access key missing. Configure plugins.entries.nbj-ob1-agent-memory.config.accessKey.");
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
        // schema_version is REQUIRED by the Edge Function recallSchema;
        // omitting it returns "400 Invalid recall payload".
        schema_version: "openbrain.openclaw.recall.v1",
        workspace_id: this.config.workspaceId,
        project_id: this.config.projectId ?? null,
        ...input,
        // Two Edge Function defaults make naive recall return zero rows:
        //   1. writes land with visibility="personal" but scopeMatches drops
        //      personal unless scope.visibility="personal" is passed.
        //   2. writes default to requires_review=true (governance), which
        //      gives them review_status="pending"; scope.include_unconfirmed
        //      must be true or pending memories are filtered out.
        // Default both here so callers don't have to know these quirks; an
        // explicit input.scope still wins via the spread below.
        scope: {
          visibility: "personal",
          include_unconfirmed: this.config.includeUnconfirmedRecall ?? true,
          ...(typeof input.scope === "object" && input.scope ? input.scope : {}),
        },
      },
    });
  }

  writeback(input: Record<string, unknown>) {
    return this.request("/writeback", {
      method: "POST",
      body: {
        // schema_version REQUIRED; openclaw variant accepted alongside
        // openbrain.agent_memory.writeback.v1 by the Edge Function.
        schema_version: "openbrain.openclaw.writeback.v1",
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
