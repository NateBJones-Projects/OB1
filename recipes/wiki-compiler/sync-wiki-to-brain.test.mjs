import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitFrontmatter,
  sourceTypeForDir,
  buildWikiThought,
} from "./sync-wiki-to-brain.mjs";

test("splitFrontmatter extracts meta and body", () => {
  const raw = `---\ntitle: Open Brain\ntype: project\n---\n# Open Brain\n\nBody text.`;
  const { meta, body } = splitFrontmatter(raw);
  assert.equal(meta.title, "Open Brain");
  assert.equal(meta.type, "project");
  assert.match(body, /# Open Brain/);
  assert.doesNotMatch(body, /^---/);
});

test("splitFrontmatter with no frontmatter returns raw body", () => {
  const raw = `# Just a heading\n\ntext`;
  const { meta, body } = splitFrontmatter(raw);
  assert.deepEqual(meta, {});
  assert.equal(body, raw);
});

test("sourceTypeForDir maps dirs", () => {
  assert.equal(sourceTypeForDir("entities"), "wiki_entity");
  assert.equal(sourceTypeForDir("topics"), "wiki_topic");
  assert.throws(() => sourceTypeForDir("bogus"), /unknown wiki dir/);
});

test("buildWikiThought builds a wiki_entity thought", () => {
  const raw = `---\ntitle: Supabase\ntype: tool\ngenerated_at: 2026-07-08T20:19:00Z\n---\nSupabase is a backend.`;
  const t = buildWikiThought("entities", "tool-supabase.md", raw);
  assert.equal(t.source_type, "wiki_entity");
  assert.equal(t.type, "reference");
  assert.equal(t.metadata.wiki_slug, "tool-supabase");
  assert.equal(t.metadata.wiki_title, "Supabase");
  assert.equal(t.metadata.wiki_type, "tool");
  assert.equal(t.metadata.generated_at, "2026-07-08T20:19:00Z");
  assert.equal(t.metadata.compiled_by, "wiki-compiler");
  assert.equal(t.content, "Supabase is a backend.");
});

test("buildWikiThought falls back to slug-derived title", () => {
  const t = buildWikiThought("topics", "autobiography.md", "Life story.");
  assert.equal(t.source_type, "wiki_topic");
  assert.equal(t.metadata.wiki_title, "autobiography");
  assert.equal(t.metadata.generated_at, null);
});
