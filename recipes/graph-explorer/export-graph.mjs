#!/usr/bin/env node
/**
 * Graph Explorer — export-graph.mjs
 *
 * Builds a knowledge-graph JSON from your Open Brain and writes a single,
 * self-contained `graph-explorer.html` (data inlined) that opens straight
 * from file:// — no server, no build step, no npm install.
 *
 * Usage:
 *   node export-graph.mjs --dry-run                       # counts only, writes nothing
 *   node export-graph.mjs                                 # write output/graph.json + output/graph-explorer.html
 *   node export-graph.mjs --cooccurrence --min-weight 3   # add topic<->topic edges
 *   node export-graph.mjs --alias-map alias-map.json      # merge "Jane" into "Jane Doe", etc.
 *   node export-graph.mjs --mode entities                 # force the entity-extraction graph
 *   node export-graph.mjs --from-json sample.json         # offline testing aid (no network)
 *
 * Env (loads `.env.local` in this recipe folder, layered over process.env):
 *   OPEN_BRAIN_URL          (required unless --from-json)  https://<ref>.supabase.co
 *   OPEN_BRAIN_SERVICE_KEY  (required unless --from-json)  Supabase secret / service-role key
 *
 * Data sources (auto-detected, see --mode):
 *   metadata  — any brain that ran recipes/thought-enrichment. Nodes are
 *               thoughts + metadata.topics[] + metadata.people[].
 *   entities  — brains with schemas/entity-extraction (public.entities,
 *               public.thought_entities, public.edges) and optionally
 *               schemas/typed-reasoning-edges (public.thought_edges).
 *
 * Privacy: restricted-tier thoughts are excluded by default. The content of a
 * restricted thought is never inlined, even with --include-content.
 *
 * Node 18+ built-ins only.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(HERE, "template.html");
const DEFAULT_OUT_DIR = path.join(HERE, "output");
const PAGE_SIZE = 1000;
const LABEL_MAX = 80;
const UUID_ZERO = "00000000-0000-0000-0000-000000000000";
const FETCH_TIMEOUT_MS = 60_000;

const HELP = `
Graph Explorer — export a force-directed knowledge graph from Open Brain

  node export-graph.mjs [flags]

Flags
  --mode <auto|metadata|entities>  Data source. auto (default) picks "entities" when
                                   public.entities + thought_entities + edges exist.
  --since <date>                   Only thoughts created on/after this ISO date.
  --limit <n>                      Stop after n thoughts (keyset order by id).
  --min-degree <n>                 Drop topic/person/entity nodes with fewer links (default 2).
  --exclude-tier <a,b>             Sensitivity tiers to exclude (default: restricted).
                                   Use "none" to include everything.
  --alias-map <file.json>          Merge name variants. See alias-map.example.json.
  --cooccurrence                   Add topic<->topic edges weighted by shared thoughts.
  --min-weight <n>                 Minimum shared thoughts for a co-occurrence edge (default 2).
  --include-content                Inline full thought content for the detail pane
                                   (never for restricted-tier thoughts).
  --out-dir <dir>                  Output directory (default: ./output next to this script).
  --from-json <file>               TESTING AID. Read thought rows from a JSON file instead
                                   of PostgREST. Forces metadata mode. No credentials needed.
  --dry-run                        Print counts only. Writes nothing.
  --help                           This text.

Env: OPEN_BRAIN_URL, OPEN_BRAIN_SERVICE_KEY (from .env.local in this folder or the shell).
`.trim();

// ── CLI ───────────────────────────────────────────────────────────────────

const BOOL_FLAGS = new Set(["dry-run", "cooccurrence", "include-content", "help"]);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) fail(`Unexpected argument: ${a}`);
    let key = a.slice(2);
    let val;
    const eq = key.indexOf("=");
    if (eq !== -1) {
      val = key.slice(eq + 1);
      key = key.slice(0, eq);
    }
    if (BOOL_FLAGS.has(key)) {
      out[key] = val === undefined ? true : val !== "false";
      continue;
    }
    if (val === undefined) {
      val = argv[i + 1];
      if (val === undefined || val.startsWith("--")) fail(`Flag --${key} needs a value`);
      i++;
    }
    out[key] = val;
  }
  return out;
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function toInt(v, name, def) {
  if (v === undefined) return def;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) fail(`--${name} must be a non-negative integer`);
  return n;
}

// ── Env ───────────────────────────────────────────────────────────────────

function readEnvLocal(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

// ── PostgREST client (keyset pagination only) ─────────────────────────────
//
// Offset pagination is deliberately not used. It is fragile against
// concurrent writes and, on large tables, gets slower per page. Keyset on the
// primary key (`id=gt.<last>&order=id.asc`) is stable and O(page).

class BrainApi {
  constructor(projectUrl, serviceKey) {
    this.base = `${projectUrl.replace(/\/+$/, "")}/rest/v1`;
    this.headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    };
  }

  async get(qs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.base}/${qs}`, { headers: this.headers, signal: ctrl.signal });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text, json: res.ok ? JSON.parse(text || "[]") : null };
    } finally {
      clearTimeout(timer);
    }
  }

  async mustGet(qs) {
    const r = await this.get(qs);
    if (!r.ok) throw new Error(`GET ${qs.split("?")[0]} -> ${r.status}: ${r.text.slice(0, 300)}`);
    return r.json;
  }

  /** True if the table is reachable through PostgREST. */
  async tableExists(table) {
    const r = await this.get(`${table}?select=*&limit=1`);
    if (r.ok) return true;
    if (r.status === 404 || r.status === 400 || r.status === 406) return false;
    throw new Error(`Probing ${table} failed -> ${r.status}: ${r.text.slice(0, 200)}`);
  }

  /** Keyset-paginate a table on a single monotonic key column. */
  async fetchAll(table, { select, filters = [], key = "id", start, limit = Infinity, onPage } = {}) {
    const rows = [];
    let cursor = start;
    while (rows.length < limit) {
      const pageSize = Math.min(PAGE_SIZE, limit - rows.length);
      const parts = [`select=${select}`, ...filters, `order=${key}.asc`, `limit=${pageSize}`];
      if (cursor !== undefined) parts.push(`${key}=gt.${encodeURIComponent(cursor)}`);
      const page = await this.mustGet(`${table}?${parts.join("&")}`);
      if (!page.length) break;
      rows.push(...page);
      cursor = page[page.length - 1][key];
      if (onPage) onPage(rows.length);
      if (page.length < pageSize) break;
    }
    return rows;
  }

  /** Keyset-paginate thought_entities on its composite (thought_id, entity_id) key. */
  async fetchThoughtEntities() {
    const rows = [];
    let last = null;
    for (;;) {
      const parts = [
        "select=thought_id,entity_id,mention_role,confidence",
        "order=thought_id.asc,entity_id.asc",
        `limit=${PAGE_SIZE}`,
      ];
      if (last) {
        parts.push(
          `or=(thought_id.gt.${last.thought_id},and(thought_id.eq.${last.thought_id},entity_id.gt.${last.entity_id}))`,
        );
      }
      const page = await this.mustGet(`thought_entities?${parts.join("&")}`);
      if (!page.length) break;
      rows.push(...page);
      last = page[page.length - 1];
      if (page.length < PAGE_SIZE) break;
    }
    return rows;
  }
}

