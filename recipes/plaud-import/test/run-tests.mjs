#!/usr/bin/env node
/**
 * run-tests.mjs — offline checks for the parts of this recipe that are easy to
 * get subtly wrong. No network, no credentials, no database.
 *
 *   node test/run-tests.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { contentFingerprint, parseArgs } from "../lib/common.mjs";
import {
  chunkTurns,
  discoverRecordings,
  parseTranscriptText,
  splitSections,
  splitSummaryDoc,
} from "../lib/plaud-parse.mjs";
import { loadTierMap, loadTriageRules, triageRecording } from "../lib/triage.mjs";
import { parseAtomsFromResponse, resolveProvider, excerptTranscript } from "../lib/providers.mjs";
import { entriesToRecords, parseListing } from "../export-plaud.mjs";
import { mediaFilename, parseShareId, planRecording } from "../fetch-shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const recipeDir = path.join(__dirname, "..");
const rules = loadTriageRules(path.join(recipeDir, "triage-rules.example.json"));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

function recordFor(text, overrides = {}) {
  return {
    recording_id: "t1",
    title: "Test recording",
    start_at: "2026-05-01T10:00:00Z",
    duration_ms: 600000,
    summary: text,
    highlights: "",
    transcript: text,
    turns: parseTranscriptText(text),
    speakers: [],
    source_paths: {},
    input_hash: "sha256:test",
    layout: "test",
    raw_meta: {},
    ...overrides,
  };
}

console.log("fingerprint");
test("matches the OB1 trigger's normalization (lower -> collapse ws -> trim)", () => {
  // set_content_fingerprint(): sha256(lower(trim(regexp_replace(content,'\s+',' ','g'))))
  const a = contentFingerprint("  Hello   World \n");
  const b = contentFingerprint("hello world");
  assert.equal(a, b);
  assert.equal(a.length, 64);
});
test("different content gives a different fingerprint", () => {
  assert.notEqual(contentFingerprint("a"), contentFingerprint("b"));
});

console.log("triage");
test("unclassified content defaults to personal, never standard", () => {
  const verdict = triageRecording(recordFor("The weather was mild and we walked by the river."), { rules });
  assert.equal(verdict.tier, "personal");
  assert.equal(verdict.rule, "default:unclassified");
});
test("secrets outrank everything and land on restricted", () => {
  const verdict = triageRecording(recordFor("standup notes, password: hunter2hunter2"), { rules });
  assert.equal(verdict.tier, "restricted");
  assert.equal(verdict.label, "password_value");
});
test("a confidential-work keyword sets restricted + summary-only mode", () => {
  const verdict = triageRecording(recordFor("Reminder that this call is under NDA."), { rules });
  assert.equal(verdict.tier, "restricted");
  assert.equal(verdict.mode, "summary");
});
test("--client-mode changes the mode for restricted recordings", () => {
  const verdict = triageRecording(recordFor("Reminder that this call is under NDA."), {
    rules,
    restrictedMode: "skip",
  });
  assert.equal(verdict.mode, "summary", "an explicit rule mode still wins over the flag");
  const noModeRules = {
    ...rules,
    rules: rules.rules.map((r) => (r.name === "confidential-work" ? { ...r, mode: undefined } : r)),
  };
  const verdict2 = triageRecording(recordFor("Reminder that this call is under NDA."), {
    rules: noModeRules,
    restrictedMode: "skip",
  });
  assert.equal(verdict2.mode, "skip");
});
test("escalation guard: a standard verdict is re-checked against the regex sets", () => {
  // Deliberately mis-order the rules so the business rule fires first on text
  // that also contains an SSN. The guard must escalate anyway.
  const badOrder = { ...rules, rules: [...rules.rules].sort((a, b) => (a.tier === "standard" ? -1 : 1)) };
  const verdict = triageRecording(recordFor("Sprint retro notes. SSN 123-45-6789 mentioned on the call."), {
    rules: badOrder,
  });
  assert.equal(verdict.tier, "restricted");
  assert.equal(verdict.rule, "escalation:regex:restricted");
});
test("loadTriageRules refuses default_tier 'standard'", () => {
  const tmp = path.join(os.tmpdir(), `plaud-rules-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ default_tier: "standard", rules: [] }));
  assert.throws(() => loadTriageRules(tmp), /default_tier must not be "standard"/);
  fs.unlinkSync(tmp);
});
test("tier map overrides the rules", () => {
  const tmp = path.join(os.tmpdir(), `plaud-tiers-${process.pid}.csv`);
  fs.writeFileSync(tmp, "recording_id,tier,mode\nt1,standard,skip\n");
  const tierMap = loadTierMap(tmp);
  const verdict = triageRecording(recordFor("Reminder that this call is under NDA."), { rules, tierMap });
  assert.equal(verdict.tier, "standard");
  assert.equal(verdict.mode, "skip");
  assert.equal(verdict.tier_source, "map");
  fs.unlinkSync(tmp);
});
test("tier map rejects an invalid tier", () => {
  const tmp = path.join(os.tmpdir(), `plaud-tiers-bad-${process.pid}.csv`);
  fs.writeFileSync(tmp, "recording_id,tier\nt1,secret\n");
  assert.throws(() => loadTierMap(tmp), /not one of/);
  fs.unlinkSync(tmp);
});

console.log("parsing");
test("timestamped speaker lines become turns", () => {
  const turns = parseTranscriptText("[00:01:02] Speaker 1: Hello there.\n[00:01:09] Speaker 2: Hi.");
  assert.equal(turns.length, 2);
  assert.equal(turns[0].speaker, "Speaker 1");
  assert.equal(turns[1].text, "Hi.");
});
test("a sentence with a colon is not mistaken for a speaker label", () => {
  const turns = parseTranscriptText("We agreed on one thing only: ship on Friday.");
  assert.equal(turns[0].speaker, null);
});
test("splitSections keeps the original heading casing", () => {
  const sections = splitSections("# My Title\nbody text");
  assert.equal(sections["my title"].heading, "My Title");
  assert.equal(sections["my title"].body, "body text");
});
test("chunkTurns splits on turn boundaries, never mid-line", () => {
  const turns = Array.from({ length: 40 }, (_, i) => ({
    time: null,
    speaker: "A",
    text: `sentence number ${i} with some filler words to add length here`,
  }));
  const chunks = chunkTurns(turns, 100);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    for (const line of chunk.split("\n")) assert.match(line, /^A: sentence number \d+/);
  }
});
test("discoverRecordings reads all three fixture layouts", () => {
  const { records } = discoverRecordings(path.join(recipeDir, "fixtures"));
  const byId = Object.fromEntries(records.map((r) => [r.recording_id, r]));
  assert.equal(records.length, 5);
  assert.equal(byId.rec_1001.layout, "directory");
  // rec_1005 is the no-summary case: a transcript with no summary.md.
  assert.equal(byId.rec_1005.summary, "");
  assert.ok(byId.rec_1005.transcript.trim().length > 0);
  assert.equal(byId.rec_1003.layout, "flat");
  assert.equal(byId.rec_1004.layout, "obsidian-md");
  // The unofficial-CLI JSON's trans_result wins over the rendered text file.
  assert.deepEqual(byId.rec_1003.speakers, ["Dana", "Priya"]);
  assert.ok(byId.rec_1001.summary.includes("feature flag"));
});

console.log("export parsing");
test("parseListing accepts an array, an object wrapper, and NDJSON", () => {
  assert.equal(parseListing('[{"id":"a"}]').length, 1);
  assert.equal(parseListing('{"files":[{"id":"a"},{"id":"b"}]}').length, 2);
  assert.equal(parseListing('{"id":"a"}\n{"id":"b"}').length, 2);
});
test("parseListing names what it expected when the shape is unknown", () => {
  assert.throws(() => parseListing('{"status":"ok"}'), /Expected one of the array keys/);
  assert.throws(() => parseListing(""), /printed nothing on stdout/);
});
test("entriesToRecords fails loudly when no entry carries an id", () => {
  assert.throws(() => entriesToRecords([{ name: "x" }]), /none carried a recording id/);
  assert.equal(entriesToRecords([{ file_id: "x" }])[0].id, "x");
});

console.log("providers");
test("excerptTranscript trims to whole words and marks truncation", () => {
  const long = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
  const out = excerptTranscript(long, 10);
  assert.equal(out.split(" ").length, 10, "keeps exactly the requested word count");
  assert.ok(out.endsWith("…"), "marks that it was cut");
  assert.ok(!out.includes("  "), "collapses whitespace");
  assert.equal(excerptTranscript("short one", 10), "short one", "returns short input unchanged");
  assert.equal(excerptTranscript("", 10), "", "empty in, empty out");
  assert.equal(excerptTranscript(null, 10), "", "null is not a crash");
});

test("parseAtomsFromResponse pulls the array out of chatty output", () => {
  const atoms = parseAtomsFromResponse('Sure!\n```json\n["one", "two", ""]\n```');
  assert.deepEqual(atoms, ["one", "two"]);
});
test("provider precedence: explicit flag beats env, OpenRouter beats the rest", () => {
  const env = { OPENROUTER_API_KEY: "x", ANTHROPIC_API_KEY: "y", GEMINI_API_KEY: "z" };
  assert.equal(resolveProvider(env, null, null).provider, "openrouter");
  assert.equal(resolveProvider(env, "gemini", null).provider, "gemini");
  assert.equal(resolveProvider(env, "gemini", "my-model").model, "my-model");
  assert.equal(resolveProvider({ GEMINI_API_KEY: "z" }, null, null).provider, "gemini");
  assert.throws(() => resolveProvider({}, null, null), /No LLM provider available/);
  assert.throws(() => resolveProvider(env, "llama", null), /Unknown provider/);
});

console.log("share links");
test("parseShareId accepts the full share URL", () => {
  const { shareId, uuid, token } = parseShareId(
    "https://web.plaud.ai/s/pub_11111111-2222-3333-4444-555555555555::AbCdEf0123-_xyz",
  );
  assert.equal(shareId, "pub_11111111-2222-3333-4444-555555555555::AbCdEf0123-_xyz");
  assert.equal(uuid, "pub_11111111-2222-3333-4444-555555555555");
  assert.equal(token, "AbCdEf0123-_xyz");
});
test("parseShareId accepts the inner /nshare/ URL and a percent-encoded ::", () => {
  assert.equal(
    parseShareId("https://web.plaud.ai/nshare/pub_11111111-2222-3333-4444-555555555555%3A%3AAbCdEf0123")
      .shareId,
    "pub_11111111-2222-3333-4444-555555555555::AbCdEf0123",
  );
});
test("parseShareId accepts a bare id, with or without the token", () => {
  assert.equal(
    parseShareId("  pub_11111111-2222-3333-4444-555555555555::AbCdEf0123  ").shareId,
    "pub_11111111-2222-3333-4444-555555555555::AbCdEf0123",
  );
  // The API answers for the uuid alone, so a link truncated at "::" still works.
  const bare = parseShareId("pub_11111111-2222-3333-4444-555555555555");
  assert.equal(bare.token, null);
  assert.equal(bare.uuid, "pub_11111111-2222-3333-4444-555555555555");
});
test("parseShareId rejects malformed input rather than asking the API", () => {
  // The share API answers garbage ids with HTTP 200 + {"status":40400}, so a
  // bad id must be caught here or it looks like a dead link.
  assert.throws(() => parseShareId("not-a-share-id"), /not a Plaud share id/);
  assert.throws(() => parseShareId(""), /No share link given/);
  assert.throws(() => parseShareId("https://web.plaud.ai/file/abc123"), /not a Plaud share path/);
  assert.throws(() => parseShareId("pub_short::x"), /not a Plaud share id/);
});

test("mediaFilename keeps a sane basename, sanitizes the rest, and de-duplicates", () => {
  const taken = new Set();
  assert.equal(mediaFilename("permanent/abc/mark/20260101_000000_aa.jpg", taken), "20260101_000000_aa.jpg");
  assert.equal(mediaFilename("permanent/abc/poster/card@v2 copy.png", taken), "card_v2_copy.png");
  assert.equal(mediaFilename("permanent/other/card@v2 copy.png", taken), "card_v2_copy-2.png");
  assert.equal(mediaFilename("permanent/abc/blob", new Set()), "blob.bin");
});

test("planRecording lands in the layout discoverRecordings reads", () => {
  // Fictional payload shaped like GET /share/access/<id>.
  const payload = {
    status: 0,
    object_type: "file",
    owner_name: "",
    is_trans: 1,
    is_ai_content: 1,
    data_file: {
      id: "aaaabbbbccccdddd",
      filename: "Widget roadmap sync",
      start_time: 1746093600000,
      duration: 1800000,
      file_language: "en",
      trans_result: [
        { start_time: 0, end_time: 4000, speaker: "Robin", content: "Shipping the widget Friday." },
        { start_time: 4000, end_time: 9000, speaker: "Sam", content: "I will write the release note." },
      ],
      notes_list: [
        {
          data_type: "auto_sum_note",
          data_tab_name: "Summary",
          data_content:
            "![PLAUD NOTE](permanent/x/summary_poster/card_1.png)\n\nRobin and Sam agreed the widget ships Friday.\n\n" +
            "## Action Items\n\n- [ ] Sam writes the release note\n",
        },
        {
          data_type: "high_light",
          data_tab_name: "Highlights",
          data_content: JSON.stringify([
            {
              timestamp: 4000,
              mark_type_string: "image",
              title: "Whiteboard: release plan",
              content: "The board lists three launch gates.",
              picture_link: "permanent/x/mark/board.jpg",
            },
          ]),
        },
      ],
      download_link_map: {
        "permanent/x/summary_poster/card_1.png": "https://example.invalid/card_1.png",
        "permanent/x/mark/board.jpg": "https://example.invalid/board.jpg",
      },
    },
  };

  const plan = planRecording(payload, {
    shareId: "pub_11111111-2222-3333-4444-555555555555::AbCdEf0123",
    shareUrl: "https://web.plaud.ai/s/pub_11111111-2222-3333-4444-555555555555::AbCdEf0123",
    idOverride: null,
    includeMedia: true,
  });

  assert.equal(plan.recordingId, "aaaabbbbccccdddd");
  assert.deepEqual(plan.files.map((f) => f.name), ["meta.json", "transcript.txt", "summary.md"]);

  const meta = JSON.parse(plan.files[0].text);
  assert.equal(meta.title, "Widget roadmap sync");
  assert.equal(meta.start_time, 1746093600000);
  assert.deepEqual(meta.speakers, ["Robin", "Sam"]);
  assert.match(meta.share_url, /^https:\/\/web\.plaud\.ai\/s\//);

  const transcript = plan.files[1].text;
  assert.match(transcript, /^\[00:00:00\] Robin: Shipping the widget Friday\.$/m);
  assert.match(transcript, /^\[00:00:04\] Sam: I will write the release note\.$/m);

  // S3 object keys must be rewritten to the local media/ path, or the summary
  // carries dead references once the presigned URLs expire.
  const summaryDoc = plan.files[2].text;
  assert.ok(!summaryDoc.includes("permanent/x/"), "S3 keys should be rewritten");
  assert.match(summaryDoc, /!\[PLAUD NOTE\]\(media\/card_1\.png\)/);
  assert.match(summaryDoc, /!\[Whiteboard: release plan\]\(media\/board\.jpg\)/);

  // The acceptance criterion: splitSummaryDoc must pull BOTH Plaud's own
  // "## Action Items" and our "## Highlights" out of the body.
  const split = splitSummaryDoc(summaryDoc);
  assert.match(split.highlights, /Action Items:/);
  assert.match(split.highlights, /Sam writes the release note/);
  assert.match(split.highlights, /Highlights:/);
  assert.match(split.highlights, /Whiteboard: release plan/);
  assert.match(split.summary, /Robin and Sam agreed the widget ships Friday/);
  assert.ok(!split.summary.includes("Sam writes the release note"), "action items belong in highlights");
});

test("planRecording refuses a share with neither transcript nor summary", () => {
  assert.throws(
    () =>
      planRecording(
        { status: 0, is_trans: 0, is_ai_content: 0, data_file: { id: "x", filename: "Empty" } },
        { shareId: "pub_11111111-2222-3333-4444-555555555555::AbCdEf0123", shareUrl: "u" },
      ),
    /neither a transcript nor a summary/,
  );
});

test("planRecording survives a highlights note that is not valid JSON", () => {
  const plan = planRecording(
    {
      status: 0,
      is_trans: 1,
      is_ai_content: 1,
      data_file: {
        id: "y",
        filename: "Partial",
        trans_result: [{ start_time: 0, speaker: "Robin", content: "Hello." }],
        notes_list: [{ data_type: "high_light", data_tab_name: "Highlights", data_content: "{not json" }],
      },
    },
    { shareId: "pub_11111111-2222-3333-4444-555555555555::AbCdEf0123", shareUrl: "u" },
  );
  assert.ok(plan.warnings.some((w) => /not parseable JSON/.test(w)));
  assert.deepEqual(plan.files.map((f) => f.name), ["meta.json", "transcript.txt"]);
});

console.log("args");
test("optional-value flags work with and without a value", () => {
  const a = parseArgs(["--llm", "gemini", "folder"], { optionalValues: ["llm"] });
  assert.equal(a.flags.llm, "gemini");
  assert.equal(a.positional[0], "folder");
  const b = parseArgs(["--llm", "--dry-run"], { optionalValues: ["llm"], booleans: ["dry-run"] });
  assert.equal(b.flags.llm, true);
  assert.equal(b.flags["dry-run"], true);
});

console.log();
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
