import "server-only";
import type {
  Thought,
  BrowseResponse,
  StatsResponse,
  Reflection,
  IngestionJob,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

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
  id: number,
  excludeRestricted: boolean = true
): Promise<Thought> {
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