// ── Thoughts ──────────────────────────────────────────────────────────────

const BASE_COLS = ["id", "created_at", "metadata"];
const OPTIONAL_COLS = ["type", "importance", "source_type", "sensitivity_tier"];

/**
 * Enhanced-thoughts columns (type, importance, source_type, sensitivity_tier)
 * only exist once schemas/enhanced-thoughts is applied. Probe once and drop
 * whichever columns PostgREST rejects so a stock brain still exports.
 */
async function probeThoughtColumns(api, includeContent) {
  let cols = [...BASE_COLS, ...OPTIONAL_COLS, ...(includeContent ? ["content"] : [])];
  for (let attempt = 0; attempt < OPTIONAL_COLS.length + 1; attempt++) {
    const r = await api.get(`thoughts?select=${cols.join(",")}&limit=1`);
    if (r.ok) return cols;
    const missing = OPTIONAL_COLS.find((c) => r.status === 400 && r.text.includes(`thoughts.${c}`));
    if (!missing) throw new Error(`Cannot read thoughts -> ${r.status}: ${r.text.slice(0, 300)}`);
    console.warn(`  note: column "${missing}" not found on thoughts — continuing without it`);
    cols = cols.filter((c) => c !== missing);
  }
  return cols;
}

async function fetchThoughts(api, args, cols) {
  const filters = [];
  if (args.excludeTiers.length && cols.includes("sensitivity_tier")) {
    const list = args.excludeTiers.map(encodeURIComponent).join(",");
    filters.push(`or=(sensitivity_tier.is.null,sensitivity_tier.not.in.(${list}))`);
  }
  if (args.since) filters.push(`created_at=gte.${encodeURIComponent(args.since)}`);
  return api.fetchAll("thoughts", {
    select: cols.join(","),
    filters,
    key: "id",
    start: UUID_ZERO,
    limit: args.limit,
    onPage: (n) => process.stderr.write(`\r  thoughts fetched: ${n}   `),
  });
}

