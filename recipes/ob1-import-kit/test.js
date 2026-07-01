import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(__dirname, "import-kit.js");
const sample = path.join(__dirname, "fixtures", "sample-records.json");
const bad = path.join(__dirname, "fixtures", "bad-records.json");
const importedAt = "2026-06-06T00:00:00.000Z";

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: __dirname,
    encoding: "utf8",
  });
}

test("validate accepts sample records", () => {
  const result = run(["validate", sample]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Records: 3/);
  assert.match(result.stdout, /Valid records: 3/);
  assert.match(result.stdout, /Failures: 0/);
});

test("validate rejects malformed records and warns on secret-like content", () => {
  const result = run(["validate", bad]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing content or text/);
  assert.match(result.stderr, /timestamp is not a valid ISO date/);
  assert.match(result.stderr, /may contain a secret/);
});

test("validate can emit machine-readable JSON", () => {
  const result = run(["validate", sample, "--json"]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.total_records, 3);
  assert.equal(parsed.failures.length, 0);
});

test("normalize emits metadata-contract-compatible candidates", () => {
  const result = run(["normalize", sample, "--imported-at", importedAt]);
  assert.equal(result.status, 0);
  const rows = JSON.parse(result.stdout);
  assert.equal(rows.length, 3);

  const requiredMetadata = [
    "source",
    "source_type",
    "source_label",
    "imported_at",
    "importer_name",
    "importer_version",
    "input_hash",
    "content_fingerprint",
    "sensitivity_tier",
    "provenance",
  ];

  for (const row of rows) {
    assert.equal(typeof row.content, "string");
    assert.equal(typeof row.source_type, "string");
    assert.match(row.content_fingerprint, /^sha256:/);
    for (const field of requiredMetadata) {
      assert.ok(field in row.metadata, `missing metadata.${field}`);
    }
    assert.equal(row.metadata.imported_at, importedAt);
    assert.equal(row.metadata.importer_name, "ob1-import-kit");
    assert.equal(row.metadata.provenance.review_status, "unreviewed");
    assert.equal(row.metadata.confidence || "extracted", row.metadata.confidence);
  }
});

test("normalize rejects invalid records", () => {
  const result = run(["normalize", bad, "--imported-at", importedAt]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot normalize records with validation failures/);
});

test("usage errors exit 2", () => {
  const noArgs = run([]);
  assert.equal(noArgs.status, 2);
  assert.match(noArgs.stdout, /Usage:/);

  const missing = run(["validate", "fixtures/does-not-exist.json"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no such file|cannot find/i);
});
