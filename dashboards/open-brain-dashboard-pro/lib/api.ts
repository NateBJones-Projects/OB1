import "server-only";
import type {
  Thought,
  BrowseResponse,
  StatsResponse,
  IngestionJob,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
if (!API_URL) {
  throw new Error(
    "NEXT_PUBLIC_API_URL env var is required — set it to your Open Brain REST API base URL"
  );
}

// WR-06: validate NEXT_PUBLIC_API_URL shape at module load. Refuse non-https
// URLs (except localhost for dev) to prevent the cookie-authed API key from
// being fanned out to an attacker-controlled host via a misconfigured env var.
try {
  const parsed = new URL(API_URL);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error(
      "NEXT_PUBLIC_API_URL must use https:// (or http://localhost for dev)"
    );
  }
} catch (err) {
  throw new Error(
    `NEXT_PUBLIC_API_URL is not a valid URL: ${err instanceof Error ? err.message : String(err)}`
  );
}

export class ApiError extends Error {
  /**
   * REVIEW-CODEX-2-P2: `message` is a short, generic, user-safe string ("API 500").
   * The full upstream response body lives on `upstreamBody` and MUST NOT be
   * rendered into HTML — it frequently contains SQL errors, schema details,
   * or internal stack traces. Server code should `console.error` the
   * upstream body for debugging but only ever render `message` (or a
   * hand-written fallback) in the response to the client.
   */
  upstreamBody: string;
  constructor(message: string, public status: number, upstreamBody: string = "") {
    super(message);
    this.name = "ApiError";
    this.upstreamBody = upstreamBody;
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
    // REVIEW-CODEX-2-P2: generic message for rendering; raw upstream body is
    // stashed on .upstreamBody for server-side logging only. Never render it.
    throw new ApiError(`Upstream API error (${res.status})`, res.status, text);
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
  // IN-07: use `!== undefined` for numeric filters so zero is preserved.
  // `page=0` is meaningless but `importance_min=0` is "include Noise tier".
  if (params?.page !== undefined) sp.set("page", String(params.page));
  if (params?.per_page !== undefined)
    sp.set("per_page", String(params.per_page));
  if (params?.type) sp.set("type", params.type);
  if (params?.source_type) sp.set("source_type", params.source_type);
  if (params?.importance_min !== undefined)
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
  data: { content?: string; type?: string; importance?: number }
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

export async function fetchDuplicates(
  apiKey: string,
  params?: { threshold?: number; limit?: number; offset?: number }
): Promise<import("./types").DuplicatesResponse> {
  const sp = new URLSearchParams();
  // IN-07: preserve zero/explicit numeric values
  if (params?.threshold !== undefined)
    sp.set("threshold", String(params.threshold));
  if (params?.limit !== undefined) sp.set("limit", String(params.limit));
  if (params?.offset !== undefined) sp.set("offset", String(params.offset));
  const qs = sp.toString();
  return apiFetch(apiKey, `/duplicates${qs ? `?${qs}` : ""}`);
}

export interface DuplicateResolveResult {
  action: string;
  survivor_id: number | null;
  loser_id: number | null;
  reattached: {
    reflections: number;
    thought_entities: number;
  };
}

export async function resolveDuplicate(
  apiKey: string,
  params: {
    thought_id_a: number;
    thought_id_b: number;
    action: "keep_a" | "keep_b" | "keep_both";
  }
): Promise<DuplicateResolveResult> {
  return apiFetch<DuplicateResolveResult>(apiKey, "/duplicates/resolve", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function deleteThought(
  apiKey: string,
  id: number
): Promise<void> {
  await apiFetch<unknown>(apiKey, `/thought/${id}`, { method: "DELETE" });
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
  // IN-07: preserve explicit numeric values including zero.
  if (days !== undefined) sp.set("days", String(days));
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

export async function fetchIngestionJobs(
  apiKey: string
): Promise<IngestionJob[]> {
  // IN-06: Tolerate both shapes — bare array OR { jobs: [...], count: N }
  const data = await apiFetch<unknown>(apiKey, "/ingestion-jobs");
  if (Array.isArray(data)) return data as IngestionJob[];
  if (data && typeof data === "object" && Array.isArray((data as { jobs?: unknown }).jobs)) {
    return (data as { jobs: IngestionJob[] }).jobs;
  }
  return [];
}

export async function triggerIngest(
  apiKey: string,
  text: string,
  opts?: { dry_run?: boolean; skip_classification?: boolean }
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
