import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Thought = {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type Filters = {
  source?: string;
  project?: string;
};

export type Cursor = { created_at: string; id: string } | null;

const PAGE_SIZE = 50;

let _client: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

export function encodeCursor(c: { created_at: string; id: string }): string {
  return Buffer.from(`${c.created_at}|${c.id}`).toString("base64url");
}

export function decodeCursor(s: string | undefined): Cursor {
  if (!s) return null;
  try {
    const decoded = Buffer.from(s, "base64url").toString();
    const [created_at, id] = decoded.split("|");
    if (!created_at || !id) return null;
    return { created_at, id };
  } catch {
    return null;
  }
}

export async function listThoughts(
  filters: Filters,
  cursor: Cursor
): Promise<{ rows: Thought[]; nextCursor: string | null }> {
  let q = client()
    .from("thoughts")
    .select("id, content, metadata, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (filters.source) {
    q = q.eq("metadata->>source", filters.source);
  }
  if (filters.project && filters.source) {
    const projectKey = `${filters.source}_project`;
    q = q.eq(`metadata->>${projectKey}`, filters.project);
  }
  if (cursor) {
    q = q.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`
    );
  }

  const { data, error } = await q;
  if (error) throw new Error(`listThoughts: ${error.message}`);
  const rows = (data ?? []) as Thought[];
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ created_at: last.created_at, id: last.id }) : null;
  return { rows: page, nextCursor };
}

export type FilterFacets = {
  sources: string[];
  projectsBySource: Record<string, string[]>;
};

export async function distinctMetadataValues(): Promise<FilterFacets> {
  const { data: rows, error } = await client()
    .from("thoughts")
    .select("metadata")
    .is("deleted_at", null)
    .limit(10000);
  if (error) throw new Error(`distinctMetadataValues: ${error.message}`);

  const sources = new Set<string>();
  const projectsBySource: Record<string, Set<string>> = {};
  for (const r of rows ?? []) {
    const md = (r as { metadata: Record<string, unknown> }).metadata ?? {};
    const source = typeof md.source === "string" ? md.source : null;
    if (!source) continue;
    sources.add(source);
    const projectKey = `${source}_project`;
    const project = typeof md[projectKey] === "string" ? (md[projectKey] as string) : null;
    if (project) {
      if (!projectsBySource[source]) projectsBySource[source] = new Set();
      projectsBySource[source].add(project);
    }
  }
  return {
    sources: Array.from(sources).sort(),
    projectsBySource: Object.fromEntries(
      Object.entries(projectsBySource).map(([k, v]) => [k, Array.from(v).sort()])
    ),
  };
}

export async function getThought(id: string): Promise<Thought | null> {
  const { data, error } = await client()
    .from("thoughts")
    .select("id, content, metadata, created_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getThought: ${error.message}`);
  return (data as Thought | null) ?? null;
}

export async function getNeighbors(id: string, k = 5): Promise<Thought[]> {
  const { data: src, error: srcErr } = await client()
    .from("thoughts")
    .select("embedding")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (srcErr) throw new Error(`getNeighbors src: ${srcErr.message}`);
  const embedding = (src as { embedding: number[] | string | null } | null)?.embedding;
  if (!embedding) return [];

  // match_thoughts is the core RPC and doesn't filter on deleted_at. Pull
  // extra candidates and post-filter against a visible-id set so soft-deleted
  // rows can't appear as neighbors.
  const { data, error } = await client().rpc("match_thoughts", {
    query_embedding: embedding as unknown as number[],
    match_threshold: 0.7,
    match_count: k * 4 + 1,
    filter: {},
  });
  if (error) throw new Error(`getNeighbors match: ${error.message}`);
  type MatchRow = Thought & { similarity: number };
  const rows = (data ?? []) as MatchRow[];
  const candidateIds = rows.map((r) => r.id).filter((rid) => rid !== id);
  if (candidateIds.length === 0) return [];

  const { data: visible, error: visErr } = await client()
    .from("thoughts")
    .select("id")
    .in("id", candidateIds)
    .is("deleted_at", null);
  if (visErr) throw new Error(`getNeighbors visible: ${visErr.message}`);
  const visibleSet = new Set((visible ?? []).map((r) => (r as { id: string }).id));

  return rows
    .filter((r) => r.id !== id && visibleSet.has(r.id))
    .slice(0, k)
    .map(({ id, content, metadata, created_at }) => ({ id, content, metadata, created_at }));
}
