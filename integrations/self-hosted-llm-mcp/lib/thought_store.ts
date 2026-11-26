import { createClient } from "@supabase/supabase-js";
import type { ListFilters, ListRow, StatsRow, StoreResult, ThoughtMatch, ThoughtRecord, ThoughtStore } from "./types.ts";

const notImplemented = () => Promise.reject(new Error("not implemented"));

export function createSupabaseThoughtStore(
  url: string,
  serviceRoleKey: string,
  fetchImpl: typeof fetch,
): ThoughtStore {
  const supabase = createClient(url, serviceRoleKey, {
    global: { fetch: fetchImpl },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    async fetchThought(id: string): Promise<StoreResult<ThoughtRecord>> {
      const { data, error } = await supabase
        .from("thoughts")
        .select("id, content, metadata, created_at, updated_at")
        .eq("id", id)
        .single();
      if (error) return { error: error.message };
      return { data: data as ThoughtRecord };
    },
    async matchThoughts(embedding: number[], threshold: number, count: number): Promise<StoreResult<ThoughtMatch[]>> {
      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: count,
        filter: {},
      });
      if (error) return { error: error.message };
      return { data: data as ThoughtMatch[] };
    },
    async listThoughts(filters: ListFilters): Promise<StoreResult<ListRow[]>> {
      let q = supabase
        .from("thoughts")
        .select("content, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(filters.limit);
      if (filters.type) q = q.contains("metadata", { type: filters.type });
      if (filters.topic) q = q.contains("metadata", { topics: [filters.topic] });
      if (filters.person) q = q.contains("metadata", { people: [filters.person] });
      if (filters.days) {
        const since = new Date();
        since.setDate(since.getDate() - filters.days);
        q = q.gte("created_at", since.toISOString());
      }
      const { data, error } = await q;
      if (error) return { error: error.message };
      return { data: data as ListRow[] };
    },
    async stats(): Promise<StoreResult<{ count: number | null; rows: StatsRow[] }>> {
      const { count } = await supabase
        .from("thoughts")
        .select("*", { count: "exact", head: true });
      const { data } = await supabase
        .from("thoughts")
        .select("metadata, created_at")
        .order("created_at", { ascending: false });
      return { data: { count, rows: data as StatsRow[] } };
    },
    upsertThought: notImplemented,
    setEmbedding: notImplemented,
    readBack: notImplemented,
    deleteIfInsertedByCall: notImplemented,
    countAll: notImplemented,
    countWithModel: notImplemented,
  };
}
