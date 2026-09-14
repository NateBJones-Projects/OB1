#!/usr/bin/env node
/**
 * fake-plaud-cli.mjs — a stand-in for `@plaud-ai/cli`, for testing
 * `export-plaud.mjs` without a Plaud account.
 *
 * It implements the four subcommands the exporter uses, in the shape the Plaud
 * docs describe ("clean JSON/text to stdout"). Because the real CLI's output
 * was never verified against a live account, this file is a guess, not a
 * specification — it exists to prove the exporter's plumbing and its
 * validation, not to prove the real CLI matches.
 *
 *   node test/fake-plaud-cli.mjs files --page 1 --page-size 100
 *   node test/fake-plaud-cli.mjs file <id>
 *   node test/fake-plaud-cli.mjs transcript <id>
 *   node test/fake-plaud-cli.mjs summary <id>
 *
 * Set FAKE_PLAUD_BROKEN=listing|meta|empty to make it return a malformed
 * response, which the exporter must reject with a clear message.
 */

const RECORDINGS = [
  {
    id: "fake_2001",
    name: "Quarterly planning sync",
    start_at: "2026-04-02T16:00:00Z",
    duration: 2700000,
    serial_number: "FAKE-2001",
  },
  {
    id: "fake_2002",
    name: "Evening voice memo",
    start_at: "2026-04-03T02:15:00Z",
    duration: 300000,
    serial_number: "FAKE-2002",
  },
];

const TRANSCRIPTS = {
  fake_2001: `[00:00:04] Speaker 1: Let's lock the quarterly plan before the roadmap review.
[00:00:18] Speaker 2: The backlog is groomed. I'd like the sprint boundaries to stay at two weeks.
[00:00:41] Speaker 1: Agreed. Decision: two-week sprints, review on the last Thursday.
[00:01:07] Speaker 2: I'll update the planning doc and share it with the team tomorrow.`,
  fake_2002: `Quick memo before bed. I want to keep Friday mornings free for deep work.
Also need to reply to the workshop invitation by the end of the week.`,
};

const SUMMARIES = {
  fake_2001: `# Quarterly planning sync

Two-week sprints confirmed, with the review on the last Thursday of each cycle.

## Action Items
- Speaker 2: update the planning doc and share it with the team`,
  fake_2002: `# Evening voice memo

Wants Friday mornings reserved for deep work. Needs to reply to a workshop invitation this week.`,
};

const [command, ...rest] = process.argv.slice(2);
const broken = process.env.FAKE_PLAUD_BROKEN || "";

function pageArg(name, fallback) {
  const i = rest.indexOf(`--${name}`);
  return i > -1 ? Number(rest[i + 1]) : fallback;
}

if (command === "files") {
  if (broken === "listing") {
    process.stdout.write(JSON.stringify({ status: "ok", payload: { nothing: true } }));
    process.exit(0);
  }
  if (broken === "empty") {
    process.stdout.write("");
    process.exit(0);
  }
  const page = pageArg("page", 1);
  const pageSize = pageArg("page-size", 100);
  const slice = page === 1 ? RECORDINGS.slice(0, pageSize) : [];
  process.stdout.write(JSON.stringify({ files: slice, page, page_size: pageSize }));
  process.exit(0);
}

const id = rest.find((a) => !a.startsWith("--"));
const record = RECORDINGS.find((r) => r.id === id);
if (!record) {
  process.stderr.write(`no such recording: ${id}\n`);
  process.exit(3);
}

if (command === "file") {
  if (broken === "meta") {
    process.stdout.write(JSON.stringify({ name: record.name })); // no id field
    process.exit(0);
  }
  process.stdout.write(JSON.stringify(record));
} else if (command === "transcript") {
  process.stdout.write(TRANSCRIPTS[id] || "");
} else if (command === "summary") {
  process.stdout.write(SUMMARIES[id] || "");
} else {
  process.stderr.write(`unknown command: ${command}\n`);
  process.exit(2);
}
