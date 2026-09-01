import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(__dirname, "convert.js");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: __dirname,
    encoding: "utf8",
  });
}

function recordsFrom(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("single text file produces a record array", () => {
  const result = run(["fixtures/single.txt", "--source", "sample", "--source-label", "Sample files"]);
  const records = recordsFrom(result);
  assert.equal(records.length, 1);
  assert.match(records[0].content, /dry-run import checks/);
  assert.equal(records[0].source, "sample");
  assert.equal(records[0].source_path, "single.txt");
});

test("markdown frontmatter populates metadata fields", () => {
  const result = run(["fixtures/with-frontmatter.md", "--source", "markdown"]);
  const records = recordsFrom(result);
  assert.equal(records.length, 1);
  assert.equal(records[0].created_at, "2026-05-01T12:00:00Z");
  assert.equal(records[0].type, "decision");
  assert.deepEqual(records[0].topics, ["import", "metadata", "review"]);
});

test("directory traversal includes supported files with relative source paths", () => {
  const result = run(["fixtures/dir", "--source", "dir"]);
  const records = recordsFrom(result);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => r.source_path).sort(), ["a.txt", "note.md"]);
});

test("chunking preserves locators and keeps chunks below threshold", () => {
  const result = run(["fixtures/large.txt", "--source", "large", "--max-chunk-size", "180"]);
  const records = recordsFrom(result);
  assert.ok(records.length > 1);
  assert.ok(records.every((record) => record.content.length <= 180));
  assert.ok(records.every((record) => /^chunk-\d+-of-\d+$/.test(record.source_locator)));
  assert.ok(records.every((record) => record.type === "raw_chunk"));
});

test("json arrays are reshaped into extracted records", () => {
  const result = run(["fixtures/records.json", "--source", "json", "--source-label", "JSON fixture"]);
  const records = recordsFrom(result);
  assert.equal(records.length, 2);
  assert.equal(records[0].source_path, "records.json");
  assert.equal(records[0].source_locator, "json-record-1");
  assert.deepEqual(records[0].topics, ["json", "import"]);
});

test("output file option writes JSON to disk", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ob1-file-converter-"));
  const out = path.join(tmpDir, "records.json");
  const result = run(["fixtures/single.txt", "--output", out]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  const records = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(records.length, 1);
});

test("binary files are skipped with a warning", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ob1-file-converter-"));
  const binary = path.join(tmpDir, "data.txt");
  fs.writeFileSync(binary, Buffer.from([0, 1, 2, 3]));
  const result = run([binary]);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), []);
  assert.match(result.stderr, /Skipped binary file/);
});

test("symlinks are skipped when the platform allows creating one", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ob1-file-converter-"));
  const target = path.join(tmpDir, "target.txt");
  const link = path.join(tmpDir, "link.txt");
  fs.writeFileSync(target, "Target file");
  try {
    fs.symlinkSync(target, link);
  } catch {
    return;
  }
  const result = run([tmpDir]);
  assert.equal(result.status, 0);
  assert.match(result.stderr, /Skipped symlink/);
});

test("empty text file produces an empty array", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ob1-file-converter-"));
  const empty = path.join(tmpDir, "empty.txt");
  fs.writeFileSync(empty, "");
  const result = run([empty]);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), []);
});

test("usage errors exit 2", () => {
  const result = run([]);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /Usage:/);
});
