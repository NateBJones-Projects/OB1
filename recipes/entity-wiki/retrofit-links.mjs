#!/usr/bin/env node
/**
 * Retrofit-links — one-off (but reusable) fixer for a compiled wiki vault
 * generated BEFORE generate-wiki.mjs learned to emit real [[wikilinks]] in
 * its Relationships sections.
 *
 * It rewrites plain-text relationship bullets like:
 *   - Claude Code (support: 3)
 * into:
 *   - [[tool-claude-code|Claude Code]] (support: 3)
 * whenever "Claude Code" exactly matches the name of an existing page in the
 * vault. Everything else in every file is left byte-identical — including
 * bullets whose name has no matching page (left plain, by design, so this
 * script introduces zero dangling links) and bullets whose name matches more
 * than one page of different entity types with no way to disambiguate (also
 * left plain, so this script never links to a possibly-wrong target).
 *
 * Usage:
 *   node recipes/entity-wiki/retrofit-links.mjs <vaultDir> [--dry-run]
 *
 * Rerunnable: already-linkified bullets (containing "[[") are left alone, so
 * running this twice on the same vault is a no-op the second time.
 */

import fs from "node:fs";
import path from "node:path";

const KNOWN_TYPES = ["organization", "project", "tool", "topic", "place", "person"];

function parseArgs(argv) {
  const args = { vaultDir: null, dryRun: false };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (!args.vaultDir) args.vaultDir = a;
  }
  return args;
}

function listMarkdownFiles(vaultDir) {
  const out = [];
  for (const sub of ["entities", "topics"]) {
    const dir = path.join(vaultDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.toLowerCase().endsWith(".md")) out.push(path.join(dir, name));
    }
  }
  return out;
}

// Parse entity_name / entity_type / title out of frontmatter without a full
// YAML parser — the compiler always writes these as single-line scalars
// (entity_name is JSON-stringified, entity_type and title are bare or
// JSON-stringified depending on generator).
function parseFrontmatter(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};
  const block = fmMatch[1];
  const out = {};
  const nameMatch = block.match(/^entity_name:\s*(.+)$/m);
  if (nameMatch) {
    try {
      out.entity_name = JSON.parse(nameMatch[1].trim());
    } catch {
      out.entity_name = nameMatch[1].trim();
    }
  }
  const typeMatch = block.match(/^entity_type:\s*(.+)$/m);
  if (typeMatch) out.entity_type = typeMatch[1].trim();
  const titleMatch = block.match(/^title:\s*(.+)$/m);
  if (titleMatch) {
    let t = titleMatch[1].trim();
    try {
      t = JSON.parse(t);
    } catch {
      /* leave as-is */
    }
    out.title = t;
  }
  return out;
}

// Fallback: reconstruct a plausible display name from the filename slug
// (e.g. "topic-battery-optimization" -> "battery optimization"). Only used
// when a file has no usable frontmatter name, purely to widen recall.
function nameFromSlug(basename) {
  const withoutExt = basename.replace(/\.md$/i, "");
  const withoutType = withoutExt.replace(/^[a-z]+-/, "");
  return withoutType.replace(/-/g, " ");
}

// Build lowercased-name -> [{ file, type }] map across the whole vault.
function buildNameMap(files) {
  const map = new Map();
  const add = (name, file, type) => {
    if (!name) return;
    const key = name.trim().toLowerCase();
    if (!key) return;
    const list = map.get(key) || [];
    if (!list.some((e) => e.file === file)) list.push({ file, type: type || null });
    map.set(key, list);
  };
  for (const filePath of files) {
    const basename = path.basename(filePath);
    const target = basename.replace(/\.md$/i, "");
    const content = fs.readFileSync(filePath, "utf8");
    const fm = parseFrontmatter(content);
    if (fm.entity_name) add(fm.entity_name, target, fm.entity_type);
    else if (fm.title) add(String(fm.title).replace(/\s+Wiki$/i, ""), target, fm.entity_type);
    add(nameFromSlug(basename), target, fm.entity_type);
  }
  return map;
}