function loadFromJson(file, args) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = Array.isArray(raw) ? raw : raw.thoughts;
  if (!Array.isArray(rows)) fail(`--from-json: expected an array of thought rows (or {thoughts:[...]})`);
  let out = rows.filter((t) => !args.excludeTiers.includes(t.sensitivity_tier ?? "standard"));
  if (args.since) out = out.filter((t) => t.created_at && t.created_at >= args.since);
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (Number.isFinite(args.limit)) out = out.slice(0, args.limit);
  return out;
}

// ── Labels / aliases ──────────────────────────────────────────────────────

function truncate(s, n = LABEL_MAX) {
  const clean = String(s).replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
}

function labelFor(t) {
  const meta = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
  if (typeof meta.summary === "string" && meta.summary.trim()) return truncate(meta.summary);
  if (t.sensitivity_tier === "restricted") return "(restricted thought)";
  if (typeof t.content === "string" && t.content.trim()) return truncate(t.content.split(/\r?\n/)[0] || t.content);
  return "(untitled thought)";
}

function normalize(s) {
  return String(s).replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Alias map format (canonical -> variants), matched case-insensitively:
 *   { "people": { "Jane Doe": ["Jane", "J. Doe"] },
 *     "topics": { "real-estate": ["real estate", "realestate"] } }
 */
function loadAliasMap(file) {
  const lookup = { people: new Map(), topics: new Map() };
  if (!file) return lookup;
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const section of ["people", "topics"]) {
    const block = raw[section] ?? {};
    for (const [canonical, variants] of Object.entries(block)) {
      lookup[section].set(normalize(canonical), canonical);
      for (const v of Array.isArray(variants) ? variants : [variants]) {
        lookup[section].set(normalize(v), canonical);
      }
    }
  }
  return lookup;
}

function asStringList(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.replace(/\s+/g, " ").trim());
}

// ── Graph assembly ────────────────────────────────────────────────────────

class GraphBuilder {
  constructor() {
    this.nodes = new Map(); // id -> node
    this.edges = [];
    this.edgeKeys = new Set();
  }

  addNode(node) {
    if (!this.nodes.has(node.id)) this.nodes.set(node.id, { ...node, degree: 0 });
    return this.nodes.get(node.id);
  }

  addEdge(source, target, kind, extra = {}) {
    if (source === target) return;
    if (!this.nodes.has(source) || !this.nodes.has(target)) return;
    const key = `${kind}|${source}|${target}`;
    if (this.edgeKeys.has(key)) return;
    this.edgeKeys.add(key);
    this.edges.push({ source, target, kind, ...extra });
  }

  recomputeDegree() {
    for (const n of this.nodes.values()) n.degree = 0;
    for (const e of this.edges) {
      this.nodes.get(e.source).degree++;
      this.nodes.get(e.target).degree++;
    }
  }

