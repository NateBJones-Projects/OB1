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

Deno.test("U26 parseUsableMetadata returns the object for a raw JSON object reply, including {}", () => {
  assertEquals(parseUsableMetadata('{"topics":["a"],"type":"idea"}'), { topics: ["a"], type: "idea" });
  assertEquals(parseUsableMetadata("  \n{}\n "), {});
});

Deno.test("U27 parseUsableMetadata returns the object when the whole reply is one fenced block", () => {
  const obj = { topics: ["a"], type: "task" };
  assertEquals(parseUsableMetadata('```json\n{"topics":["a"],"type":"task"}\n```'), obj);
  assertEquals(parseUsableMetadata('```\n{"topics":["a"],"type":"task"}\n```'), obj);
  assertEquals(parseUsableMetadata('\n```json\n{"topics":["a"],"type":"task"}\n```\n'), obj);
  assertEquals(parseUsableMetadata("```json\n{}\n```"), {});
});
