/** Core's metadata-extraction system prompt (filled in by stream C). */
export const EXTRACTION_PROMPT: string = "";

export function parseUsableMetadata(_text: string): Record<string, unknown> | null {
  throw new Error("not implemented");
}

export function buildCaptureMetadata(
  _extracted: Record<string, unknown> | null,
  _embeddingModel: string,
): Record<string, unknown> {
  throw new Error("not implemented");
}
