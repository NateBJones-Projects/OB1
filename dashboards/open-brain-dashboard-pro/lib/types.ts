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
  id: string;
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
  id: string;
  job_id: string;
  /** The extracted thought content (DB column: extracted_content) */
  content: string;
  action: string; // add, skip, create_revision, append_evidence
  reason: string | null;
  status: string;
  matched_thought_id: string | null;
  similarity_score: number | null;
  result_thought_id: string | null;
  /** Parsed metadata — type, importance, tags, source_snippet */
  meta: IngestionItemMeta;
}

export interface IngestionJobDetail {
  job: IngestionJob;
  items: IngestionItem[];
}

// ─── CRM (optional) ─────────────────────────────────────────────────────────
// Present only on brains with the crm-core / crm-engagement schemas. Every id is
// a UUID string (unlike Thought.id, which is numeric on this dashboard).

export interface CrmFieldProvenance {
  origin?: string;
  actor?: string;
  run_id?: string | null;
  at?: string;
  locked?: boolean;
  accepted_origin?: string;
  via_proposal?: string;
}

export interface CrmContactSummary {
  id: string;
  display_name: string;
  canonical_email: string | null;
  organization_name: string | null;
  job_title: string | null;
  location: string | null;
  relationship_note: string | null;
  lifecycle_status: string;
  privacy_tier: string;
  owner_label: string;
  card_thought_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmContactRecord extends CrmContactSummary {
  source_kind?: string;
  canonical_name?: string | null;
  preferred_name?: string | null;
  given_name?: string | null;
  family_name?: string | null;
  pronouns?: string | null;
  source_metadata?: Record<string, unknown>;
  editable_metadata?: Record<string, unknown>;
  field_provenance?: Record<string, CrmFieldProvenance>;
  created_by?: string;
  updated_by?: string;
}

export interface CrmMethod {
  id: string;
  contact_id: string;
  method_type: string;
  value: string;
  label: string | null;
  is_primary: boolean;
  status: string;
  source: string;
  confidence: number;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export interface CrmAlias {
  id: string;
  contact_id: string;
  alias: string;
  source: string;
  status: string;
}

export interface CrmContactBundle {
  record: CrmContactRecord;
  methods: CrmMethod[];
  aliases: CrmAlias[];
}

export interface CrmContactListResponse {
  data: CrmContactSummary[];
  total: number;
  page: number;
  per_page: number;
}

export interface CrmCreateResponse {
  contact_id: string;
  record?: CrmContactRecord;
  methods?: CrmMethod[];
  aliases?: CrmAlias[];
}

export interface CrmPatchResponse {
  contact_id: string;
  applied: string[];
  proposed: unknown[];
  conflicts: string[];
  record: CrmContactRecord;
}

export interface CrmProposal {
  id: string;
  contact_id: string;
  target_kind: string;
  field_key: string;
  current_value: string | null;
  proposed_value: string | null;
  origin: string;
  origin_ref: Record<string, unknown>;
  confidence: number | null;
  evidence_thought_ids: string[] | null;
  status: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

export interface CrmProposalListResponse {
  data: CrmProposal[];
  total: number;
  page: number;
  per_page: number;
}

export interface CrmEvidence {
  evidence_id: string;
  target_kind: string;
  target_id: string | null;
  field_key: string | null;
  role: string;
  note: string | null;
  thought_id: string;
  thought_snippet: string | null;
  thought_created_at: string;
  created_at: string;
}

export interface CrmChangeLogEntry {
  id: string;
  contact_id: string;
  method_id: string | null;
  action: string;
  actor_label: string;
  changed_fields: Record<string, unknown>;
  created_at: string;
}

export interface CrmChangeLogResponse {
  history: CrmChangeLogEntry[];
  total: number;
  page: number;
  per_page: number;
}

export interface CrmNote {
  id: string;
  contact_id: string;
  body: string;
  note_type: string;
  pinned: boolean;
  privacy_tier: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CrmTask {
  id: string;
  contact_id: string;
  title: string;
  description: string | null;
  task_type: string;
  status: string;
  due_at: string | null;
  snoozed_until: string | null;
  completed_at: string | null;
  priority: string;
  privacy_tier: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CrmImportantDate {
  id: string;
  contact_id: string;
  label: string;
  date_value: string;
  date_kind: string;
  recurrence: string;
  notes: string | null;
  privacy_tier: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CrmRelationshipItems {
  notes: CrmNote[];
  tasks: CrmTask[];
  important_dates: CrmImportantDate[];
}

export interface CrmInteraction {
  interaction_id: string;
  kind: string;
  occurred_at: string;
  duration_minutes: number | null;
  summary: string;
  privacy_tier: string;
  origin: string;
  thought_id: string | null;
  created_at: string;
}

export interface CrmInteractionsResponse {
  interactions: CrmInteraction[];
}

export interface CrmTimelineEvent {
  type: "change" | "interaction" | "evidence";
  at: string;
  data: Record<string, unknown>;
}

export interface CrmTimelineResponse {
  timeline: CrmTimelineEvent[];
}

export type AddToBrainMode = "auto" | "single" | "extract";

export interface AddToBrainResult {
  path: "single" | "extract";
  thought_id?: number;
  job_id?: string;
  type?: string;
  status?: string;
  extracted_count?: number | null;
  message: string;
}