  /** Drop non-thought nodes under `minDegree`, then edges that touched them. */
  prune(minDegree) {
    this.recomputeDegree();
    const dropped = new Set();
    for (const n of this.nodes.values()) {
      if (n.kind !== "thought" && n.degree < minDegree) dropped.add(n.id);
    }
    for (const id of dropped) this.nodes.delete(id);
    this.edges = this.edges.filter((e) => !dropped.has(e.source) && !dropped.has(e.target));
    this.recomputeDegree();
    return dropped.size;
  }

  toJSON(meta) {
    const nodes = [...this.nodes.values()];
    const byKind = {};
    for (const n of nodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
    const edgesByKind = {};
    for (const e of this.edges) edgesByKind[e.kind] = (edgesByKind[e.kind] ?? 0) + 1;
    return {
      meta: { ...meta, counts: { nodes: nodes.length, edges: this.edges.length, byKind, edgesByKind } },
      nodes,
      edges: this.edges,
    };
  }
}

function thoughtNode(t, includeContent) {
  const node = {
    id: t.id,
    kind: "thought",
    label: labelFor(t),
    type: t.type ?? null,
    importance: t.importance ?? null,
    source_type: t.source_type ?? null,
    created_at: t.created_at ?? null,
    sensitivity_tier: t.sensitivity_tier ?? null,
  };
  if (includeContent && t.sensitivity_tier !== "restricted" && typeof t.content === "string") {
    node.content = t.content;
  }
  return node;
}

function buildMetadataGraph(thoughts, args, aliases) {
  const g = new GraphBuilder();
  const cooc = new Map(); // "a|b" -> shared thought count

  for (const t of thoughts) {
    g.addNode(thoughtNode(t, args.includeContent));
    const meta = t.metadata && typeof t.metadata === "object" ? t.metadata : {};

    const topicIds = new Set();
    for (const raw of asStringList(meta.topics)) {
      const label = aliases.topics.get(normalize(raw)) ?? raw;
      const id = `topic:${normalize(label)}`;
      g.addNode({ id, kind: "topic", label });
      g.addEdge(t.id, id, "topic");
      topicIds.add(id);
    }
    for (const raw of asStringList(meta.people)) {
      const label = aliases.people.get(normalize(raw)) ?? raw;
      const id = `person:${normalize(label)}`;
      g.addNode({ id, kind: "person", label });
      g.addEdge(t.id, id, "person");
    }

    if (args.cooccurrence && topicIds.size > 1) {
      const ids = [...topicIds].sort();
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = `${ids[i]}|${ids[j]}`;
          cooc.set(key, (cooc.get(key) ?? 0) + 1);
        }
      }
    }
  }

  let coocEdges = 0;
  for (const [key, weight] of cooc) {
    if (weight < args.minWeight) continue;
    const [a, b] = key.split("|");
    g.addEdge(a, b, "cooccurrence", { weight });
    coocEdges++;
  }

  const pruned = g.prune(args.minDegree);
  return { graph: g, stats: { thoughts: thoughts.length, coocEdges, pruned } };
}

