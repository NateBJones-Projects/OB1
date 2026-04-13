import { neon } from "@neondatabase/serverless";
import type { Thought, ThoughtMetadata } from "./types";

function getSQL() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  return neon(url);
}

export async function insertThought(
  content: string,
  embedding: number[],
  metadata: ThoughtMetadata,
  source: string,
): Promise<string> {
  const sql = getSQL();
  const embeddingStr = JSON.stringify(embedding);
  const metadataStr = JSON.stringify(metadata);
  const rows = await sql`
    INSERT INTO thoughts (content, embedding, metadata, source)
    VALUES (${content}, ${embeddingStr}::vector, ${metadataStr}::jsonb, ${source})
    RETURNING id
  `;
  return rows[0].id;
}

export async function searchThoughts(
  queryEmbedding: number[],
  options: {
    threshold?: number;
    limit?: number;
    filter?: Record<string, string>;
  } = {},
): Promise<Thought[]> {
  const sql = getSQL();
  const { threshold = 0.7, limit = 10, filter = {} } = options;
  const embeddingStr = JSON.stringify(queryEmbedding);
  const filterStr = JSON.stringify(filter);
  const rows = await sql`
    SELECT * FROM match_thoughts(
      ${embeddingStr}::vector, ${threshold}, ${limit}, ${filterStr}::jsonb
    )
  `;
  return rows as unknown as Thought[];
}

export async function listThoughts(
  options: {
    limit?: number;
    type?: string;
    topic?: string;
    since?: string;
  } = {},
): Promise<Thought[]> {
  const sql = getSQL();
  const { limit = 20, type, topic, since } = options;

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  let idx = 1;

  if (type) {
    conditions.push(`metadata->>'type' = $${idx++}`);
    params.push(type);
  }
  if (topic) {
    conditions.push(`metadata->'topics' ? $${idx++}`);
    params.push(topic);
  }
  if (since) {
    conditions.push(`created_at >= $${idx++}::timestamptz`);
    params.push(since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const query = `
    SELECT id, content, metadata, source, created_at
    FROM thoughts ${where}
    ORDER BY created_at DESC
    LIMIT $${idx}
  `;

  const rows = await sql.query(query, params);
  return rows as unknown as Thought[];
}
