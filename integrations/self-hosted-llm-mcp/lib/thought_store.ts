import { createClient } from "@supabase/supabase-js";
import type { StoreResult, ThoughtMatch, ThoughtRecord, ThoughtStore } from "./types.ts";

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
    listThoughts: notImplemented,
    stats: notImplemented,
    upsertThought: notImplemented,
    setEmbedding: notImplemented,
    readBack: notImplemented,
    deleteIfInsertedByCall: notImplemented,
    countAll: notImplemented,
    countWithModel: notImplemented,
  };
}