async function buildEntitiesGraph(api, thoughts, args) {
  const g = new GraphBuilder();
  for (const t of thoughts) g.addNode(thoughtNode(t, args.includeContent));

  process.stderr.write("  fetching entities…");
  const entities = await api.fetchAll("entities", {
    select: "id,entity_type,canonical_name,aliases,first_seen_at,last_seen_at",
    key: "id",
    start: 0,
  });
  for (const e of entities) {
    g.addNode({
      id: `entity:${e.id}`,
      kind: e.entity_type || "entity",
      label: truncate(e.canonical_name || `entity ${e.id}`),
      aliases: Array.isArray(e.aliases) ? e.aliases.slice(0, 10) : [],
      first_seen_at: e.first_seen_at ?? null,
      last_seen_at: e.last_seen_at ?? null,
    });
  }

  process.stderr.write(`\r  entities: ${entities.length}. fetching thought_entities…`);
  const links = await api.fetchThoughtEntities();
  for (const l of links) {
    g.addEdge(l.thought_id, `entity:${l.entity_id}`, "mention", {
      relation: l.mention_role ?? "mentioned",
      confidence: l.confidence ?? null,
    });
  }

  process.stderr.write(`\r  thought_entities: ${links.length}. fetching edges…          `);
  const edges = await api.fetchAll("edges", {
    select: "id,from_entity_id,to_entity_id,relation,support_count,confidence",
    key: "id",
    start: 0,
  });
  for (const e of edges) {
    g.addEdge(`entity:${e.from_entity_id}`, `entity:${e.to_entity_id}`, "entity", {
      relation: e.relation ?? "related_to",
      weight: e.support_count ?? 1,
      confidence: e.confidence ?? null,
    });
  }

  let thoughtEdges = 0;
  if (await api.tableExists("thought_edges")) {
    process.stderr.write(`\r  edges: ${edges.length}. fetching thought_edges…              `);
    const te = await api.fetchAll("thought_edges", {
      select: "id,from_thought_id,to_thought_id,relation,confidence,support_count",
      key: "id",
      start: 0,
    });
    for (const e of te) {
      g.addEdge(e.from_thought_id, e.to_thought_id, "typed", {
        relation: e.relation,
        weight: e.support_count ?? 1,
        confidence: e.confidence ?? null,
      });
      thoughtEdges++;
    }
  }
  process.stderr.write("\r" + " ".repeat(70) + "\r");

  const pruned = g.prune(args.minDegree);
  return {
    graph: g,
    stats: { thoughts: thoughts.length, entities: entities.length, links: links.length, entityEdges: edges.length, thoughtEdges, pruned },
  };
}

// ── Output ────────────────────────────────────────────────────────────────

function writeOutputs(graph, outDir) {
  if (!fs.existsSync(TEMPLATE_PATH)) fail(`template not found: ${TEMPLATE_PATH}`);
  fs.mkdirSync(outDir, { recursive: true });

  const json = JSON.stringify(graph);
  fs.writeFileSync(path.join(outDir, "graph.json"), json);

  // `<` is escaped so a label containing "</script>" cannot break out of the
  // inline data block. `<` is valid JSON, so JSON.parse() in the page is
  // unaffected.
  const safe = json.replace(/</g, "\\u003c");
  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  if (!template.includes("__GRAPH_DATA__")) fail("template.html is missing the __GRAPH_DATA__ placeholder");
  const html = template.split("__GRAPH_DATA__").join(safe);
  fs.writeFileSync(path.join(outDir, "graph-explorer.html"), html);

  return {
    json: path.join(outDir, "graph.json"),
    html: path.join(outDir, "graph-explorer.html"),
    bytes: Buffer.byteLength(html),
  };
}

