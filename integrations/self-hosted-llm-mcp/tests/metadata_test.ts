import { assert, assertEquals } from "jsr:@std/assert@^1";
import { buildCaptureMetadata, EXTRACTION_PROMPT, parseUsableMetadata } from "../lib/metadata.ts";

Deno.test("U25 EXTRACTION_PROMPT equals core's extractMetadata system prompt verbatim", async () => {
  const src = await Deno.readTextFile(new URL("../../../server/index.ts", import.meta.url));
  const fn = src.slice(src.indexOf("async function extractMetadata"));
  const m = fn.match(/role: "system",\s*content: `([^`]*)`/);
  assert(m, "could not find the system prompt in server/index.ts extractMetadata");
  assert(m[1].length > 100);
  assertEquals(EXTRACTION_PROMPT, m[1]);
});