// Delimiter that marks the end of a relationship-bullet's name token, e.g.
// " (support: 3)", " [support: 3]", " (tool)", " (project, support: 2)",
// " — support: 2 ...", " [#abc123]". We only need the START of the
// annotation, not its internal shape (which varies wildly across this vault
// since it was free-form LLM prose) — the name is everything before it.
const DELIM_RE = new RegExp(
  String.raw`\s(?=\(support|\[support|\(confidence|\[confidence|\((?:${KNOWN_TYPES.join("|")})\b|—|\[#)`,
);

// Type annotation immediately following the name, used only to disambiguate
// a name that maps to more than one page (e.g. "Claude Code (tool)" should
// prefer tool-claude-code over project-claude-code).
const TYPE_ANNOTATION_RE = new RegExp(String.raw`^\s*\((${KNOWN_TYPES.join("|")})\b`);

function extractNameToken(afterDash) {
  // Bold-wrapped name: "**Zygisk** (tool) — support: 2 ..."
  const boldMatch = afterDash.match(/^\*\*([^*]+)\*\*/);
  if (boldMatch) {
    const nameStart = boldMatch.index + 2;
    const nameEnd = nameStart + boldMatch[1].length;
    const rest = afterDash.slice(nameEnd + 2); // skip closing "**"
    return { name: boldMatch[1], nameStart, nameEnd, rest, bold: true };
  }
  const delimIdx = afterDash.search(DELIM_RE);
  if (delimIdx === -1) {
    // No recognizable annotation shape — treat the (trimmed) remainder as a
    // best-effort whole-line name candidate. If it doesn't hit the map,
    // nothing happens; low risk.
    const name = afterDash.replace(/\s+$/, "");
    return { name, nameStart: 0, nameEnd: name.length, rest: afterDash.slice(name.length), bold: false };
  }
  return {
    name: afterDash.slice(0, delimIdx),
    nameStart: 0,
    nameEnd: delimIdx,
    rest: afterDash.slice(delimIdx),
    bold: false,
  };
}

function resolveTarget(nameMap, name, rest) {
  const key = name.trim().toLowerCase();
  const candidates = nameMap.get(key);
  if (!candidates || candidates.length === 0) return { status: "no-target" };
  if (candidates.length === 1) return { status: "linked", target: candidates[0] };
  const typeHint = rest.match(TYPE_ANNOTATION_RE)?.[1] || null;
  if (typeHint) {
    const filtered = candidates.filter((c) => c.type === typeHint);
    if (filtered.length === 1) return { status: "linked", target: filtered[0] };
  }
  return { status: "ambiguous", candidates };
}

function processFile(filePath, nameMap, stats) {
  const original = fs.readFileSync(filePath, "utf8");
  const lines = original.split("\n");

  let inRelationships = false;
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^## Relationships\s*$/.test(line)) {
      inRelationships = true;
      continue;
    }
    if (inRelationships && /^## /.test(line)) {
      inRelationships = false;
      continue;
    }
    if (!inRelationships) continue;

    const bulletMatch = line.match(/^(-\s+)(.*)$/);
    if (!bulletMatch) continue;
    const [, prefix, afterDash] = bulletMatch;
    if (afterDash.includes("[[")) continue; // already linkified — idempotent rerun

    const { name, nameStart, nameEnd, rest } = extractNameToken(afterDash);
    if (!name.trim()) continue;

    const resolution = resolveTarget(nameMap, name, rest);
    if (resolution.status === "no-target") {
      stats.noTarget++;
      stats.noTargetExamples.add(name.trim());
      continue;
    }
    if (resolution.status === "ambiguous") {
      stats.ambiguous++;
      stats.ambiguousExamples.add(
        `${name.trim()} (candidates: ${resolution.candidates.map((c) => c.file).join(", ")})`,
      );
      continue;
    }

    const linkified = `[[${resolution.target.file}|${afterDash.slice(nameStart, nameEnd)}]]`;
    const newAfterDash = afterDash.slice(0, nameStart) + linkified + afterDash.slice(nameEnd);
    lines[i] = prefix + newAfterDash;
    changed = true;
    stats.linkified++;
  }

  if (changed) {
    stats.filesTouched.add(filePath);
    fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  }
  return changed;
}

