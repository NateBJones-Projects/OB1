import "server-only";
import type {
  Thought,
  BrowseResponse,
  StatsResponse,
  Reflection,
  IngestionJob,
} from "./types";
import { KANBAN_TYPES } from "./types";
import { mcpFetchThought, mcpThoughtStats } from "./openBrainMcp";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;
const MCP_URL = process.env.OPEN_BRAIN_MCP_URL;
const LEGACY_MCP_SERVER_URL = MCP_URL?.replace(/open-brain-mcp\/?$/, "mcp-server");

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ApiError";
  }
}

function headers(apiKey: string): HeadersInit {
  return {
    "x-brain-key": apiKey,
    "Content-Type": "application/json",
  };
}

type LegacyThoughtRecord = {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function normalizeThoughtType(metadata: Record<string, unknown> | undefined): string {
  const type = metadata?.type;
  return typeof type === "string" && type.length > 0 ? type : "reference";
}

function normalizeImportance(metadata: Record<string, unknown> | undefined): number {
  const raw = metadata?.importance;
  if (typeof raw === "number") {
    return Math.min(Math.max(Math.round(raw), 1), 5);
  }
  return 0;
}

function toThought(record: LegacyThoughtRecord): Thought {
  const metadata = record.metadata ?? {};
  const sensitivityTier = metadata.sensitivity_tier;
  const status = metadata.status;
  const sourceType = metadata.source;

  return {
    id: record.id,
    content: record.content,
    type: normalizeThoughtType(metadata),
    source_type: typeof sourceType === "string" ? sourceType : "",
    importance: normalizeImportance(metadata),
    quality_score: 0,
    sensitivity_tier:
      typeof sensitivityTier === "string" ? sensitivityTier : "standard",
    metadata,
    created_at: record.created_at,
    updated_at: record.updated_at,
    status: typeof status === "string" ? status : null,
    status_updated_at: null,
  };
}

function summarizeThoughts(thoughts: Thought[]): StatsResponse {
  const types: Record<string, number> = {};
  const topics: Record<string, number> = {};

  for (const thought of thoughts) {
    types[thought.type] = (types[thought.type] ?? 0) + 1;

    const thoughtTopics = thought.metadata.topics;
    if (Array.isArray(thoughtTopics)) {
      for (const topic of thoughtTopics) {
        if (typeof topic === "string" && topic.trim()) {
          topics[topic] = (topics[topic] ?? 0) + 1;
        }
      }
    }
  }

  return {
    total_thoughts: thoughts.length,
    window_days: "all",
    types,
    top_topics: Object.entries(topics)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, count]) => ({ topic, count })),
  };
}

function parseMcpStatsReport(report: string): StatsResponse {
  const lines = report.split(/\r?\n/);
  const stats: StatsResponse = {
    total_thoughts: 0,
    window_days: "all",
    types: {},
    top_topics: [],
  };

  let section: "types" | "topics" | "people" | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const totalMatch = line.match(/^Total thoughts:\s*(\d+)/i);
    if (totalMatch) {
      stats.total_thoughts = Number(totalMatch[1]);
      continue;
    }

    if (/^Types:/i.test(line)) {
      section = "types";
      continue;
    }
    if (/^Top topics:/i.test(line)) {
      section = "topics";
      continue;
    }
    if (/^People mentioned:/i.test(line)) {
      section = "people";
      continue;
    }

    const entryMatch = line.match(/^(.+):\s*(\d+)$/);
    if (!entryMatch) continue;

    const label = entryMatch[1].trim();
    const count = Number(entryMatch[2]);
    if (section === "types") {
      stats.types[label] = count;
    }
    if (section === "topics") {
      stats.top_topics.push({ topic: label, count });
    }
  }

  return stats;
}

