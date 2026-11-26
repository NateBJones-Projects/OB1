/** Core's metadata-extraction system prompt, verbatim from server/index.ts extractMetadata. */
export const EXTRACTION_PROMPT: string = `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`;

export function parseUsableMetadata(text: string): Record<string, unknown> | null {
  const fenced = text.trim().match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/);
  return JSON.parse(fenced ? fenced[1] : text.trim());
}

export function buildCaptureMetadata(
  _extracted: Record<string, unknown> | null,
  _embeddingModel: string,
): Record<string, unknown> {
  throw new Error("not implemented");
}