function localDateStamp() {
  // Local calendar date, not UTC — toISOString() rolls back a day for any
  // timezone west of UTC in the hours just after local midnight.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function backupVault(vaultDir) {
  const parent = path.dirname(vaultDir);
  const base = path.basename(vaultDir);
  const backupDir = path.join(parent, `${base}-backup-${localDateStamp()}`);
  if (fs.existsSync(backupDir)) {
    throw new Error(`Backup dir already exists, refusing to overwrite: ${backupDir}`);
  }
  fs.cpSync(vaultDir, backupDir, { recursive: true });
  return backupDir;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.vaultDir) {
    console.error("Usage: node retrofit-links.mjs <vaultDir> [--dry-run]");
    process.exit(2);
  }
  const vaultDir = path.resolve(args.vaultDir);
  if (!fs.existsSync(vaultDir)) {
    console.error(`Vault dir not found: ${vaultDir}`);
    process.exit(2);
  }

  const files = listMarkdownFiles(vaultDir);
  console.log(`[retrofit] found ${files.length} markdown files in ${vaultDir}`);

  const nameMap = buildNameMap(files);
  console.log(`[retrofit] built name map with ${nameMap.size} distinct keys`);

  let backupDir = null;
  if (!args.dryRun) {
    backupDir = backupVault(vaultDir);
    console.log(`[retrofit] backed up vault to ${backupDir}`);
  } else {
    console.log(`[retrofit] --dry-run: skipping backup and writes`);
  }

  const stats = {
    linkified: 0,
    noTarget: 0,
    ambiguous: 0,
    noTargetExamples: new Set(),
    ambiguousExamples: new Set(),
    filesTouched: new Set(),
  };

  for (const filePath of files) {
    if (args.dryRun) {
      const content = fs.readFileSync(filePath, "utf8");
      const snapshot = content;
      // Simulate without writing: run processFile on a temp copy in-memory
      // by temporarily disabling fs.writeFileSync side effects is overkill;
      // instead just report what WOULD happen using the same logic path,
      // writing to a throwaway path is unnecessary since we only need counts.
      const lines = snapshot.split("\n");
      let inRel = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^## Relationships\s*$/.test(line)) { inRel = true; continue; }
        if (inRel && /^## /.test(line)) { inRel = false; continue; }
        if (!inRel) continue;
        const bulletMatch = line.match(/^(-\s+)(.*)$/);
        if (!bulletMatch) continue;
        const afterDash = bulletMatch[2];
        if (afterDash.includes("[[")) continue;
        const { name, rest } = extractNameToken(afterDash);
        if (!name.trim()) continue;
        const resolution = resolveTarget(nameMap, name, rest);
        if (resolution.status === "no-target") { stats.noTarget++; stats.noTargetExamples.add(name.trim()); }
        else if (resolution.status === "ambiguous") { stats.ambiguous++; stats.ambiguousExamples.add(name.trim()); }
        else { stats.linkified++; stats.filesTouched.add(filePath); }
      }
    } else {
      processFile(filePath, nameMap, stats);
    }
  }

  console.log(`\n[retrofit] === results ===`);
  console.log(`[retrofit] files touched:      ${stats.filesTouched.size}`);
  console.log(`[retrofit] bullets linkified:  ${stats.linkified}`);
  console.log(`[retrofit] left plain (no target): ${stats.noTarget}`);
  console.log(`[retrofit] left plain (ambiguous):  ${stats.ambiguous}`);
  if (backupDir) console.log(`[retrofit] backup: ${backupDir}`);

  const noTargetList = [...stats.noTargetExamples].sort();
  const ambiguousList = [...stats.ambiguousExamples].sort();
  console.log(`\n[retrofit] no-target examples (${noTargetList.length} distinct names):`);
  console.log(noTargetList.slice(0, 40).map((n) => `  - ${n}`).join("\n"));
  console.log(`\n[retrofit] ambiguous examples (${ambiguousList.length} distinct names):`);
  console.log(ambiguousList.map((n) => `  - ${n}`).join("\n"));
}

main();
