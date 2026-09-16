import { embed, generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { metadataSchema, type ThoughtMetadata } from "./types";

export async function generateEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: openai.embedding("text-embedding-3-small"),
    value: text,
  });
  return embedding;
}

export async function extractMetadata(
  content: string,
): Promise<ThoughtMetadata> {
  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: metadataSchema,
    prompt: `Extract structured metadata from this thought. Be concise.

Thought: "${content}"

Rules:
- people: extract full names mentioned
- action_items: implied tasks or things to do
- dates_mentioned: in YYYY-MM-DD format
- topics: 1-3 short category tags
- type: classify as observation, task, idea, reference, person_note, decision, or meeting_note`,
  });
  return object;
}
