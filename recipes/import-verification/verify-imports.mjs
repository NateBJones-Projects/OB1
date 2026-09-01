#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const REQUIRED_METADATA_FIELDS = [
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

const OPTIONAL_COLUMNS = ["source_type", "content_fingerprint"];
const BASE_COLUMNS = ["id", "content", "metadata", "created_at", "embedding"];

function usage() {
  console.log(`Usage:
  node verify-imports.mjs [options]

Options:
  --source SOURCE   Filter scanned rows to a source slug
  --limit N         Maximum recent rows to scan (default: 1000)
  --sample N        Number of sample rows to print (default: 5)
  --probe TEXT      Check scanned content for a phrase
  --json            Print JSON output
  --strict          Exit 1 when warnings are found
  --fixture FILE    Analyze local JSON rows instead of Supabase
  --help            Show this help`);
}

function parseArgs(argv) {
  const args = {
    source: "",
    limit: 1000,
    sample: 5,
    probe: "",
    json: false,
    strict: false,
    fixture: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      args.help = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--strict") {
      args.strict = true;
    } else if (arg === "--source") {
      args.source = argv[++i] || "";
    } else if (arg.startsWith("--source=")) {
      args.source = arg.slice("--source=".length);
    } else if (arg === "--limit") {
      args.limit = parsePositiveInt(argv[++i], "limit");
    } else if (arg.startsWith("--limit=")) {
      args.limit = parsePositiveInt(arg.slice("--limit=".length), "limit");
    } else if (arg === "--sample") {
      args.sample = parsePositiveInt(argv[++i], "sample");
    } else if (arg.startsWith("--sample=")) {
      args.sample = parsePositiveInt(arg.slice("--sample=".length), "sample");
    } else if (arg === "--probe") {
      args.probe = argv[++i] || "";
    } else if (arg.startsWith("--probe=")) {
      args.probe = arg.slice("--probe=".length);
    } else if (arg === "--fixture") {
      args.fixture = argv[++i] || "";
    } else if (arg.startsWith("--fixture=")) {
      args.fixture = arg.slice("--fixture=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return parsed;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function authHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

async function fetchThoughts(args) {
  loadDotEnv(path.join(process.cwd(), ".env.local"));
  loadDotEnv(path.join(process.cwd(), ".env"));

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for live checks");
  }

  const columns = await detectColumns(supabaseUrl, serviceKey);
  const rows = [];
  const pageSize = Math.min(1000, Math.max(1, args.limit || 1000));

  for (let offset = 0; rows.length < args.limit; offset += pageSize) {
    const remaining = args.limit - rows.length;
    const limit = Math.min(pageSize, remaining);
    const url = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/thoughts`);
    url.searchParams.set("select", columns.join(","));
    url.searchParams.set("order", "created_at.desc");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const response = await fetch(url, { headers: authHeaders(serviceKey) });
    if (!response.ok) {
      throw new Error(`Supabase query failed: ${response.status} ${await response.text()}`);
    }
    const page = await response.json();
    rows.push(...page);
    if (page.length < limit) break;
  }

  return rows;
}

async function detectColumns(supabaseUrl, serviceKey) {
  let columns = [...BASE_COLUMNS, ...OPTIONAL_COLUMNS];

  for (const optionalColumn of OPTIONAL_COLUMNS) {
    const ok = await canSelectColumns(supabaseUrl, serviceKey, columns);
    if (ok) return columns;
    columns = columns.filter((column) => column !== optionalColumn);
  }

  const ok = await canSelectColumns(supabaseUrl, serviceKey, columns);
  if (!ok) {
    throw new Error(`Supabase thoughts query failed with required columns: ${BASE_COLUMNS.join(", ")}`);
  }
  return columns;
}

async function canSelectColumns(supabaseUrl, serviceKey, columns) {
  const url = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/thoughts`);
  url.searchParams.set("select", columns.join(","));
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: authHeaders(serviceKey) });
  return response.ok;
}

