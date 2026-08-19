import assert from "node:assert/strict";
import test from "node:test";

import { normalizeThoughtId } from "./compatibility.ts";

test("normalizes a PostgreSQL BIGINT thought ID without losing precision", () => {
  const id = normalizeThoughtId(9007199254740993n);

  assert.equal(id, "9007199254740993");
  assert.equal(JSON.stringify({ id }), '{"id":"9007199254740993"}');
});