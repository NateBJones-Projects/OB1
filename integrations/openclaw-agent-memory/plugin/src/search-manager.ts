// MemorySearchManager + MemoryPluginRuntime adapters that let OpenClaw use
// OB1 as the active memory backend (PR #282 / fix for #279).
//
// The OpenClaw memory subsystem expects a MemorySearchManager exposing
// search/status/probe methods. Local plugins like memory-core implement this
// against a SQLite + sqlite-vec index. Our adapter wraps the OB1 HTTP client
// instead — same external contract, different backend.

import { AgentMemoryClient } from "./client.js";

// ---------------------------------------------------------------------------
// Result shape (matches what OpenClaw memory-core's search() returns)
// ---------------------------------------------------------------------------

export type MemorySearchHit = {
  source: "memory" | "sessions";
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  vectorScore?: number;
  textScore?: number;
  snippet: string;
};

// ---------------------------------------------------------------------------
// Status shape (matches MemoryProviderStatus consumed by host status path)
// ---------------------------------------------------------------------------

export type ProviderStatus = {
  backend: string;          // discriminator for downstream config-clamping
  ready: boolean;
  indexed?: number;
  notes?: string[];
};

// ---------------------------------------------------------------------------
// Search options (subset of what consumers actually pass)
// ---------------------------------------------------------------------------

export type SearchOptions = {
  maxResults?: number;
  minScore?: number;
  sessionKey?: string;
  qmdSearchModeOverride?: unknown;
  onDebug?: (debug: unknown) => void;
  sources?: string[];
};

// ---------------------------------------------------------------------------
// MemorySearchManager — the per-agent search engine OpenClaw consumes
// ---------------------------------------------------------------------------

export class OB1MemorySearchManager {
  private closed = false;
  private workspaceId: string;
  private agentId: string;

