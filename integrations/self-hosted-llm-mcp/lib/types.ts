// Shared seams for the self-hosted LLM MCP server.
// Frozen during the parallel streams: only the integrator edits this file.

/** Reads one environment variable (Deno.env.get in production, a fake in tests). */
export type GetEnv = (name: string) => string | undefined;

export type Role = "embedding" | "chat";

/** One role's model endpoint (data-model.md §1). */
export interface EndpointConfig {
  role: Role;
  /** http(s) base URL with no trailing slash. */
  base: string;
  /** Access key, absent when the role has none. */
  key?: string;
  model: string;
}

export type ResolvedConfig =
  | {
    ok: true;
    embedding: EndpointConfig;
    chat: EndpointConfig;
    timeoutMs: number;
    /** What the chat role took from the embedding role, in the order ["base", "key"]. */
    chatInherits: ("base" | "key")[];
  }
  | {
    ok: false;
    /** Required settings that are unset or blank, in the order EMBEDDING_API_BASE, EMBEDDING_MODEL, CHAT_MODEL. */
    missing: string[];
    /** Settings present but unusable, each with a reason that never contains a key value. */
    invalid: { setting: string; reason: string }[];
  };

export type OkConfig = Extract<ResolvedConfig, { ok: true }>;

/** The failing outcomes of a model call (data-model.md §2). */
export type OutcomeKind =
  | "unreachable"
  | "timeout"
  | "auth_rejected"
  | "model_not_found"
  | "http_error"
  | "bad_response"
  | "wrong_dimension";

export type ModelResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: OutcomeKind; message: string };

export interface ModelClient {
  embed(text: string): Promise<ModelResult<number[]>>;
  /** Returns the raw `choices[0].message.content` string. */
  chat(text: string): Promise<ModelResult<string>>;
  /** `data[].id`, or null when the server answered 2xx without a usable list. */
  listModels(role: Role): Promise<ModelResult<string[] | null>>;
}

export type StoreResult<T> = { data: T } | { error: string };

export interface ThoughtRecord {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at?: string | null;
}

/** A row as `match_thoughts` returns it. */
export interface ThoughtMatch {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  created_at: string;
}

export interface ListFilters {
  limit: number;
  type?: string;
  topic?: string;
  person?: string;
  days?: number;
}

export interface ListRow {
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface StatsRow {
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ReadBack {
  /** Exact timestamp strings as received from the database. */
  createdAt: string;
  updatedAt: string;
  embeddingIsNull: boolean;
}

/** Database port (research R4, R6, R9). Every method resolves; failures are `{ error }`. */
export interface ThoughtStore {
  fetchThought(id: string): Promise<StoreResult<ThoughtRecord>>;
  matchThoughts(embedding: number[], threshold: number, count: number): Promise<StoreResult<ThoughtMatch[]>>;
  listThoughts(filters: ListFilters): Promise<StoreResult<ListRow[]>>;
  stats(): Promise<StoreResult<{ count: number | null; rows: StatsRow[] }>>;
  upsertThought(content: string, metadata: Record<string, unknown>): Promise<StoreResult<{ id: string }>>;
  setEmbedding(id: string, embedding: number[]): Promise<StoreResult<null>>;
  readBack(id: string): Promise<StoreResult<ReadBack>>;
  deleteIfInsertedByCall(id: string, timestamp: string): Promise<StoreResult<{ deleted: boolean }>>;
  countAll(): Promise<StoreResult<number>>;
  countWithModel(model: string): Promise<StoreResult<number>>;
}

/** Everything the server needs from the outside world. */
export interface Deps {
  getEnv: GetEnv;
  /** Transport for model-server requests only. */
  modelFetch: typeof fetch;
  store: ThoughtStore;
}

/** Setup-check report (contracts/setup-check.md, data-model.md §4). */
export interface CheckResult {
  id:
    | "config"
    | "embedding_reachable"
    | "embedding_model"
    | "embedding_dimension"
    | "chat_reachable"
    | "chat_model"
    | "chat_metadata";
  role?: Role;
  ok: boolean;
  reason?: string;
}

export interface Warning {
  id: string;
  role?: Role;
  message: string;
}

export interface SetupConfigBlock {
  embedding: { base: string; model: string; key_set: boolean };
  chat: { base: string; model: string; key_set: boolean; inherits: ("base" | "key")[] };
  timeout_ms: number;
}

export interface SetupReport {
  ok: boolean;
  checks: CheckResult[];
  warnings: Warning[];
  thoughts: { other_model: number | null };
  /** Null when the configuration could not be resolved. */
  config: SetupConfigBlock | null;
}

/** What the HTTP entry serves: anything with a Fetch-API handler. */
export interface FetchApp {
  fetch(request: Request): Response | Promise<Response>;
}
