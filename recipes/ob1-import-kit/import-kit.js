#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));

const SECRET_PATTERNS = [
  /\bsk-proj-[A-Za-z0-9_-]{8,}\b/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/i,
  /\bgh[pousr]_[A-Za-z0-9_]{16,}\b/i,
  /\bAIza[0-9A-Za-z_-]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\bpostgres(?:ql)?:\/\/[^\s]+/i,
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/i,
];

function usage() {
  console.log(`Usage:
  node import-kit.js validate <records.json> [--json]
  node import-kit.js normalize <records.json> [--imported-at ISO_DATE] [--source SOURCE] [--source-label LABEL]

Commands:
  validate    Check that exported records are safe enough to normalize
  normalize   Print Open Brain thought candidates as JSON

Input:
  A JSON array of extracted thought records. Each record needs content or text.

Exit codes:
  0 success
  1 validation failures
  2 usage, parse, or file errors`);
}

function parseCli(argv) {
  const [command, file, ...rest] = argv;
  const options = {
    json: false,
    importedAt: new Date().toISOString(),
    source: "",
    sourceLabel: "",
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--imported-at") {
      options.importedAt = rest[++i] || "";
    } else if (arg.startsWith("--imported-at=")) {
      options.importedAt = arg.slice("--imported-at=".length);
    } else if (arg === "--source") {
      options.source = rest[++i] || "";
    } else if (arg.startsWith("--source=")) {
      options.source = arg.slice("--source=".length);
    } else if (arg === "--source-label") {
      options.sourceLabel = rest[++i] || "";
    } else if (arg.startsWith("--source-label=")) {
      options.sourceLabel = arg.slice("--source-label=".length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { command, file, options };
}

function loadRecords(filePath) {
  if (!filePath) throw new Error("Missing input file");
  const absolute = path.resolve(filePath);
  const raw = fs.readFileSync(absolute, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Input must be a JSON array of extracted thought records");
  }
  return { filePath: absolute, records: parsed };
}

function isValidIsoDate(value) {
  if (!value || typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === new Date(value).toISOString();
}

function recordContent(record) {
  if (typeof record?.content === "string") return record.content.trim();
  if (typeof record?.text === "string") return record.text.trim();
  return "";
}

function recordTimestamp(record) {
  return (
    firstString(record?.created_at, record?.createdAt, record?.timestamp, record?.original_created_at) ||
    ""
  );
}

function recordSource(record, options) {
  return (
    firstString(record?.source_type, record?.sourceType, record?.source, options.source) ||
    "unknown"
  );
}

function recordSourceLabel(record, options, source) {
  return (
    firstString(record?.source_label, record?.sourceLabel, record?.source_name, options.sourceLabel) ||
    `${source} import`
  );
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function containsSecretLikeText(text) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function validateRecords(records, options = {}) {
  const failures = [];
  const warnings = [];
  const bySource = new Map();
  let validRecords = 0;

  records.forEach((record, index) => {
    const label = record?.id ? `record ${index + 1} (${record.id})` : `record ${index + 1}`;
    const content = recordContent(record);
    const source = recordSource(record, options);
    bySource.set(source, (bySource.get(source) || 0) + 1);

    if (!record || typeof record !== "object" || Array.isArray(record)) {
      failures.push(`${label}: must be a JSON object`);
      return;
    }

    if (!content) {
      failures.push(`${label}: missing content or text`);
    }

    const timestamp = recordTimestamp(record);
    if (timestamp && !isValidIsoDate(timestamp)) {
      failures.push(`${label}: timestamp is not a valid ISO date`);
    }

    if (source === "unknown") {
      warnings.push(`${label}: missing source metadata; using "unknown"`);
    }

    if (content && containsSecretLikeText(content)) {
      warnings.push(`${label}: content looks like it may contain a secret; review before import`);
    }

    if (content && (!timestamp || isValidIsoDate(timestamp))) {
      validRecords += 1;
    }
  });

  return {
    total_records: records.length,
    valid_records: validRecords,
    failures,
    warnings,
    by_source: Object.fromEntries([...bySource.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function normalizeRecords(records, inputFile, options) {
  const validation = validateRecords(records, options);
  if (validation.failures.length) {
    const error = new Error("Cannot normalize records with validation failures");
    error.validation = validation;
    throw error;
  }

  return records.map((record, index) => {
    const content = recordContent(record);
    const sourceType = recordSource(record, options);
    const sourceLabel = recordSourceLabel(record, options, sourceType);
    const originalCreatedAt = recordTimestamp(record) || null;
    const contentFingerprint = sha256(content.toLowerCase().replace(/\s+/g, " ").trim());
    const inputHash = sha256(stableStringify(record));
    const sourcePath = firstString(record?.source_path, record?.sourcePath, record?.path, record?.file) || null;
    const sourceLocator = firstString(record?.source_locator, record?.sourceLocator, record?.locator) || null;
    const sourceId = firstString(record?.source_id, record?.sourceId, record?.id) || `record-${index + 1}`;

    return {
      content,
      source_type: sourceType,
      content_fingerprint: contentFingerprint,
      metadata: {
        source: sourceType,
        source_type: sourceType,
        source_label: sourceLabel,
        source_id: sourceId,
        source_path: sourcePath,
        source_locator: sourceLocator,
        original_created_at: originalCreatedAt,
        imported_at: options.importedAt,
        importer_name: "ob1-import-kit",
        importer_version: PACKAGE.version,
        input_hash: inputHash,
        content_fingerprint: contentFingerprint,
        sensitivity_tier: firstString(record?.sensitivity_tier, record?.sensitivityTier) || "standard",
        provenance: {
          method: "direct_record",
          source_record: sourceId,
          source_locator: sourceLocator,
          artifact: path.basename(inputFile),
          review_status: "unreviewed",
        },
        type: firstString(record?.type) || "reference",
        topics: Array.isArray(record?.topics) ? record.topics : [],
        people: Array.isArray(record?.people) ? record.people : [],
        action_items: Array.isArray(record?.action_items) ? record.action_items : [],
        confidence: firstString(record?.confidence) || "extracted",
      },
    };
  });
}

function printValidation(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("OB1 Import Kit validation");
  console.log("=========================");
  console.log(`Records: ${result.total_records}`);
  console.log(`Valid records: ${result.valid_records}`);
  console.log(`Failures: ${result.failures.length}`);
  console.log(`Warnings: ${result.warnings.length}`);

  console.log("\nRecords by source:");
  for (const [source, count] of Object.entries(result.by_source)) {
    console.log(`  ${source}: ${count}`);
  }

  if (result.failures.length) {
    console.error("\nFailures:");
    for (const failure of result.failures) console.error(`  - ${failure}`);
  }

  if (result.warnings.length) {
    console.error("\nWarnings:");
    for (const warning of result.warnings) console.error(`  - ${warning}`);
  }
}

function printUsageError(error) {
  console.error(`Error: ${error.message}`);
  usage();
}

async function main() {
  let cli;
  try {
    cli = parseCli(process.argv.slice(2));
  } catch (error) {
    printUsageError(error);
    process.exit(2);
  }

  if (!cli.command || cli.command === "--help" || cli.command === "help") {
    usage();
    process.exit(cli.command ? 0 : 2);
  }

  if (!["validate", "normalize"].includes(cli.command)) {
    printUsageError(new Error(`Unknown command: ${cli.command}`));
    process.exit(2);
  }

  if (!isValidIsoDate(cli.options.importedAt)) {
    console.error("Error: --imported-at must be a valid ISO date");
    process.exit(2);
  }

  let loaded;
  try {
    loaded = loadRecords(cli.file);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(2);
  }

  if (cli.command === "validate") {
    const result = validateRecords(loaded.records, cli.options);
    printValidation(result, cli.options.json);
    process.exit(result.failures.length ? 1 : 0);
  }

  try {
    const normalized = normalizeRecords(loaded.records, loaded.filePath, cli.options);
    const validation = validateRecords(loaded.records, cli.options);
    if (validation.warnings.length) {
      for (const warning of validation.warnings) console.error(`Warning: ${warning}`);
    }
    console.log(JSON.stringify(normalized, null, 2));
  } catch (error) {
    if (error.validation) printValidation(error.validation, false);
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
