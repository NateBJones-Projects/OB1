/**
 * Reflection MCP tool handlers for Open Brain.
 *
 * Three tools for working with the reflections schema:
 *   1. capture_reflection  — Create a structured reasoning trace
 *   2. get_reflection       — Fetch a reflection by ID
 *   3. search_reflections   — Semantic search over past reasoning
 *
 * Prerequisites:
 *   - reflections schema applied (schemas/reflections/migration.sql)
 *   - Supabase client configured with service_role key
 *   - Embedding function available (OpenAI text-embedding-3-small or compatible)
 *
 * Integration: Register these handlers with your MCP server's tool list.
 * Each handler accepts validated parameters and returns structured JSON.
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// ── Types ───────────────────────────────────────────────────────────────────

type ReflectionType =
  | "decision"
  | "analysis"
  | "evaluation"
  | "planning"
  | "retrospective";

interface CaptureReflectionParams {
  thought_id?: string;
  trigger_context: string;
  options?: unknown[];
  factors?: unknown[];
  conclusion: string;
  confidence?: number;
  reflection_type?: ReflectionType;
  metadata?: Record<string, unknown>;
}

interface SearchReflectionsParams {
  query: string;
  reflection_type?: ReflectionType;
  limit?: number;
  min_similarity?: number;
}

interface GetReflectionParams {
  id: string;
}

// ── Embedding (adapt to your provider) ──────────────────────────────────────

/**
 * Generate a vector embedding for the given text.
 * Replace this with your preferred embedding provider.
 */
async function embedText(
  text: string,
  apiKey: string,
): Promise<number[] | null> {
  const truncated = text.slice(0, 8000);
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: truncated,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

// ── Tool Handlers ───────────────────────────────────────────────────────────

/**
 * capture_reflection — Create a structured reasoning trace linked to a thought.
 */
export async function captureReflection(
  params: CaptureReflectionParams,
  supabase: SupabaseClient,
  openaiApiKey: string,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const {
    thought_id,
    trigger_context,
    options = [],
    factors = [],
    conclusion,
    confidence,
    reflection_type = "decision",
    metadata = {},
  } = params;

  if (!trigger_context?.trim()) {
    return { success: false, error: "trigger_context is required" };
  }
  if (!conclusion?.trim()) {
    return { success: false, error: "conclusion is required" };
  }

  // Generate embedding from trigger + conclusion for semantic search
  const embeddingText = `${trigger_context} ${conclusion}`.slice(0, 8000);
  const embedding = await embedText(embeddingText, openaiApiKey);

  const { data, error } = await supabase.rpc("upsert_reflection", {
    p_thought_id: thought_id ?? null,
    p_trigger_context: trigger_context.trim(),
    p_options: options,
    p_factors: factors,
    p_conclusion: conclusion.trim(),
    p_confidence: confidence ?? null,
    p_reflection_type: reflection_type,
    p_embedding: embedding,
    p_metadata: metadata,
  });

  if (error) {
    return { success: false, error: `upsert_reflection failed: ${error.message}` };
  }

  return {
    success: true,
    data: {
      reflection_id: data,
      thought_id,
      reflection_type,
    },
  };
}

/**
 * get_reflection — Fetch a single reflection by its ID.
 */
export async function getReflection(
  params: GetReflectionParams,
  supabase: SupabaseClient,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const { id } = params;

  if (!id?.trim()) {
    return { success: false, error: "id is required" };
  }

  const { data, error } = await supabase
    .from("reflections")
    .select(
      "id, thought_id, trigger_context, options, factors, conclusion, confidence, reflection_type, metadata, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return { success: false, error: `get_reflection query failed: ${error.message}` };
  }
  if (!data) {
    return { success: false, error: `Reflection ${id} not found` };
  }

  return { success: true, data };
}

/**
 * search_reflections — Semantic search over past reasoning traces.
 */
export async function searchReflections(
  params: SearchReflectionsParams,
  supabase: SupabaseClient,
  openaiApiKey: string,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const {
    query,
    reflection_type,
    limit = 8,
    min_similarity = 0.3,
  } = params;

  if (!query || query.length < 2) {
    return { success: false, error: "query must be at least 2 characters" };
  }

  const queryEmbedding = await embedText(query, openaiApiKey);
  if (!queryEmbedding) {
    return { success: false, error: "Failed to generate query embedding" };
  }

  const { data, error } = await supabase.rpc("match_reflections", {
    query_embedding: queryEmbedding,
    match_threshold: min_similarity,
    match_count: Math.min(limit, 50),
    p_reflection_type: reflection_type ?? null,
  });

  if (error) {
    return { success: false, error: `match_reflections failed: ${error.message}` };
  }

  return {
    success: true,
    data: {
      results: data ?? [],
      count: (data ?? []).length,
    },
  };
}