async function fetchLegacyRecentThoughts(apiKey: string): Promise<Thought[]> {
  if (!LEGACY_MCP_SERVER_URL) {
    throw new ApiError("Legacy MCP browse endpoint is not configured", 500);
  }

  const url = new URL(LEGACY_MCP_SERVER_URL);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(`API ${res.status}: ${text || res.statusText}`, res.status);
  }

  const data = (await res.json()) as LegacyThoughtRecord[];
  return data.map(toThought);
}

async function apiFetch<T>(
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...headers(apiKey), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(`API ${res.status}: ${text || res.statusText}`, res.status);
  }
  return res.json();
}

export async function fetchThoughts(
  apiKey: string,
  params?: {
    page?: number;
    per_page?: number;
    type?: string;
    source_type?: string;
    importance_min?: number;
    quality_score_max?: number;
    sort?: string;
    order?: string;
    exclude_restricted?: boolean;
  }
): Promise<BrowseResponse> {
  if (MCP_URL) {
    const recent = await fetchLegacyRecentThoughts(apiKey);
    const filtered = recent.filter((thought) => {
      if (params?.type && thought.type !== params.type) return false;
      if (params?.source_type && thought.source_type !== params.source_type) return false;
      if (
        params?.importance_min !== undefined &&
        thought.importance < params.importance_min
      ) {
        return false;
      }
      return true;
    });

    const page = params?.page ?? 1;
    const perPage = params?.per_page ?? 25;
    const start = (page - 1) * perPage;
    const data = filtered.slice(start, start + perPage);

    return {
      data,
      total: filtered.length,
      page,
      per_page: perPage,
    };
  }

  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.per_page) sp.set("per_page", String(params.per_page));
  if (params?.type) sp.set("type", params.type);
  if (params?.source_type) sp.set("source_type", params.source_type);
  if (params?.importance_min)
    sp.set("importance_min", String(params.importance_min));
  if (params?.quality_score_max !== undefined)
    sp.set("quality_score_max", String(params.quality_score_max));
  if (params?.sort) sp.set("sort", params.sort);
  if (params?.order) sp.set("order", params.order);
  if (params?.exclude_restricted !== undefined)
    sp.set("exclude_restricted", String(params.exclude_restricted));
  const qs = sp.toString();
  return apiFetch<BrowseResponse>(apiKey, `/thoughts${qs ? `?${qs}` : ""}`);
}

export async function fetchThought(
  apiKey: string,
  id: string | number,
  excludeRestricted: boolean = true
): Promise<Thought> {
  if (MCP_URL) {
    const thought = await mcpFetchThought(apiKey, String(id));
    return toThought({
      id: thought.id,
      content: thought.text,
      metadata: thought.metadata,
      created_at: thought.metadata.created_at ?? new Date().toISOString(),
      updated_at:
        thought.metadata.updated_at ?? thought.metadata.created_at ?? new Date().toISOString(),
    });
  }

  const qs = excludeRestricted ? "" : "?exclude_restricted=false";
  return apiFetch<Thought>(apiKey, `/thought/${id}${qs}`);
}

