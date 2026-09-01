import { QDRANT_URL } from "./config.js";

export interface QdrantFilter {
  must?: unknown[];
  should?: unknown[];
  must_not?: unknown[];
}

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function fetchWithRetry(
  url: string,
  options: RequestInit
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      lastError = err;
      // Only retry on network / connection errors (fetch throws), not HTTP errors.
      if (attempt === 0) {
        console.warn(`[qdrant] Network error on attempt ${attempt + 1}, retrying…`, err);
        continue;
      }
    }
  }
  throw lastError;
}

async function qdrantRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const url = `${QDRANT_URL}${path}`;
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  const res = await fetchWithRetry(url, options);

  if (!res.ok) {
    const text = await res.text();
    console.error(`[qdrant] ${method} ${url} -> ${res.status}: ${text}`);
    return { __status: res.status, __body: text };
  }

  return res.json();
}

function isAlreadyExists(result: unknown): boolean {
  if (
    typeof result === "object" &&
    result !== null &&
    "__status" in result &&
    "__body" in result
  ) {
    const r = result as { __status: number; __body: string };
    return (r.__status === 400 || r.__status === 409) && r.__body.includes("already exists");
  }
  return false;
}

function assertSuccess(result: unknown, method: string, path: string): void {
  if (
    typeof result === "object" &&
    result !== null &&
    "__status" in result
  ) {
    throw new Error(
      `[qdrant] ${method} ${path} failed with status ${(result as { __status: number }).__status}`
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function ensureCollection(): Promise<void> {
  const result = await qdrantRequest("PUT", "/collections/thoughts", {
    vectors: { size: 1024, distance: "Cosine" },
  });

  if (isAlreadyExists(result)) return;
  assertSuccess(result, "PUT", "/collections/thoughts");
}

export async function ensurePayloadIndexes(): Promise<void> {
  const indexes: Array<{ field_name: string; field_schema: string }> = [
    { field_name: "owner_id", field_schema: "keyword" },
    { field_name: "visibility", field_schema: "keyword" },
    { field_name: "shared_with", field_schema: "keyword" },
    { field_name: "type", field_schema: "keyword" },
    { field_name: "source", field_schema: "keyword" },
    { field_name: "created_at", field_schema: "datetime" },
    { field_name: "topics", field_schema: "keyword" },
    { field_name: "people", field_schema: "keyword" },
  ];

  for (const index of indexes) {
    const result = await qdrantRequest(
      "PUT",
      "/collections/thoughts/index",
      index
    );
    if (isAlreadyExists(result)) continue;
    assertSuccess(result, "PUT", "/collections/thoughts/index");
  }
}

export async function upsertPoint(point: QdrantPoint): Promise<void> {
  const result = await qdrantRequest(
    "PUT",
    "/collections/thoughts/points?wait=true",
    {
      points: [
        {
          id: point.id,
          vector: point.vector,
          payload: point.payload,
        },
      ],
    }
  );
  assertSuccess(result, "PUT", "/collections/thoughts/points");
}

export async function searchPoints(params: {
  vector: number[];
  filter: QdrantFilter;
  limit: number;
  score_threshold: number;
}): Promise<Array<{ id: string; score: number; payload: Record<string, unknown> }>> {
  const result = await qdrantRequest(
    "POST",
    "/collections/thoughts/points/search",
    {
      vector: params.vector,
      filter: params.filter,
      limit: params.limit,
      score_threshold: params.score_threshold,
      with_payload: true,
    }
  ) as { result: Array<{ id: string; score: number; payload: Record<string, unknown> }> };

  assertSuccess(result, "POST", "/collections/thoughts/points/search");
  return result.result;
}

export async function scrollPoints(params: {
  filter: QdrantFilter;
  limit: number;
  order_by?: { key: string; direction: string };
  offset?: string | null;
}): Promise<Array<{ id: string; payload: Record<string, unknown> }>> {
  const body: Record<string, unknown> = {
    filter: params.filter,
    limit: params.limit,
    order_by: params.order_by ?? { key: "created_at", direction: "desc" },
    with_payload: true,
    ...(params.offset ? { offset: params.offset } : {}),
  };

  const result = await qdrantRequest(
    "POST",
    "/collections/thoughts/points/scroll",
    body
  ) as { result: { points: Array<{ id: string; payload: Record<string, unknown> }> } };

  assertSuccess(result, "POST", "/collections/thoughts/points/scroll");
  return result.result.points;
}

export async function countPoints(filter: QdrantFilter): Promise<number> {
  const result = await qdrantRequest(
    "POST",
    "/collections/thoughts/points/count",
    {
      filter,
      exact: true,
    }
  ) as { result: { count: number } };

  assertSuccess(result, "POST", "/collections/thoughts/points/count");
  return result.result.count;
}

export async function setPayload(
  id: string,
  payload: Record<string, unknown>
): Promise<void> {
  const result = await qdrantRequest(
    "POST",
    "/collections/thoughts/points/payload?wait=true",
    {
      payload,
      points: [id],
    }
  );
  assertSuccess(result, "POST", "/collections/thoughts/points/payload");
}

export async function getPoint(
  id: string
): Promise<{ id: string; payload: Record<string, unknown> } | null> {
  const url = `${QDRANT_URL}/collections/thoughts/points/${id}`;
  const options: RequestInit = {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  };

  const res = await fetchWithRetry(url, options);

  if (res.status === 404) return null;

  if (!res.ok) {
    const text = await res.text();
    console.error(`[qdrant] GET ${url} -> ${res.status}: ${text}`);
    throw new Error(`[qdrant] GET /collections/thoughts/points/${id} failed with status ${res.status}`);
  }

  const data = await res.json() as { result: { id: string; payload: Record<string, unknown> } };
  return { id: data.result.id, payload: data.result.payload };
}
