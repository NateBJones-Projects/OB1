#!/usr/bin/env node
/**
 * test-attribution.mjs — self-test for the pure classifier (no DB).
 *
 * Run: node test-attribution.mjs
 * Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";
import {
  classifySpeakers,
  isGenericSpeaker,
  isSelfSpeaker,
  resolveSpeaker,
  roleFromAttribution,
  selfLabelSet,
} from "./lib/speaker-attribution.mjs";

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// self detection (device-generic + custom labels)
check("'You' is self by default", () => assert.equal(isSelfSpeaker("You"), true));
check("custom label is self", () => assert.equal(isSelfSpeaker("Alex", selfLabelSet("Alex")), true));
check("named other is not self", () => assert.equal(isSelfSpeaker("Sam"), false));

// generic placeholders
check("'Speaker 1' is generic", () => assert.equal(isGenericSpeaker("Speaker 1"), true));
check("'Unknown' is generic", () => assert.equal(isGenericSpeaker("Unknown"), true));
check("'Sam' is not generic", () => assert.equal(isGenericSpeaker("Sam"), false));

// resolveSpeaker stub
check("resolveSpeaker self", () => assert.equal(resolveSpeaker("me").kind, "self"));
check("resolveSpeaker named", () => assert.equal(resolveSpeaker("Dana").kind, "named"));
check("resolveSpeaker generic", () => assert.equal(resolveSpeaker("Speaker 2").kind, "generic"));

// classifySpeakers — the core matrix
check("self only -> self/author", () => {
  const r = classifySpeakers(["You"]);
  assert.deepEqual(r, { attribution: "self", selfPresent: true, role: "author" });
});
check("named other only -> other/null", () => {
  const r = classifySpeakers(["Dana"]);
  assert.deepEqual(r, { attribution: "other", selfPresent: false, role: null });
});
check("self + named other -> mixed/participant", () => {
  const r = classifySpeakers(["You", "Dana"]);
  assert.deepEqual(r, { attribution: "mixed", selfPresent: true, role: "participant" });
});
check("only generic -> unknown", () => {
  const r = classifySpeakers(["Speaker 1", "Speaker 2"]);
  assert.deepEqual(r, { attribution: "unknown", selfPresent: false, role: null });
});
check("no utterances -> machine", () => {
  const r = classifySpeakers([], { hasUtterances: false });
  assert.deepEqual(r, { attribution: "machine", selfPresent: false, role: null });
});
check("custom self label flips other->self", () => {
  const r = classifySpeakers(["Alex"], { selfLabels: "Alex" });
  assert.equal(r.attribution, "self");
});
check("generic alongside self stays self (generic ignored)", () => {
  const r = classifySpeakers(["You", "Speaker 3"]);
  assert.equal(r.attribution, "self");
});

// roleFromAttribution — the backfill's role source when speakers aren't listed
check("roleFromAttribution self -> author", () => assert.equal(roleFromAttribution("self"), "author"));
check("roleFromAttribution mixed -> participant", () => assert.equal(roleFromAttribution("mixed"), "participant"));
check("roleFromAttribution other -> null", () => assert.equal(roleFromAttribution("other"), null));
check("roleFromAttribution machine -> null", () => assert.equal(roleFromAttribution("machine"), null));
check("classifySpeakers role agrees with roleFromAttribution", () => {
  const r = classifySpeakers(["You", "Dana"]);
  assert.equal(r.role, roleFromAttribution(r.attribution));
});

console.log(`\n${passed} assertions passed.`);
