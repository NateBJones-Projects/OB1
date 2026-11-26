/**
 * In-memory ThoughtStore that models the docs/01 schema's behavior:
 * upsert_thought's insert-or-merge by fingerprint (metadata = old || new),
 * created_at = updated_at on insert only, and the updated_at trigger on update.
 */
import type {
  ListFilters,
  ListRow,
  ReadBack,
  StatsRow,
  StoreResult,
  ThoughtMatch,
  ThoughtRecord,
  ThoughtStore,
} from "../../lib/types.ts";

export interface FakeRow {
  id: string;
  content: string;
  fingerprint: string;
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

type Method = keyof ThoughtStore;

/** Mirrors upsert_thought: lower(trim(collapse whitespace)). */
export function fingerprintOf(content: string): string {
  return content.replace(/\s+/g, " ").trim().toLowerCase();
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export class FakeStore implements ThoughtStore {
  rows: FakeRow[] = [];
  readonly calls: Array<{ method: Method; args: unknown[] }> = [];
  /** Methods listed here return `{ error: <message> }`. */
  fail: Partial<Record<Method, string>> = {};
  /** Replace any method's behavior for one test (the call is still recorded). */
  override: Partial<ThoughtStore> = {};
  private tick = 0;
  private nextId = 1;

  /** A strictly increasing ISO timestamp, one per database statement. */
  now(): string {
    return new Date(Date.UTC(2026, 0, 1) + 1000 * this.tick++).toISOString();
  }

  /** Add an existing row (for example a thought saved before 004, with no embedding_model). */
  seed(row: Partial<FakeRow> & { content: string }): FakeRow {
    const ts = this.now();
    const full: FakeRow = {
      id: row.id ?? `seed-${this.nextId++}`,
      content: row.content,
      fingerprint: fingerprintOf(row.content),
      embedding: row.embedding ?? null,
      metadata: row.metadata ?? {},
      created_at: row.created_at ?? ts,
      updated_at: row.updated_at ?? row.created_at ?? ts,
    };
    this.rows.push(full);
    return full;
  }

  find(id: string): FakeRow | undefined {
    return this.rows.find((r) => r.id === id);
  }

  private record<T>(method: Method, args: unknown[], run: () => StoreResult<T>): Promise<StoreResult<T>> {
    this.calls.push({ method, args });
    const o = this.override[method] as ((...a: unknown[]) => Promise<StoreResult<T>>) | undefined;
    if (o) return o(...args);
    const msg = this.fail[method];
    if (msg !== undefined) return Promise.resolve({ error: msg });
    return Promise.resolve(run());
  }

  fetchThought(id: string): Promise<StoreResult<ThoughtRecord>> {
    return this.record<ThoughtRecord>("fetchThought", [id], () => {
      const r = this.find(id);
      if (!r) return { error: "JSON object requested, multiple (or no) rows returned" };
      return { data: { id: r.id, content: r.content, metadata: r.metadata, created_at: r.created_at, updated_at: r.updated_at } };
    });
  }

  matchThoughts(embedding: number[], threshold: number, count: number): Promise<StoreResult<ThoughtMatch[]>> {
    return this.record<ThoughtMatch[]>("matchThoughts", [embedding, threshold, count], () => ({
      data: this.rows
        .filter((r) => r.embedding !== null)
        .map((r) => ({ r, similarity: cosine(embedding, r.embedding as number[]) }))
        .filter((x) => x.similarity > threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, count)
        .map(({ r, similarity }) => ({ id: r.id, content: r.content, metadata: r.metadata, similarity, created_at: r.created_at })),
    }));
  }

  listThoughts(filters: ListFilters): Promise<StoreResult<ListRow[]>> {
    return this.record<ListRow[]>("listThoughts", [filters], () => {
      const has = (v: unknown, x: string) => Array.isArray(v) && v.includes(x);
      return {
        data: this.rows
          .filter((r) => filters.type === undefined || r.metadata.type === filters.type)
          .filter((r) => filters.topic === undefined || has(r.metadata.topics, filters.topic))
          .filter((r) => filters.person === undefined || has(r.metadata.people, filters.person))
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, filters.limit)
          .map((r) => ({ content: r.content, metadata: r.metadata, created_at: r.created_at })),
      };
    });
  }

  stats(): Promise<StoreResult<{ count: number | null; rows: StatsRow[] }>> {
    return this.record<{ count: number | null; rows: StatsRow[] }>("stats", [], () => ({
      data: {
        count: this.rows.length,
        rows: [...this.rows]
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((r) => ({ metadata: r.metadata, created_at: r.created_at })),
      },
    }));
  }

  upsertThought(content: string, metadata: Record<string, unknown>): Promise<StoreResult<{ id: string }>> {
    return this.record<{ id: string }>("upsertThought", [content, metadata], () => {
      const fp = fingerprintOf(content);
      const existing = this.rows.find((r) => r.fingerprint === fp);
      const ts = this.now();
      if (existing) {
        existing.metadata = { ...existing.metadata, ...metadata };
        existing.updated_at = ts;
        return { data: { id: existing.id } };
      }
      const row: FakeRow = {
        id: `t-${this.nextId++}`,
        content,
        fingerprint: fp,
        embedding: null,
        metadata: { ...metadata },
        created_at: ts,
        updated_at: ts,
      };
      this.rows.push(row);
      return { data: { id: row.id } };
    });
  }

  setEmbedding(id: string, embedding: number[]): Promise<StoreResult<null>> {
    return this.record<null>("setEmbedding", [id, embedding], () => {
      const r = this.find(id);
      if (r) {
        r.embedding = embedding;
        r.updated_at = this.now();
      }
      return { data: null };
    });
  }

  readBack(id: string): Promise<StoreResult<ReadBack>> {
    return this.record<ReadBack>("readBack", [id], () => {
      const r = this.find(id);
      if (!r) return { error: "JSON object requested, multiple (or no) rows returned" };
      return { data: { createdAt: r.created_at, updatedAt: r.updated_at, embeddingIsNull: r.embedding === null } };
    });
  }

  deleteIfInsertedByCall(id: string, timestamp: string): Promise<StoreResult<{ deleted: boolean }>> {
    return this.record<{ deleted: boolean }>("deleteIfInsertedByCall", [id, timestamp], () => {
      const i = this.rows.findIndex((r) =>
        r.id === id && r.embedding === null && r.created_at === timestamp && r.updated_at === timestamp
      );
      if (i < 0) return { data: { deleted: false } };
      this.rows.splice(i, 1);
      return { data: { deleted: true } };
    });
  }

  countAll(): Promise<StoreResult<number>> {
    return this.record<number>("countAll", [], () => ({ data: this.rows.length }));
  }

  countWithModel(model: string): Promise<StoreResult<number>> {
    return this.record<number>("countWithModel", [model], () => ({
      data: this.rows.filter((r) => r.metadata.embedding_model === model).length,
    }));
  }
}
