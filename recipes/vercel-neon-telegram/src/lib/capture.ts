import { generateEmbedding, extractMetadata } from "./ai";
import { insertThought } from "./db";
import type { ThoughtMetadata } from "./types";

export async function captureThought(
  content: string,
  source: string,
): Promise<{ id: string; metadata: ThoughtMetadata }> {
  const [embedding, metadata] = await Promise.all([
    generateEmbedding(content),
    extractMetadata(content),
  ]);
  const id = await insertThought(content, embedding, metadata, source);
  return { id, metadata };
}