function readFixture(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function rowSource(row) {
  const metadata = row.metadata || {};
  return row.source_type || metadata.source_type || metadata.source || "unknown";
}

function rowFingerprint(row) {
  const metadata = row.metadata || {};
  return row.content_fingerprint || metadata.content_fingerprint || "";
}

function preview(content) {
  return String(content || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function analyzeRows(rows, args) {
  const filtered = args.source
    ? rows.filter((row) => rowSource(row) === args.source)
    : rows;

  const bySource = new Map();
  const missingMetadata = [];
  const missingEmbeddings = [];
  const fingerprints = new Map();
  const samples = [];
  const probeNeedle = args.probe.toLowerCase();
  let probeMatches = 0;

  for (const row of filtered) {
    const source = rowSource(row);
    bySource.set(source, (bySource.get(source) || 0) + 1);

    const metadata = row.metadata || {};
    const missingFields = REQUIRED_METADATA_FIELDS.filter((field) => {
      if (field === "content_fingerprint") return !metadata[field] && !row.content_fingerprint;
      if (field === "source_type") return !metadata[field] && !row.source_type;
      return metadata[field] === undefined || metadata[field] === null || metadata[field] === "";
    });
    if (missingFields.length) {
      missingMetadata.push({
        id: row.id,
        source,
        missing_fields: missingFields,
      });
    }

    if (!row.embedding || (Array.isArray(row.embedding) && row.embedding.length === 0)) {
      missingEmbeddings.push({ id: row.id, source });
    }

    const fingerprint = rowFingerprint(row);
    if (fingerprint) {
      const bucket = fingerprints.get(fingerprint) || [];
      bucket.push(row.id);
      fingerprints.set(fingerprint, bucket);
    }

    if (probeNeedle && String(row.content || "").toLowerCase().includes(probeNeedle)) {
      probeMatches += 1;
    }

    if (samples.length < args.sample) {
      samples.push({
        id: row.id,
        source,
        created_at: row.created_at,
        preview: preview(row.content),
      });
    }
  }

  const duplicateFingerprints = [...fingerprints.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([fingerprint, ids]) => ({ fingerprint, ids }));

  const warnings = [];
  if (args.source && filtered.length === 0) warnings.push(`No rows found for source '${args.source}'`);
  if (missingMetadata.length) warnings.push(`${missingMetadata.length} row(s) missing required metadata fields`);
  if (missingEmbeddings.length) warnings.push(`${missingEmbeddings.length} row(s) missing embeddings`);
  if (duplicateFingerprints.length) warnings.push(`${duplicateFingerprints.length} duplicate fingerprint group(s) found`);
  if (probeNeedle && probeMatches === 0) warnings.push(`Probe text not found: ${args.probe}`);

  return {
    scanned_rows: rows.length,
    matched_rows: filtered.length,
    source_filter: args.source || null,
    by_source: Object.fromEntries([...bySource.entries()].sort(([a], [b]) => a.localeCompare(b))),
    missing_metadata: missingMetadata,
    missing_embeddings: missingEmbeddings,
    duplicate_fingerprints: duplicateFingerprints,
    probe: args.probe ? { query: args.probe, matches: probeMatches } : null,
    samples,
    warnings,
  };
}

function printHuman(result) {
  console.log("Import Verification");
  console.log("===================");
  console.log(`Scanned rows: ${result.scanned_rows}`);
  console.log(`Matched rows: ${result.matched_rows}`);
  if (result.source_filter) console.log(`Source filter: ${result.source_filter}`);

  console.log("\nRows by source:");
  if (Object.keys(result.by_source).length === 0) {
    console.log("  none");
  } else {
    for (const [source, count] of Object.entries(result.by_source)) {
      console.log(`  ${source}: ${count}`);
    }
  }

  console.log("\nFindings:");
  console.log(`  Missing metadata rows: ${result.missing_metadata.length}`);
  console.log(`  Missing embedding rows: ${result.missing_embeddings.length}`);
  console.log(`  Duplicate fingerprint groups: ${result.duplicate_fingerprints.length}`);
  if (result.probe) console.log(`  Probe matches: ${result.probe.matches}`);

  if (result.samples.length) {
    console.log("\nSamples:");
    for (const sample of result.samples) {
      console.log(`  - ${sample.id} [${sample.source}] ${sample.preview}`);
    }
  }

  if (result.warnings.length) {
    console.log("\nWarnings:");
    for (const warning of result.warnings) console.log(`  - ${warning}`);
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help) {
      usage();
      return;
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    usage();
    process.exit(2);
  }

  try {
    const rows = args.fixture ? readFixture(args.fixture) : await fetchThoughts(args);
    const result = analyzeRows(rows, args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result);
    }
    if (args.strict && result.warnings.length) process.exit(1);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(2);
  }
}

main();
