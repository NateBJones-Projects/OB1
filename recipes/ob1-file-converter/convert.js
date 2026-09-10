#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown"]);

function usage() {
  console.log(`Usage:
  node convert.js <path> [options]

Options:
  --output FILE          Write JSON output to a file instead of stdout
  --source SOURCE        Source slug for emitted records (default: file)
  --source-label LABEL   Human-readable source label
  --format FORMAT        auto, text, markdown, or json (default: auto)
  --max-chunk-size N     Maximum chunk characters before splitting (default: 4000)
  --max-file-size N      Maximum file bytes to read (default: 1048576)
  --max-depth N          Maximum directory recursion depth (default: 5)
  --help                 Show this help

Exit codes:
  0 success
  1 conversion error
  2 usage, parse, or file error`);
}

function parseArgs(argv) {
  const options = {
    output: "",
    source: "file",
    sourceLabel: "",
    format: "auto",
    maxChunkSize: 4000,
    maxFileSize: 1024 * 1024,
    maxDepth: 5,
  };

  let input = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "help") {
      options.help = true;
    } else if (arg === "--output") {
      options.output = argv[++i] || "";
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
    } else if (arg === "--source") {
      options.source = argv[++i] || "";
    } else if (arg.startsWith("--source=")) {
      options.source = arg.slice("--source=".length);
    } else if (arg === "--source-label") {
      options.sourceLabel = argv[++i] || "";
    } else if (arg.startsWith("--source-label=")) {
      options.sourceLabel = arg.slice("--source-label=".length);
    } else if (arg === "--format") {
      options.format = argv[++i] || "";
    } else if (arg.startsWith("--format=")) {
      options.format = arg.slice("--format=".length);
    } else if (arg === "--max-chunk-size") {
      options.maxChunkSize = parseNonNegativeInt(argv[++i], "max-chunk-size");
    } else if (arg.startsWith("--max-chunk-size=")) {
      options.maxChunkSize = parseNonNegativeInt(arg.slice("--max-chunk-size=".length), "max-chunk-size");
    } else if (arg === "--max-file-size") {
      options.maxFileSize = parseNonNegativeInt(argv[++i], "max-file-size");
    } else if (arg.startsWith("--max-file-size=")) {
      options.maxFileSize = parseNonNegativeInt(arg.slice("--max-file-size=".length), "max-file-size");
    } else if (arg === "--max-depth") {
      options.maxDepth = parseNonNegativeInt(argv[++i], "max-depth");
    } else if (arg.startsWith("--max-depth=")) {
      options.maxDepth = parseNonNegativeInt(arg.slice("--max-depth=".length), "max-depth");
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!input) {
      input = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!["auto", "text", "markdown", "json"].includes(options.format)) {
    throw new Error("--format must be auto, text, markdown, or json");
  }
  if (!options.source) throw new Error("--source cannot be empty");
  if (!options.help && !input) throw new Error("Missing input path");
  return { input, options };
}

function parseNonNegativeInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return parsed;
}

function convertPath(inputPath, options) {
  if (!inputPath) throw new Error("Missing input path");
  const absolute = path.resolve(inputPath);
  const stat = fs.lstatSync(absolute);
  const warnings = [];
  let records;

  if (stat.isSymbolicLink()) {
    warnings.push(`Skipped symlink: ${absolute}`);
    return { records: [], warnings };
  }

  if (stat.isDirectory()) {
    records = convertDirectory(absolute, options, warnings);
  } else if (stat.isFile()) {
    records = convertFile(absolute, path.dirname(absolute), options, warnings);
  } else {
    throw new Error(`Input is not a regular file or directory: ${absolute}`);
  }

  return { records, warnings };
}

function convertDirectory(root, options, warnings) {
  const files = [];
  walkDirectory(root, root, 0, options, warnings, files);
  return files.flatMap((file) => convertFile(file, root, options, warnings));
}

function walkDirectory(root, current, depth, options, warnings, files) {
  if (depth > options.maxDepth) {
    warnings.push(`Skipped directory beyond max depth: ${path.relative(root, current) || "."}`);
    return;
  }

  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      warnings.push(`Skipped symlink: ${path.relative(root, fullPath)}`);
      continue;
    }
    if (stat.isDirectory()) {
      walkDirectory(root, fullPath, depth + 1, options, warnings, files);
      continue;
    }
    if (!stat.isFile()) continue;
    if (isSupportedPath(fullPath, options.format)) files.push(fullPath);
  }
}

function isSupportedPath(filePath, format) {
  if (format === "text") return true;
  if (format === "markdown") return [".md", ".markdown"].includes(path.extname(filePath).toLowerCase());
  if (format === "json") return path.extname(filePath).toLowerCase() === ".json";
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || ext === ".json";
}

function convertFile(filePath, root, options, warnings) {
  const stat = fs.lstatSync(filePath);
  const sourcePath = normalizeRelativePath(root, filePath);
  if (stat.size > options.maxFileSize) {
    warnings.push(`Skipped file over max size: ${sourcePath}`);
    return [];
  }
  if (looksBinary(filePath)) {
    warnings.push(`Skipped binary file: ${sourcePath}`);
    return [];
  }

  const format = detectFormat(filePath, options.format);
  if (format === "json") return convertJsonFile(filePath, root, options, warnings);
  return convertTextFile(filePath, root, options, format);
}

