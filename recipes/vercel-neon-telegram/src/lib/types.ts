import { z } from "zod";

export const thoughtTypeEnum = z.enum([
  "observation",
  "task",
  "idea",
  "reference",
  "person_note",
  "decision",
  "meeting_note",
]);

export type ThoughtType = z.infer<typeof thoughtTypeEnum>;

export const metadataSchema = z.object({
  people: z.array(z.string()).default([]),
  action_items: z.array(z.string()).default([]),
  dates_mentioned: z.array(z.string()).default([]),
  topics: z.array(z.string()).max(3).default([]),
  type: thoughtTypeEnum.default("observation"),
});

export type ThoughtMetadata = z.infer<typeof metadataSchema>;

export interface Thought {
  id: string;
  content: string;
  metadata: ThoughtMetadata;
  similarity?: number;
  source: string;
  created_at: string;
}