  constructor(
    private client: AgentMemoryClient,
    params: { workspaceId: string; agentId: string },
  ) {
    this.workspaceId = params.workspaceId;
    this.agentId = params.agentId;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<MemorySearchHit[]> {
    if (this.closed) return [];
    const trimmed = String(query || "").trim();
    if (!trimmed) return [];

    const limit = clamp(opts.maxResults ?? 10, 1, 50);
    const minScore = typeof opts.minScore === "number" ? opts.minScore : 0;

    let response: any;
    try {
      response = await this.client.recall({
        // Per-agent override: when workspaceMode="per-agent", this.workspaceId
        // is already the agent's isolated workspace (e.g., "nina"). When
        // workspaceMode="shared", it equals the configured workspaceId. Either
        // way the override beats the client's default.
        workspace_id: this.workspaceId,
        query: trimmed.slice(0, 2000),
        task_type: "general",
        limits: { max_items: limit, max_tokens: 4000 },
        // Edge Function quirks: writes default to visibility="personal" and
        // requires_review=true. scope must mirror both or recall returns 0.
        // (Same fix the Hermes provider applied — see PR #280.)
        scope: {
          visibility: "personal",
          project_only: false,
          include_unconfirmed: true,
          include_stale: false,
        },
        runtime: { name: "openclaw" },
        flow_id: this.agentId,
        task_id: opts.sessionKey || null,
      });
    } catch (err) {
      opts.onDebug?.({ kind: "ob1.recall.error", message: String(err) });
      return [];
    }

    const memories: any[] = Array.isArray(response?.memories) ? response.memories : [];
    const hits = memories
      .map((m, i) => mapMemoryToHit(m, i, memories.length))
      .filter((h) => h.score >= minScore);

    opts.onDebug?.({
      kind: "ob1.recall.ok",
      query: trimmed.slice(0, 200),
      returned: hits.length,
      request_id: response?.request_id,
    });

    return hits;
  }

  status(): ProviderStatus {
    // backend: "ob1" is a custom discriminator — the host's clampResultsBy*
    // logic only branches on backend === "qmd"; everything else is treated
    // as a generic plugin-owned backend.
    return {
      backend: "ob1",
      ready: !this.closed,
      notes: [
        `OB1 active-memory backend (workspace=${this.workspaceId}, agent=${this.agentId})`,
      ],
    };
  }

  async probeVectorAvailability(): Promise<boolean> {
    if (this.closed) return false;
    try {
      await this.client.request("/health");
      return true;
    } catch {
      return false;
    }
  }

  async probeVectorStoreAvailability(): Promise<boolean> {
    return this.probeVectorAvailability();
  }

  hasIndexedContent(): boolean {
    // We can't cheaply tell from outside whether OB1 has rows. Return true so
    // the host doesn't short-circuit recall; an empty backend will surface as
    // "0 results" via search() instead.
    return true;
  }

  async warmSession(_sessionKey: string): Promise<void> {
    // No-op for HTTP-backed recall — nothing to pre-load locally.
  }

  async sync(_params?: unknown): Promise<{ ok: true }> {
    // No-op — OB1 is the source of truth, no local index to re-sync.
    return { ok: true };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

// ---------------------------------------------------------------------------
// MemoryPluginRuntime — provides per-agent SearchManager instances
// ---------------------------------------------------------------------------

export type RuntimeBackendConfig =
  | { backend: "builtin" }
  | { backend: "qmd"; qmd?: unknown };

export function createOB1Runtime(params: {
  buildClient: (agentId: string) => Promise<AgentMemoryClient>;
  workspaceIdFor: (agentId: string) => string;
}) {
  // One manager per agentId; cleared on closeAll. Cheap: each manager just
  // wraps an HTTP client (no persistent connections, no file watchers).
  const managers = new Map<string, OB1MemorySearchManager>();

  return {
    async getMemorySearchManager(args: { cfg: unknown; agentId: string; purpose?: string }) {
      const agentId = String(args.agentId || "default");
      let manager = managers.get(agentId);
      if (!manager) {
        let client: AgentMemoryClient;
        try {
          client = await params.buildClient(agentId);
        } catch (err) {
          return { manager: null, error: `OB1 client init failed: ${String(err)}` };
        }
        manager = new OB1MemorySearchManager(client, {
          workspaceId: params.workspaceIdFor(agentId),
          agentId,
        });
        managers.set(agentId, manager);
      }
      return { manager };
    },

    resolveMemoryBackendConfig(_args: { cfg: unknown; agentId: string }): RuntimeBackendConfig {
      // Host enums only allow "builtin" or "qmd" for this struct, but only
      // qmd-specific code paths actually inspect it. Returning "builtin" is
      // the safest no-op signal that we're not the qmd engine.
      return { backend: "builtin" };
    },

    async closeAllMemorySearchManagers(): Promise<void> {
      const entries = Array.from(managers.values());
      managers.clear();
      await Promise.all(entries.map((m) => m.close().catch(() => undefined)));
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function mapMemoryToHit(m: any, index: number, total: number): MemorySearchHit {
  // OB1 memory shape (from /recall response):
  //   { memory_id, summary, content, source, provenance, scope, use_policy,
  //     freshness, related_artifacts, ... }
  // Map to OpenClaw's chunk shape with synthetic path/lineage for an
  // HTTP-backed memory.
  const id = (m?.memory_id ?? m?.id ?? `idx-${index}`) as string;
  const snippet = String(m?.content ?? m?.summary ?? "").slice(0, 1000);
  // OB1 doesn't return per-row similarity in the v1 contract — derive a
  // monotonically decreasing score from rank order. The host's downstream
  // re-ranking applies its own decay/MMR if enabled.
  const score = total > 0 ? Math.max(0.0001, 1 - index / total) : 0;
  return {
    source: "memory",
    path: `openbrain://memory/${id}`,
    startLine: 1,
    endLine: 1,
    score,
    snippet,
  };
}