function detectFormat(filePath, requested) {
  if (requested !== "auto") return requested;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  return "text";
}

function looksBinary(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(512);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytes).includes(0);
  } finally {
    fs.closeSync(fd);
  }
}

function convertJsonFile(filePath, root, options, warnings) {
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    warnings.push(`Skipped JSON file that is not an array: ${normalizeRelativePath(root, filePath)}`);
    return [];
  }

  return parsed.flatMap((record, index) => {
    const content = extractContent(record);
    if (!content) {
      warnings.push(`Skipped JSON record without content/text: ${normalizeRelativePath(root, filePath)}#${index + 1}`);
      return [];
    }
    const base = {
      content,
      source: firstString(record?.source_type, record?.source, options.source),
      source_type: firstString(record?.source_type, record?.source, options.source),
      source_label: firstString(record?.source_label, record?.sourceLabel, options.sourceLabel) || defaultSourceLabel(options),
      source_path: normalizeRelativePath(root, filePath),
      source_locator: firstString(record?.source_locator, record?.sourceLocator, record?.id) || `record-${index + 1}`,
      created_at: firstString(record?.created_at, record?.createdAt, record?.timestamp),
      type: firstString(record?.type) || "raw_chunk",
      topics: Array.isArray(record?.topics) ? record.topics : [],
      confidence: firstString(record?.confidence) || "unprocessed",
    };
    return chunkRecord(base, options);
  });
}

function convertTextFile(filePath, root, options, format) {
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return [];
  const sourcePath = normalizeRelativePath(root, filePath);
  const parsed = format === "markdown" ? parseFrontmatter(raw) : { body: raw, metadata: {} };
  const content = parsed.body.trim();
  if (!content) return [];

  const base = {
    content,
    source: options.source,
    source_type: options.source,
    source_label: options.sourceLabel || defaultSourceLabel(options),
    source_path: sourcePath,
    source_locator: "file",
    created_at: firstString(parsed.metadata.created_at, parsed.metadata.createdAt, parsed.metadata.date),
    type: firstString(parsed.metadata.type) || "raw_chunk",
    topics: normalizeTopics(parsed.metadata.topics),
    confidence: "unprocessed",
  };
  return chunkRecord(base, options);
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return { body: raw, metadata: {} };
  const lines = raw.split(/\r?\n/);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return { body: raw, metadata: {} };

  const metadata = {};
  for (const line of lines.slice(1, end)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) metadata[key] = value;
  }

  return { body: lines.slice(end + 1).join(os.EOL), metadata };
}

function normalizeTopics(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);
}

function extractContent(record) {
  if (typeof record?.content === "string") return record.content.trim();
  if (typeof record?.text === "string") return record.text.trim();
  return "";
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function defaultSourceLabel(options) {
  return `${options.source} files`;
}

function chunkRecord(record, options) {
  const chunks = chunkText(record.content, options.maxChunkSize);
  if (chunks.length <= 1) {
    return [{ ...record, source_locator: record.source_locator || "file" }];
  }
  return chunks.map((content, index) => ({
    ...record,
    content,
    source_locator: `chunk-${index + 1}-of-${chunks.length}`,
    type: record.type || "raw_chunk",
    confidence: record.confidence || "unprocessed",
  }));
}

function chunkText(text, maxSize) {
  const cleaned = String(text).replace(/\r\n/g, "\n").trim();
  if (!cleaned || maxSize === 0 || cleaned.length <= maxSize) return cleaned ? [cleaned] : [];

  const chunks = [];
  const paragraphs = cleaned.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxSize) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitLongParagraph(paragraph, maxSize));
      continue;
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxSize) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitLongParagraph(paragraph, maxSize) {
  const sentences = paragraph.match(/[^.!?]+[.!?]+|\S.+$/g) || [paragraph];
  const chunks = [];
  let current = "";

  for (const sentence of sentences.map((s) => s.trim()).filter(Boolean)) {
    if (sentence.length > maxSize) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...hardSplit(sentence, maxSize));
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxSize) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function hardSplit(text, maxSize) {
  const chunks = [];
  let remaining = text.trim();
  while (remaining.length > maxSize) {
    let splitAt = remaining.lastIndexOf(" ", maxSize);
    if (splitAt < Math.floor(maxSize / 2)) splitAt = maxSize;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function normalizeRelativePath(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/") || path.basename(filePath);
}

function writeOutput(records, options) {
  const json = `${JSON.stringify(records, null, 2)}\n`;
  if (options.output) {
    fs.writeFileSync(path.resolve(options.output), json, "utf8");
  } else {
    process.stdout.write(json);
  }
}

async function main() {
  let cli;
  try {
    cli = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    usage();
    process.exit(2);
  }

  if (cli.options.help) {
    usage();
    process.exit(0);
  }

  try {
    const result = convertPath(cli.input, cli.options);
    for (const warning of result.warnings) console.error(`Warning: ${warning}`);
    writeOutput(result.records, cli.options);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(2);
  }
}

main();
