import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import type { ListFilters, ListRow, StatsRow, ReadBack, StoreResult, ThoughtMatch, ThoughtRecord, ThoughtStore } from "./types.ts";

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
      const { count, error: countError } = await supabase
        .from("thoughts")
        .select("*", { count: "exact", head: true });
      if (countError) return { error: countError.message };
      const { data, error } = await supabase
        .from("thoughts")
        .select("metadata, created_at")
        .order("created_at", { ascending: false });
      if (error) return { error: error.message };
      return { data: { count, rows: data as StatsRow[] } };
    },
    async upsertThought(content: string, metadata: Record<string, unknown>): Promise<StoreResult<{ id: string }>> {
      const { data, error } = await supabase.rpc("upsert_thought", {
        p_content: content,
        p_payload: { metadata },
      });
      if (error) return { error: error.message };
      return { data: { id: data?.id } };
    },
    async setEmbedding(id: string, embedding: number[]): Promise<StoreResult<null>> {
      const { error } = await supabase.from("thoughts").update({ embedding }).eq("id", id);
      if (error) return { error: error.message };
      return { data: null };
    },
    async readBack(id: string): Promise<StoreResult<ReadBack>> {
      const { data, error } = await supabase
        .from("thoughts")
        .select("created_at, updated_at, embedding")
        .eq("id", id)
        .single();
      if (error) return { error: error.message };
      return {
        data: { createdAt: data.created_at, updatedAt: data.updated_at, embeddingIsNull: data.embedding == null },
      };
    },
    async deleteIfInsertedByCall(id: string, timestamp: string): Promise<StoreResult<{ deleted: boolean }>> {
      const { data, error } = await supabase
        .from("thoughts")
        .delete()
        .eq("id", id)
        .is("embedding", null)
        .eq("created_at", timestamp)
        .eq("updated_at", timestamp)
        .select("id");
      if (error) return { error: error.message };
      return { data: { deleted: (data?.length ?? 0) > 0 } };
    },
    async countAll(): Promise<StoreResult<number>> {
      const { count, error } = await supabase.from("thoughts").select("*", { count: "exact", head: true });
      if (error) return { error: error.message };
      return { data: count as number };
    },
    async countWithModel(model: string): Promise<StoreResult<number>> {
      const { count, error } = await supabase
        .from("thoughts")
        .select("*", { count: "exact", head: true })
        .eq("metadata->>embedding_model", model);
      if (error) return { error: error.message };
      return { data: count as number };
    },
  };
}