function printSummary(graph, stats, mode) {
  const c = graph.meta.counts;
  console.log(`\nmode: ${mode}`);
  console.log(`nodes: ${c.nodes}`);
  for (const [k, v] of Object.entries(c.byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${v}`);
  console.log(`edges: ${c.edges}`);
  for (const [k, v] of Object.entries(c.edgesByKind).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${v}`);
  if (stats.pruned) console.log(`pruned: ${stats.pruned} nodes below --min-degree`);
  if (stats.coocEdges !== undefined) console.log(`co-occurrence edges kept: ${stats.coocEdges}`);
  const hubs = graph.nodes.filter((n) => n.kind !== "thought").sort((a, b) => b.degree - a.degree).slice(0, 10);
  if (hubs.length) {
    console.log("top hubs:");
    for (const h of hubs) console.log(`  ${String(h.degree).padStart(5)}  ${h.kind.padEnd(12)} ${h.label}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(HELP);
    return;
  }

  const mode = flags.mode ?? "auto";
  if (!["auto", "metadata", "entities"].includes(mode)) fail(`--mode must be auto, metadata, or entities`);
  if (flags.since && Number.isNaN(Date.parse(flags.since))) fail(`--since must be an ISO date`);

  const tierFlag = flags["exclude-tier"] ?? "restricted";
  const args = {
    since: flags.since ? new Date(flags.since).toISOString() : null,
    limit: flags.limit === undefined ? Infinity : toInt(flags.limit, "limit"),
    minDegree: toInt(flags["min-degree"], "min-degree", 2),
    minWeight: Math.max(1, toInt(flags["min-weight"], "min-weight", 2)),
    excludeTiers: tierFlag === "none" ? [] : tierFlag.split(",").map((s) => s.trim()).filter(Boolean),
    cooccurrence: Boolean(flags.cooccurrence),
    includeContent: Boolean(flags["include-content"]),
    dryRun: Boolean(flags["dry-run"]),
    outDir: path.resolve(flags["out-dir"] ?? DEFAULT_OUT_DIR),
    fromJson: flags["from-json"] ? path.resolve(flags["from-json"]) : null,
    aliasMap: flags["alias-map"] ? path.resolve(flags["alias-map"]) : null,
  };
  if (args.limit === 0) fail("--limit must be at least 1");

  const aliases = loadAliasMap(args.aliasMap);
  const meta = {
    generated_at: new Date().toISOString(),
    generator: "recipes/graph-explorer/export-graph.mjs",
    options: {
      since: args.since,
      limit: Number.isFinite(args.limit) ? args.limit : null,
      min_degree: args.minDegree,
      exclude_tiers: args.excludeTiers,
      cooccurrence: args.cooccurrence,
      min_weight: args.minWeight,
      include_content: args.includeContent,
      alias_map: Boolean(args.aliasMap),
    },
  };

  let graph;
  let stats;
  let resolvedMode;

  if (args.fromJson) {
    if (mode === "entities") fail("--from-json only supports metadata mode");
    console.log(`reading thoughts from ${args.fromJson} (offline)`);
    const thoughts = loadFromJson(args.fromJson, args);
    resolvedMode = "metadata";
    ({ graph, stats } = buildMetadataGraph(thoughts, args, aliases));
    meta.source = "json";
  } else {
    const fileEnv = readEnvLocal(path.join(HERE, ".env.local"));
    const env = { ...process.env, ...fileEnv };
    if (!env.OPEN_BRAIN_URL) fail("OPEN_BRAIN_URL missing (set it in .env.local or the shell)");
    if (!env.OPEN_BRAIN_SERVICE_KEY) fail("OPEN_BRAIN_SERVICE_KEY missing (set it in .env.local or the shell)");
    const api = new BrainApi(env.OPEN_BRAIN_URL, env.OPEN_BRAIN_SERVICE_KEY);

    resolvedMode = mode;
    if (mode === "auto" || mode === "entities") {
      const [ents, links, edges] = await Promise.all([
        api.tableExists("entities"),
        api.tableExists("thought_entities"),
        api.tableExists("edges"),
      ]);
      const hasEntityGraph = ents && links && edges;
      if (mode === "entities" && !hasEntityGraph) {
        fail("--mode entities needs public.entities, public.thought_entities and public.edges (schemas/entity-extraction)");
      }
      resolvedMode = hasEntityGraph ? "entities" : "metadata";
      if (mode === "auto") console.log(`auto-detected mode: ${resolvedMode}`);
    }

    const cols = await probeThoughtColumns(api, args.includeContent);
    const thoughts = await fetchThoughts(api, args, cols);
    process.stderr.write("\n");
    meta.source = "postgrest";

    if (resolvedMode === "entities") {
      ({ graph, stats } = await buildEntitiesGraph(api, thoughts, args));
    } else {
      ({ graph, stats } = buildMetadataGraph(thoughts, args, aliases));
    }
  }

  meta.mode = resolvedMode;
  const out = graph.toJSON(meta);
  printSummary(out, stats, resolvedMode);

  if (args.dryRun) {
    console.log("\nDRY RUN — nothing written.");
    return;
  }
  const written = writeOutputs(out, args.outDir);
  console.log(`\nwrote ${written.json}`);
  console.log(`wrote ${written.html} (${(written.bytes / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`open it: open "${written.html}"   (or double-click the file)`);
}

main().catch((err) => {
  console.error(`\nerror: ${err.message}`);
  process.exit(1);
});
