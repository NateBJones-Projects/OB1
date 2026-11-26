import { assertEquals } from "jsr:@std/assert@^1";

const ALLOWED_PREFIXES = ["npm:", "jsr:", "node:", "./", "../", "https:"];
const SPECIFIER = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Every import/export specifier in `source` that is not a full specifier. */
export function bareSpecifiers(source: string): string[] {
  const bare: string[] = [];
  for (const m of source.matchAll(SPECIFIER)) {
    const spec = m[1] ?? m[2];
    if (!ALLOWED_PREFIXES.some((p) => spec.startsWith(p))) bare.push(spec);
  }
  return bare;
}

async function sourceFiles(dir: URL): Promise<URL[]> {
  const files: URL[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isDirectory) {
      if (entry.name === "tests") continue;
      files.push(...await sourceFiles(new URL(entry.name + "/", dir)));
    } else if (entry.name.endsWith(".ts")) files.push(new URL(entry.name, dir));
  }
  return files;
}

Deno.test("U195 no source file outside tests/ uses a bare import specifier, and a planted bare import is flagged", async () => {
  // Negative control: the scanner flags planted bare imports and accepts full ones.
  assertEquals(bareSpecifiers('import { z } from "zod";\nimport x from "npm:zod@4.1.13";'), ["zod"]);
  assertEquals(bareSpecifiers('export { a } from "hono";\nconst m = await import("@hono/mcp");'), ["hono", "@hono/mcp"]);
  assertEquals(bareSpecifiers('import { a } from "./a.ts";\nimport b from "../b.ts";\nimport c from "jsr:@std/assert@^1";\nimport d from "node:fs";\nimport e from "https://x.test/e.ts";'), []);

  const files = await sourceFiles(new URL("../", import.meta.url));
  assertEquals(files.length > 0, true);
  const offenders: string[] = [];
  for (const file of files) {
    for (const spec of bareSpecifiers(await Deno.readTextFile(file))) offenders.push(`${file.pathname}: ${spec}`);
  }
  assertEquals(offenders, []);
});
