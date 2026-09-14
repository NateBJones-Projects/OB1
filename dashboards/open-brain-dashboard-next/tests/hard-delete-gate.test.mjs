import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { access } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("dashboard hard delete defaults to disabled", async () => {
  const source = await readFile(new URL("lib/features.ts", root), "utf8");
  assert.match(source, /NEXT_PUBLIC_ALLOW_HARD_DELETE\s*===\s*"true"/);
});

for (const route of [
  "app/api/kanban/delete/route.ts",
  "app/api/duplicates/resolve/route.ts",
  "app/api/audit/delete/route.ts",
]) {
  test(`${route} enforces the hard-delete gate`, async () => {
    const source = await readFile(new URL(route, root), "utf8");
    assert.match(source, /hardDeleteEnabled/);
    assert.match(source, /status:\s*405/);
  });
}

test("authentication routing uses the Next.js 16 Node proxy convention", async () => {
  const source = await readFile(new URL("proxy.ts", root), "utf8");
  assert.match(source, /export function proxy\(/);
  await assert.rejects(access(new URL("middleware.ts", root)));
});

test("standalone output is disabled on Vercel builds", async () => {
  const source = await readFile(new URL("next.config.ts", root), "utf8");
  assert.match(source, /output:\s*process\.env\.VERCEL\s*\?\s*undefined\s*:\s*"standalone"/);
});
