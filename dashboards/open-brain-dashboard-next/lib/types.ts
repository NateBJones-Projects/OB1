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
  status: string | null;
  status_updated_at: string | null;
}

// --- Thought type constants ---

export const THOUGHT_TYPES = [
  "task",
  "idea",
  "observation",
  "reference",
  "person_note",
  "decision",
  "lesson",
  "meeting",
  "journal",
] as const;

/** Only these types participate in the kanban workflow */
export const KANBAN_TYPES: string[] = ["task", "idea"];

// --- Kanban workflow constants ---

export const KANBAN_STATUSES = ["new", "planning", "active", "review", "done"] as const;
export type KanbanStatus = (typeof KANBAN_STATUSES)[number];

export const KANBAN_LABELS: Record<KanbanStatus, string> = {
  new: "New",
  planning: "Planning",
  active: "Active",
  review: "Review",
  done: "Done",
};

export const KANBAN_COLORS: Record<KanbanStatus, string> = {
  new: "slate",
  planning: "violet",
  active: "blue",
  review: "amber",
  done: "emerald",
};

export const PRIORITY_LEVELS = [
  { label: "Critical", min: 80, value: 90, color: "bg-red-500", textColor: "text-red-400" },
  { label: "High", min: 60, value: 70, color: "bg-orange-500", textColor: "text-orange-400" },
  { label: "Medium", min: 30, value: 50, color: "bg-yellow-500", textColor: "text-yellow-400" },
  { label: "Low", min: 0, value: 20, color: "bg-slate-500", textColor: "text-slate-400" },
] as const;

export function getPriorityLevel(importance: number) {
  return PRIORITY_LEVELS.find((p) => importance >= p.min) ?? PRIORITY_LEVELS[PRIORITY_LEVELS.length - 1];
}

export interface Reflection {
  id: number;
  thought_id: number;
  trigger_context: string;
  options: unknown[];
  factors: unknown[];
  conclusion: string;
  confidence: number;
  reflection_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
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

export interface ReflectionOption {
  label: string;
}

export interface ReflectionFactor {
  label: string;
  weight: number;
}

export interface ReflectionInput {
  trigger_context: string;
  options: ReflectionOption[];
  factors: ReflectionFactor[];
  conclusion: string;
  reflection_type: string;
}

export interface IngestionItem {
  id: number;
  job_id: number;
  content: string;
  type: string;
  fingerprint: string;
  action: string; // add, skip, create_revision, append_evidence
  reason: string | null;
  similarity: number | null;
  status: string;
  metadata: Record<string, unknown>;
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
