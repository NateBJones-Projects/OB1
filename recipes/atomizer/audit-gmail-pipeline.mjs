#!/usr/bin/env node
/**
 * audit-gmail-pipeline.mjs — Gmail ingestion pipeline quality audit.
 *
 * Produces a structured JSON (or markdown) report covering:
 *   - Scale: thought counts, atomized vs whole-body, thread coverage, labels
 *   - Metadata completeness: thread_id / gmail_id / message_id / from / etc.
 *   - Entity graph integrity: entity counts, author/recipient/cc edge coverage
 *   - Classification & sensitivity distribution
 *   - Dedup / thread grouping posture
 *   - Top correspondents by authored-thought count
 *   - Atom-quality samples
 *   - Retrieval probes (entity-keyed, text-keyed)
 *
 * Usage:
 *   node audit-gmail-pipeline.mjs                     # JSON to stdout
 *   node audit-gmail-pipeline.mjs --md                # markdown report
 *   node audit-gmail-pipeline.mjs --md > AUDIT.md
 *
 * Env (from .env.local or process.env):
 *   SUPABASE_URL or SUPABASE_PROJECT_REF
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/entity-resolver.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = loadEnv(path.join(__dirname, ".env.local"));
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("missing env var SUPABASE_SERVICE_ROLE_KEY");
}
if (!env.SUPABASE_URL && !env.SUPABASE_PROJECT_REF) {
  throw new Error("missing env var SUPABASE_URL or SUPABASE_PROJECT_REF");
}

const BASE = env.SUPABASE_URL
  ? `${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1`
  : `https://${env.SUPABASE_PROJECT_REF}.supabase.co/rest/v1`;
const HEADERS = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
};

async function sbGet(pathQuery, extraHeaders = {}) {
  const res = await fetch(`${BASE}/${pathQuery}`, { headers: { ...HEADERS, ...extraHeaders } });
  if (!res.ok) throw new Error(`GET ${pathQuery}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function sbCount(pathQuery) {
  const res = await fetch(`${BASE}/${pathQuery}&limit=1`, { headers: { ...HEADERS, Prefer: "count=exact" } });
  if (!res.ok) {
    // Previously we silently returned 0 on any HTTP error, which made audits
    // falsely report "zero missing data" when auth or the query was broken.
    throw new Error(`COUNT ${pathQuery}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const cr = res.headers.get("content-range");
  const m = cr && cr.match(/\/(\d+|\*)$/);
  return m ? (m[1] === "*" ? 0 : parseInt(m[1], 10)) : 0;
}

const args = process.argv.slice(2);
const asMd = args.includes("--md");

const report = { generated_at: new Date().toISOString(), sections: {} };

// ── A. Scale & coverage ──────────────────────────────────────────────────────
const totalGmail = await sbCount(`thoughts?source_type=eq.gmail_export&select=id`);
const atomized = await sbCount(`thoughts?source_type=eq.gmail_export&metadata->gmail->>atom_count=not.is.null&metadata->gmail->>atom_index=not.is.null&select=id`);
const wholeBody = totalGmail - atomized;

// PostgREST returns jsonb extractors under a version-dependent column name
// unless we alias them explicitly. `thread_id:metadata->gmail->>thread_id`
// guarantees the value ends up on `r.thread_id` across PostgREST versions.
const threadCovRows = await sbGet(
  `thoughts?source_type=eq.gmail_export&select=thread_id:metadata->gmail->>thread_id&limit=10000`,
);
const uniqueThreads = new Set(threadCovRows.map((r) => r.thread_id).filter(Boolean));

const labelSample = await sbGet(
  `thoughts?source_type=eq.gmail_export&select=labels:metadata->gmail->labels&limit=500`,
);
const labelCounts = {};
for (const row of labelSample) {
  const labels = row.labels || [];
  if (Array.isArray(labels)) {
    for (const l of labels) labelCounts[l] = (labelCounts[l] || 0) + 1;
  }
}

report.sections.scale = {
  total_gmail_thoughts: totalGmail,
  atomized_thoughts: atomized,
  whole_body_thoughts: wholeBody,
  unique_thread_ids_seen: uniqueThreads.size,
  label_counts_sample_500: labelCounts,
};

// ── B. Metadata completeness ─────────────────────────────────────────────────
const missingThreadId = await sbCount(`thoughts?source_type=eq.gmail_export&metadata->gmail->>thread_id=is.null&select=id`);
const missingGmailId = await sbCount(`thoughts?source_type=eq.gmail_export&metadata->gmail->>gmail_id=is.null&select=id`);
const missingMessageId = await sbCount(`thoughts?source_type=eq.gmail_export&metadata->gmail->>message_id=is.null&select=id`);
const missingFrom = await sbCount(`thoughts?source_type=eq.gmail_export&metadata->gmail->>from=is.null&select=id`);
const missingCorrespondents = await sbCount(`thoughts?source_type=eq.gmail_export&metadata->gmail->>correspondents=is.null&select=id`);
const hasInReplyTo = await sbCount(`thoughts?source_type=eq.gmail_export&metadata->gmail->>in_reply_to=not.is.null&select=id`);

report.sections.metadata = {
  missing_thread_id: missingThreadId,
  missing_gmail_id: missingGmailId,
  missing_message_id: missingMessageId,
  missing_from_header: missingFrom,
  missing_correspondents_structure: missingCorrespondents,
  has_in_reply_to: hasInReplyTo,
};

// ── C. Entity graph ──────────────────────────────────────────────────────────
const totalEntities = await sbCount(`entities?select=id`);
const personEntities = await sbCount(`entities?entity_type=eq.person&select=id`);
const entitiesWithEmail = await sbCount(`entities?canonical_email=not.is.null&select=id`);
const entitiesFromHeader = await sbCount(`entities?metadata->>discovered_via=eq.email_header&select=id`);
const gmailHeaderEdges = await sbCount(`thought_entities?source=eq.gmail_header&select=thought_id`);
const authorEdges = await sbCount(`thought_entities?source=eq.gmail_header&mention_role=eq.author&select=thought_id`);
const recipientEdges = await sbCount(`thought_entities?source=eq.gmail_header&mention_role=eq.recipient&select=thought_id`);
const ccEdges = await sbCount(`thought_entities?source=eq.gmail_header&mention_role=eq.cc&select=thought_id`);

const allGmailIds = (await sbGet(`thoughts?source_type=eq.gmail_export&select=id&limit=10000`)).map((r) => r.id);
const authoredIds = new Set(
  (await sbGet(`thought_entities?source=eq.gmail_header&mention_role=eq.author&select=thought_id&limit=10000`)).map((r) => r.thought_id),
);
const gmailMissingAuthor = allGmailIds.filter((id) => !authoredIds.has(id));

const repliesToEdges = await sbCount(`thought_edges?relation=eq.replies_to&select=from_thought_id`);

report.sections.entity_graph = {
  entities_total: totalEntities,
  entities_person: personEntities,
  entities_with_canonical_email: entitiesWithEmail,
  entities_discovered_via_email_header: entitiesFromHeader,
  gmail_header_edges_total: gmailHeaderEdges,
  edges_by_role: { author: authorEdges, recipient: recipientEdges, cc: ccEdges },
  gmail_thoughts_missing_author_edge: gmailMissingAuthor.length,
  gmail_thoughts_missing_author_edge_sample: gmailMissingAuthor.slice(0, 10),
  replies_to_edges: repliesToEdges,
};

// ── D. Classification & sensitivity ──────────────────────────────────────────
const typeRows = await sbGet(`thoughts?source_type=eq.gmail_export&select=type&limit=10000`);
const typeCounts = {};
for (const r of typeRows) typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;

const impRows = await sbGet(`thoughts?source_type=eq.gmail_export&select=importance&limit=10000`);
const impCounts = {};
for (const r of impRows) impCounts[r.importance] = (impCounts[r.importance] || 0) + 1;

const sensRows = await sbGet(`thoughts?source_type=eq.gmail_export&select=sensitivity_tier&limit=10000`);
const sensCounts = {};
for (const r of sensRows) sensCounts[r.sensitivity_tier] = (sensCounts[r.sensitivity_tier] || 0) + 1;

report.sections.classification = {
  type_distribution: typeCounts,
  importance_distribution: impCounts,
  sensitivity_tier_distribution: sensCounts,
};

// ── E. Dedup / thread grouping ───────────────────────────────────────────────
const threadIdSample = Array.from(uniqueThreads).slice(0, 5);
const threadGroups = {};
for (const tid of threadIdSample) {
  const rows = await sbGet(
    `thoughts?source_type=eq.gmail_export`
    + `&metadata->gmail->>thread_id=eq.${encodeURIComponent(tid)}`
    + `&select=id,atom_index:metadata->gmail->>atom_index,atom_count:metadata->gmail->>atom_count`
    + `&limit=200`,
  );
  threadGroups[tid] = { msgs_in_db: rows.length, sample_ids: rows.slice(0, 5).map((r) => r.id) };
}
report.sections.threads_sample = threadGroups;

// ── F. Top correspondents ────────────────────────────────────────────────────
const allAuthorEdges = await sbGet(`thought_entities?source=eq.gmail_header&mention_role=eq.author&select=entity_id&limit=10000`);
const authorFreq = {};
for (const e of allAuthorEdges) authorFreq[e.entity_id] = (authorFreq[e.entity_id] || 0) + 1;
const topAuthors = Object.entries(authorFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);
const topAuthorIds = topAuthors.map(([id]) => id);
const topAuthorRows = topAuthorIds.length > 0
  ? await sbGet(`entities?id=in.(${topAuthorIds.join(",")})&select=id,canonical_name,canonical_email`)
  : [];
const topAuthorMap = new Map(topAuthorRows.map((r) => [r.id, r]));
report.sections.top_correspondents = topAuthors.map(([id, count]) => ({
  entity_id: +id,
  count,
  canonical_name: topAuthorMap.get(+id)?.canonical_name,
  canonical_email: topAuthorMap.get(+id)?.canonical_email,
}));

// ── G. Atom quality sample ───────────────────────────────────────────────────
const atomSampleRows = await sbGet(
  `thoughts?source_type=eq.gmail_export`
  + `&metadata->gmail->>atom_count=gt.1`
  + `&select=id,content,atom_index:metadata->gmail->>atom_index,atom_count:metadata->gmail->>atom_count`
  + `&order=id.desc&limit=15`,
);
report.sections.atom_samples = atomSampleRows.map((r) => ({
  id: r.id,
  atom_index: r.atom_index,
  atom_count: r.atom_count,
  content_preview: r.content ? r.content.slice(0, 240) + (r.content.length > 240 ? "..." : "") : null,
  word_count: r.content ? r.content.split(/\s+/).filter(Boolean).length : 0,
}));

// ── H. Retrieval probes ──────────────────────────────────────────────────────
const retrievalProbes = [];
if (topAuthors.length > 0) {
  const [authId, edgeCount] = topAuthors[0];
  const thoughtIds = (await sbGet(`thought_entities?entity_id=eq.${authId}&mention_role=eq.author&select=thought_id&limit=500`)).map((r) => r.thought_id);
  const row = topAuthorMap.get(+authId);
  retrievalProbes.push({
    probe: `all thoughts authored by top correspondent (${row?.canonical_name})`,
    entity_id: +authId,
    email: row?.canonical_email,
    expected_count: edgeCount,
    found_count: thoughtIds.length,
    match: thoughtIds.length === edgeCount ? "OK" : "MISMATCH",
    sample_ids: thoughtIds.slice(0, 5),
  });
}

const textHits = await sbGet(`thoughts?source_type=eq.gmail_export&content=ilike.*email*&select=id&limit=5`);
retrievalProbes.push({
  probe: `text-search thoughts containing "email" (heuristic)`,
  found_count: textHits.length,
});

report.sections.retrieval_probes = retrievalProbes;

// ── Output ───────────────────────────────────────────────────────────────────
if (!asMd) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const s = report.sections;
  const lines = [];
  lines.push(`# Gmail ingestion quality audit`);
  lines.push(`\nGenerated ${report.generated_at}\n`);
  lines.push(`## A. Scale\n`);
  lines.push(`- Total gmail thoughts: **${s.scale.total_gmail_thoughts}**`);
  lines.push(`- Atomized thoughts: **${s.scale.atomized_thoughts}**`);
  lines.push(`- Whole-body (non-atomized): **${s.scale.whole_body_thoughts}**`);
  lines.push(`- Unique thread_ids: **${s.scale.unique_thread_ids_seen}**`);
  lines.push(`- Label distribution (sample 500):`);
  for (const [k, v] of Object.entries(s.scale.label_counts_sample_500).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    lines.push(`  - ${k}: ${v}`);
  }
  lines.push(`\n## B. Metadata completeness\n`);
  const missing = Object.entries(s.metadata);
  for (const [k, v] of missing) lines.push(`- ${k}: **${v}**`);
  lines.push(`\n## C. Entity graph\n`);
  lines.push(`- Entities total: **${s.entity_graph.entities_total}** (${s.entity_graph.entities_person} person)`);
  lines.push(`- With canonical_email: **${s.entity_graph.entities_with_canonical_email}**`);
  lines.push(`  - Discovered via email_header: **${s.entity_graph.entities_discovered_via_email_header}**`);
  lines.push(`- gmail_header edges: **${s.entity_graph.gmail_header_edges_total}** (author ${s.entity_graph.edges_by_role.author}, recipient ${s.entity_graph.edges_by_role.recipient}, cc ${s.entity_graph.edges_by_role.cc})`);
  lines.push(`- Gmail thoughts missing author edge: **${s.entity_graph.gmail_thoughts_missing_author_edge}**`);
  if (s.entity_graph.gmail_thoughts_missing_author_edge > 0) {
    lines.push(`  - Sample IDs: ${s.entity_graph.gmail_thoughts_missing_author_edge_sample.join(", ")}`);
  }
  lines.push(`- replies_to edges: **${s.entity_graph.replies_to_edges}**`);
  lines.push(`\n## D. Classification\n`);
  lines.push(`- type: ${JSON.stringify(s.classification.type_distribution)}`);
  lines.push(`- importance: ${JSON.stringify(s.classification.importance_distribution)}`);
  lines.push(`- sensitivity_tier: ${JSON.stringify(s.classification.sensitivity_tier_distribution)}`);
  lines.push(`\n## E. Top correspondents\n`);
  for (const t of s.top_correspondents) {
    lines.push(`- ${t.canonical_name || "(no name)"} <${t.canonical_email || "no email"}> → ${t.count} authored thoughts`);
  }
  lines.push(`\n## F. Atom samples (up to 15)\n`);
  for (const a of s.atom_samples) {
    lines.push(`- #${a.id} atom ${a.atom_index}/${a.atom_count} (${a.word_count}w): ${a.content_preview}`);
  }
  lines.push(`\n## G. Retrieval probes\n`);
  for (const p of s.retrieval_probes) {
    lines.push(`- ${p.probe}: found ${p.found_count}${p.expected_count !== undefined ? `/${p.expected_count} ${p.match}` : ""}`);
  }
  console.log(lines.join("\n"));
}
