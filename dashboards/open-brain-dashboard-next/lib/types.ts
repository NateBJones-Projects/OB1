export interface Thought {
  id: string;
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
  id: string | number;
  thought_id: string;
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
  thought_id_a: string;
  thought_id_b: string;
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
  id: number | string;
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
  thought_id?: string;
  job_id?: number;
  type?: string;
  status?: string;
  extracted_count?: number | null;
  message: string;
}

export type AgentMemoryReviewAction =
  | "confirm"
  | "edit"
  | "evidence_only"
  | "restrict_scope"
  | "mark_stale"
  | "merge"
  | "reject"
  | "dispute"
  | "supersede";

export interface AgentMemory {
  memory_id: string;
  summary: string;
  content: string;
  source: {
    kind: string;
    uri: string | null;
    title: string | null;
    timestamp: string | null;
  };
  provenance: {
    status: string;
    confidence: number;
    created_by: string;
    model: string | null;
    runtime: string | null;
  };
  scope: {
    workspace_id: string;
    project_id: string | null;
    channel_id: string | null;
    visibility: string;
  };
  use_policy: {
    can_use_as_instruction: boolean;
    can_use_as_evidence: boolean;
    requires_user_confirmation: boolean;
  };
  freshness: {
    created_at: string;
    last_confirmed_at: string | null;
    stale_after: string | null;
  };
  related_artifacts: Array<{ kind: string; uri: string }>;
}

export interface AgentMemoryListResponse {
  memories: AgentMemory[];
  count: number;
}

export interface AgentMemorySourceRef {
  id: string;
  memory_id: string;
  source_kind: string;
  uri: string | null;
  title: string | null;
  source_timestamp: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentMemoryArtifact {
  id: string;
  memory_id: string;
  artifact_kind: string;
  uri: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentMemoryRecord {
  id: string;
  thought_id: string | null;
  workspace_id: string;
  project_id: string | null;
  channel_kind: string | null;
  channel_id: string | null;
  channel_thread_id: string | null;
  visibility: string;
  memory_type: string;
  summary: string;
  content: string;
  lifecycle_status: string;
  provenance_status: string;
  confidence: number;
  created_by: string;
  runtime_name: string | null;
  runtime_version: string | null;
  provider: string | null;
  model: string | null;
  task_id: string | null;
  flow_id: string | null;
  can_use_as_instruction: boolean;
  can_use_as_evidence: boolean;
  requires_user_confirmation: boolean;
  review_status: string;
  last_confirmed_at: string | null;
  stale_after: string | null;
  idempotency_key: string | null;
  content_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  agent_memory_source_refs?: AgentMemorySourceRef[];
  agent_memory_artifacts?: AgentMemoryArtifact[];
}

export interface AgentMemoryTraceItem {
  id: string;
  trace_id: string;
  memory_id: string;
  rank: number;
  similarity: number | null;
  ranking_score: number | null;
  returned: boolean;
  used: boolean | null;
  ignored_reason: string | null;
  use_policy_snapshot: Record<string, unknown>;
  created_at: string;
  agent_memories?: AgentMemoryRecord;
}

export interface AgentMemoryTraceResponse {
  trace: {
    id: string;
    request_id: string;
    workspace_id: string;
    project_id: string | null;
    runtime_name: string | null;
    runtime_version: string | null;
    task_id: string | null;
    flow_id: string | null;
    channel_kind: string | null;
    channel_id: string | null;
    query: string;
    schema_version: string;
    request_payload: Record<string, unknown>;
    response_policy: Record<string, unknown>;
    created_at: string;
  };
  items: AgentMemoryTraceItem[];
}