export async function updateThought(
  apiKey: string,
  id: number,
  data: { content?: string; type?: string; importance?: number; status?: string | null }
): Promise<{ id: number; action: string; message: string }> {
  return apiFetch<{ id: number; action: string; message: string }>(
    apiKey,
    `/thought/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(data),
    }
  );
}

export async function fetchKanbanThoughts(
  apiKey: string,
  params?: {
    status?: string;
    exclude_restricted?: boolean;
  }
): Promise<Thought[]> {
  if (MCP_URL) {
    const allowedStatuses = new Set(
      params?.status?.split(",").map((status) => status.trim()).filter(Boolean)
    );
    const recent = await fetchLegacyRecentThoughts(apiKey);
    return recent
      .filter((thought) => KANBAN_TYPES.includes(thought.type))
      .filter((thought) => {
        if (allowedStatuses.size === 0) return true;
        return allowedStatuses.has(thought.status ?? "new");
      })
      .sort((a, b) => b.importance - a.importance);
  }

  // Fetch tasks and ideas separately (API only supports single type filter)
  const results: Thought[] = [];
  for (const thoughtType of ["task", "idea"]) {
    const sp = new URLSearchParams();
    sp.set("per_page", "100");
    sp.set("sort", "importance");
    sp.set("order", "desc");
    sp.set("type", thoughtType);
    if (params?.status) sp.set("status", params.status);
    if (params?.exclude_restricted !== undefined)
      sp.set("exclude_restricted", String(params.exclude_restricted));
    const qs = sp.toString();
    const data = await apiFetch<BrowseResponse>(apiKey, `/thoughts?${qs}`);
    results.push(...data.data);
  }
  // Re-sort combined results by importance desc
  results.sort((a, b) => b.importance - a.importance);
  return results;
}

export async function fetchDuplicates(
  apiKey: string,
  params?: { threshold?: number; limit?: number; offset?: number }
): Promise<import("./types").DuplicatesResponse> {
  const sp = new URLSearchParams();
  if (params?.threshold) sp.set("threshold", String(params.threshold));
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.offset !== undefined) sp.set("offset", String(params.offset));
  const qs = sp.toString();
  return apiFetch(apiKey, `/duplicates${qs ? `?${qs}` : ""}`);
}

export async function deleteThought(
  apiKey: string,
  id: number
): Promise<void> {
  const url = `${API_URL}/thought/${id}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: headers(apiKey),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(`API ${res.status}: ${text || res.statusText}`, res.status);
  }
}

export interface SearchResponse {
  results: (Thought & { similarity?: number; rank?: number })[];
  count: number;
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  mode: string;
}

export async function searchThoughts(
  apiKey: string,
  query: string,
  mode: "semantic" | "text" = "semantic",
  limit: number = 25,
  page: number = 1,
  excludeRestricted: boolean = true
): Promise<SearchResponse> {
  return apiFetch(apiKey, `/search`, {
    method: "POST",
    body: JSON.stringify({ query, mode, limit, page, exclude_restricted: excludeRestricted }),
  });
}

export async function fetchStats(
  apiKey: string,
  days?: number,
  excludeRestricted: boolean = true
): Promise<StatsResponse> {
  if (MCP_URL) {
    try {
      return parseMcpStatsReport(await mcpThoughtStats(apiKey));
    } catch {
      return summarizeThoughts(await fetchLegacyRecentThoughts(apiKey));
    }
  }

  const sp = new URLSearchParams();
  if (days) sp.set("days", String(days));
  if (!excludeRestricted) sp.set("exclude_restricted", "false");
  const qs = sp.toString();
  return apiFetch<StatsResponse>(apiKey, `/stats${qs ? `?${qs}` : ""}`);
}

export interface CaptureResult {
  thought_id: number;
  action: string;
  type: string;
  sensitivity_tier: string;
  content_fingerprint: string;
  message: string;
}

export async function captureThought(
  apiKey: string,
  content: string
): Promise<CaptureResult> {
  return apiFetch<CaptureResult>(apiKey, "/capture", {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export async function fetchReflections(
  apiKey: string,
  thoughtId: number
): Promise<Reflection[]> {
  const data = await apiFetch<{ reflections: Reflection[] }>(
    apiKey,
    `/thought/${thoughtId}/reflection`
  );
  return data.reflections;
}

export async function fetchIngestionJobs(
  apiKey: string
): Promise<IngestionJob[]> {
  const data = await apiFetch<{ jobs: IngestionJob[]; count: number }>(
    apiKey,
    "/ingestion-jobs"
  );
  return data.jobs;
}

export async function triggerIngest(
  apiKey: string,
  text: string,
  opts?: { dry_run?: boolean }
): Promise<{ job_id: number; status: string }> {
  return apiFetch(apiKey, "/ingest", {
    method: "POST",
    body: JSON.stringify({ text, ...opts }),
  });
}

export async function checkHealth(
  apiKey: string
): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(apiKey, "/health");
}
