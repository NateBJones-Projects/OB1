export interface Thought {
  id: number;
  uuid?: string;
  content: string;
  type: string;
  source_type: string;
  importance: number;
  quality_score: number;
  sensitivity_tier: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface IngestionJob {
  id: number;
  source_label: string;
  status: string;
  extracted_count: number;
  added_count: number;
  skipped_count: number;
  appended_count: number;
  revised_count: number;
  created_at: string;
  completed_at: string | null;
}

export interface BrowseResponse {
  data: Thought[];
  total: number;
  page: number;
  per_page: number;
}

export interface StatsResponse {
  total_thoughts: number;
  window_days: number | "all";
  types: Record<string, number>;
  top_topics: Array<{ topic: string; count: number }>;
}

export interface DuplicatePair {
  thought_id_a: number;
  thought_id_b: number;
  similarity: number;
  content_a: string;
  content_b: string;
  type_a: string;
  type_b: string;
  quality_a: number;
  quality_b: number;
  created_a: string;
  created_b: string;
}

export interface DuplicatesResponse {
  pairs: DuplicatePair[];
  threshold: number;
  limit: number;
  offset: number;
}

/** Parsed metadata from ingestion_items.metadata JSONB. All fields optional for backwards compat. */
export interface IngestionItemMeta {
  type?: string;
  importance?: number;
  tags?: string[];
  source_snippet?: string;
}

export interface IngestionItem {
  id: number;
  job_id: number;
  /** The extracted thought content (DB column: extracted_content) */
  content: string;
  action: string; // add, skip, create_revision, append_evidence
  reason: string | null;
  status: string;
  matched_thought_id: number | null;
  similarity_score: number | null;
  result_thought_id: number | null;
  /** Parsed metadata — type, importance, tags, source_snippet */
  meta: IngestionItemMeta;
}

export interface IngestionJobDetail {
  job: IngestionJob;
  items: IngestionItem[];
}

export type AddToBrainMode = "auto" | "single" | "extract";

export interface AddToBrainResult {
  path: "single" | "extract";
  thought_id?: number;
  job_id?: number;
  type?: string;
  status?: string;
  extracted_count?: number | null;
  message: string;
}
