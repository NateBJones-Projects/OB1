import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../index.ts", import.meta.url), "utf8");

test("hard delete is disabled unless explicitly enabled", () => {
  assert.match(source, /ALLOW_HARD_DELETE\s*=\s*Deno\.env\.get\("ALLOW_HARD_DELETE"\)\s*===\s*"true"/);
  assert.match(source, /if \(!ALLOW_HARD_DELETE\)[\s\S]{0,250}405/);
});

test("health reports whether hard delete is enabled", () => {
  assert.match(source, /hard_delete_enabled:\s*ALLOW_HARD_DELETE/);
});

test("capture completion marks a thought enriched", () => {
  assert.match(source, /enriched:\s*true/);
});
