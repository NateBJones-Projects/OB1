#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, "compiled-wiki");

const SCRIPT_PATHS = {
  typedEdges: path.join(REPO_ROOT, "recipes", "typed-edge-classifier", "classify-edges.mjs"),
  entityWiki: path.join(REPO_ROOT, "recipes", "entity-wiki", "generate-wiki.mjs"),
  topicWiki: path.join(REPO_ROOT, "recipes", "wiki-synthesis", "scripts", "synthesize-wiki.mjs"),
  gmailWiki: path.join(REPO_ROOT, "recipes", "wiki-synthesis", "scripts", "backfill-gmail-wikis.mjs"),
};

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function loadEnv() {
  return {
    ...parseEnvFile(path.join(REPO_ROOT, ".env")),
    ...parseEnvFile(path.join(REPO_ROOT, ".env.local")),
    ...process.env,
  };
}

function defaultArgs() {
  return {
    outDir: DEFAULT_OUT_DIR,
    extractLimit: 25,
    edgeLimit: 50,
    edgeMinSupport: 2,
    edgeMaxCostUsd: 2.0,
    edgeParallelism: 3,
    edgeMinConfidence: 0.75,
    entityBatchLimit: 25,
    entityBatchMinLinked: 3,
    entityOutputMode: "file",
    gmail: false,
    gmailLimit: 0,
    dryRun: false,
    bestEffort: false,
    mirrorSupersedes: false,
    semanticExpand: false,
    skipExtraction: false,
    skipEdges: false,
    skipEntityWiki: false,
    skipTopicWiki: false,
    skipGmailWiki: false,
    requireExtraction: false,
    topics: [],
    scopes: [],
  };
}

function parseArgs(argv) {
  const args = defaultArgs();
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    const next = () => argv[++i];
    if (current === "--help" || current === "-h") args.help = true;
    else if (current === "--dry-run") args.dryRun = true;
    else if (current === "--best-effort") args.bestEffort = true;
    else if (current === "--mirror-supersedes") args.mirrorSupersedes = true;
    else if (current === "--semantic-expand") args.semanticExpand = true;
    else if (current === "--gmail") args.gmail = true;
    else if (current === "--re-evaluate") args.reEvaluate = true;
    else if (current === "--skip-extraction") args.skipExtraction = true;
    else if (current === "--skip-edges") args.skipEdges = true;
    else if (current === "--skip-entity-wiki") args.skipEntityWiki = true;
    else if (current === "--skip-topic-wiki") args.skipTopicWiki = true;
    else if (current === "--skip-gmail-wiki") args.skipGmailWiki = true;
    else if (current === "--require-extraction") args.requireExtraction = true;
    else if (current === "--topic") args.topics.push(next());
    else if (current === "--scope") args.scopes.push(next());
    else if (current === "--out-dir") args.outDir = path.resolve(REPO_ROOT, next());
    else if (current === "--extract-limit") args.extractLimit = Number(next()) || args.extractLimit;
    else if (current === "--edge-limit") args.edgeLimit = Number(next()) || args.edgeLimit;
    else if (current === "--edge-min-support") args.edgeMinSupport = Number(next()) || args.edgeMinSupport;
    else if (current === "--edge-max-cost-usd") args.edgeMaxCostUsd = Number(next()) || args.edgeMaxCostUsd;
    else if (current === "--edge-parallelism") args.edgeParallelism = Number(next()) || args.edgeParallelism;
    else if (current === "--edge-min-confidence") args.edgeMinConfidence = Number(next()) || args.edgeMinConfidence;
    else if (current === "--entity-batch-limit") args.entityBatchLimit = Number(next()) || args.entityBatchLimit;
    else if (current === "--entity-batch-min-linked") args.entityBatchMinLinked = Number(next()) || args.entityBatchMinLinked;
    else if (current === "--entity-output-mode") args.entityOutputMode = next();
    else if (current === "--gmail-limit") args.gmailLimit = Number(next()) || 0;
    else throw new Error(`Unknown flag: ${current}`);
  }
  if (!args.skipTopicWiki && args.topics.length === 0) {
    args.topics.push("autobiography");
  }
  return args;
}

function printHelp() {
  console.log(`Wiki Compiler — Open Brain compiled wiki wrapper

Usage:
  node recipes/wiki-compiler/compile-wiki.mjs [flags]

Core behavior:
  Runs the compiled wiki pipeline in phases:
  1. Trigger entity extraction worker (optional remote step)
  2. Classify typed reasoning edges into thought_edges
  3. Batch-generate entity wiki pages
  4. Generate topic wiki pages (defaults to autobiography)
  5. Optionally synthesize Gmail thread wiki pages

Flags:
  --dry-run                    Preview where supported; skip writes when possible
  --best-effort                Continue even if a phase fails
  --out-dir <path>             Root output directory (default: ./compiled-wiki)
  --topic <slug>               Topic synthesizer to run; repeatable
  --scope key=value            Scope passed to every topic run; repeatable
  --gmail                      Also run Gmail thread wiki synthesis
  --gmail-limit <N>            Cap Gmail thread synthesis count
  --re-evaluate                Re-check already-processed Gmail threads

Phase toggles:
  --skip-extraction            Do not trigger the entity extraction worker
  --skip-edges                 Do not run typed-edge classification
  --skip-entity-wiki           Do not batch-generate entity pages
  --skip-topic-wiki            Do not run topic synthesis
  --skip-gmail-wiki            Skip Gmail wiki synthesis even if --gmail is set
  --require-extraction         Fail instead of warn if extraction worker credentials are missing

Entity extraction:
  --extract-limit <N>          Queue items to process (default: 25)

Typed edges:
  --edge-limit <N>             Candidate thought pairs (default: 50)
  --edge-min-support <N>       Minimum shared entities (default: 2)
  --edge-max-cost-usd <N>      Hard cap for classifier spend (default: 2.00)
  --edge-parallelism <N>       Concurrent classifier calls (default: 3)
  --edge-min-confidence <N>    Skip inserts below confidence (default: 0.75)
  --mirror-supersedes          Also mirror supersedes into thoughts.supersedes

Entity wiki:
  --entity-batch-limit <N>     Max entities per run (default: 25)
  --entity-batch-min-linked <N> Min linked thoughts (default: 3)
  --entity-output-mode <mode>  file | entity-metadata | thought (default: file)
  --semantic-expand            Enable semantic expansion for entity wiki runs

Environment:
  OPEN_BRAIN_URL
  OPEN_BRAIN_SERVICE_KEY
  ENTITY_EXTRACTION_WORKER_URL (optional; defaults from OPEN_BRAIN_URL)
  ENTITY_EXTRACTION_MCP_ACCESS_KEY or MCP_ACCESS_KEY (for worker trigger)
  LLM_API_KEY / LLM_MODEL / related vars used by the underlying recipes
`);
}

function ensureScriptsExist() {
  for (const [label, scriptPath] of Object.entries(SCRIPT_PATHS)) {
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Missing dependency script for ${label}: ${scriptPath}`);
    }
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function formatCommand(args) {
  return args.map((part) => (/[\s"]/u.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function spawnNode(scriptPath, scriptArgs, envOverrides = {}) {
  const childEnv = { ...process.env, ...envOverrides };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      cwd: REPO_ROOT,
      env: childEnv,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code}): ${formatCommand([process.execPath, scriptPath, ...scriptArgs])}`));
    });
  });
}

async function triggerEntityExtraction(args, env) {
  const workerUrl =
    env.ENTITY_EXTRACTION_WORKER_URL ||
    (env.OPEN_BRAIN_URL ? `${String(env.OPEN_BRAIN_URL).replace(/\/+$/, "")}/functions/v1/entity-extraction-worker` : null);
  const accessKey = env.ENTITY_EXTRACTION_MCP_ACCESS_KEY || env.MCP_ACCESS_KEY || null;
  if (!workerUrl || !accessKey) {
    const missing = [];
    if (!workerUrl) missing.push("ENTITY_EXTRACTION_WORKER_URL or OPEN_BRAIN_URL");
    if (!accessKey) missing.push("ENTITY_EXTRACTION_MCP_ACCESS_KEY or MCP_ACCESS_KEY");
    const message = `Skipping entity extraction trigger; missing ${missing.join(" and ")}.`;
    if (args.requireExtraction) throw new Error(message);
    console.warn(`[wiki-compiler] ${message}`);
    return { skipped: true, reason: message };
  }

  const url = new URL(workerUrl);
  url.searchParams.set("limit", String(args.extractLimit));
  if (args.dryRun) url.searchParams.set("dry_run", "true");

  console.log(`[wiki-compiler] triggering entity extraction worker: ${url.toString()}`);
  const response = await fetch(url, {
    method: "POST",
    headers: { "x-brain-key": accessKey },
  });
  const bodyText = await response.text();
  let payload = null;
  try {
    payload = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    payload = { raw: bodyText };
  }
  if (!response.ok) {
    throw new Error(`Entity extraction worker ${response.status}: ${bodyText.slice(0, 500)}`);
  }
  return payload;
}

function startManifest(args) {
  return {
    recipe: "wiki-compiler",
    version: "1.0.0",
    started_at: new Date().toISOString(),
    repo_root: REPO_ROOT,
    out_dir: args.outDir,
    dry_run: args.dryRun,
    topics: args.topics,
    gmail: args.gmail && !args.skipGmailWiki,
    steps: [],
  };
}

function recordStep(manifest, name, status, details = {}) {
  manifest.steps.push({
    name,
    status,
    at: new Date().toISOString(),
    ...details,
  });
}

function writeManifest(manifest) {
  ensureDir(manifest.out_dir);
  const filePath = path.join(manifest.out_dir, "compile-manifest.json");
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return filePath;
}

async function runStep(manifest, name, fn, bestEffort) {
  try {
    const result = await fn();
    recordStep(manifest, name, "ok", result ? { result } : {});
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordStep(manifest, name, "failed", { error: message });
    if (!bestEffort) throw error;
    console.warn(`[wiki-compiler] ${name} failed but continuing (--best-effort): ${message}`);
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  ensureScriptsExist();

  const env = loadEnv();
  const entityOutDir = path.join(args.outDir, "entities");
  const topicOutDir = path.join(args.outDir, "topics");
  ensureDir(args.outDir);
  ensureDir(entityOutDir);
  ensureDir(topicOutDir);

  const manifest = startManifest(args);

  console.log(`[wiki-compiler] repo=${REPO_ROOT}`);
  console.log(`[wiki-compiler] out=${args.outDir}`);
  console.log(`[wiki-compiler] topics=${args.topics.join(", ") || "(none)"}`);

  if (!args.skipExtraction) {
    await runStep(
      manifest,
      "entity-extraction",
      () => triggerEntityExtraction(args, env),
      args.bestEffort,
    );
  }

  if (!args.skipEdges) {
    const edgeArgs = [
      "--limit", String(args.edgeLimit),
      "--min-support", String(args.edgeMinSupport),
      "--max-cost-usd", String(args.edgeMaxCostUsd),
      "--parallelism", String(args.edgeParallelism),
      "--min-confidence", String(args.edgeMinConfidence),
    ];
    if (args.dryRun) edgeArgs.push("--dry-run");
    if (args.mirrorSupersedes) edgeArgs.push("--mirror-supersedes");

    await runStep(
      manifest,
      "typed-edge-classifier",
      async () => {
        console.log(`[wiki-compiler] running typed-edge classifier`);
        await spawnNode(SCRIPT_PATHS.typedEdges, edgeArgs);
        return {
          limit: args.edgeLimit,
          min_support: args.edgeMinSupport,
          max_cost_usd: args.edgeMaxCostUsd,
        };
      },
      args.bestEffort,
    );
  }

  if (!args.skipEntityWiki) {
    const entityArgs = [
      "--batch",
      "--batch-min-linked", String(args.entityBatchMinLinked),
      "--batch-limit", String(args.entityBatchLimit),
      "--output-mode", args.entityOutputMode,
      "--out-dir", entityOutDir,
    ];
    if (args.semanticExpand) entityArgs.push("--semantic-expand");
    if (args.dryRun) entityArgs.push("--dry-run");

    await runStep(
      manifest,
      "entity-wiki",
      async () => {
        console.log(`[wiki-compiler] generating entity wiki pages -> ${entityOutDir}`);
        await spawnNode(SCRIPT_PATHS.entityWiki, entityArgs);
        return {
          output_mode: args.entityOutputMode,
          out_dir: entityOutDir,
          batch_limit: args.entityBatchLimit,
        };
      },
      args.bestEffort,
    );
  }

  if (!args.skipTopicWiki) {
    for (const topic of args.topics) {
      const topicArgs = ["--topic", topic];
      for (const scope of args.scopes) topicArgs.push("--scope", scope);
      if (args.dryRun) topicArgs.push("--dry-run");

      await runStep(
        manifest,
        `topic-wiki:${topic}`,
        async () => {
          console.log(`[wiki-compiler] generating topic wiki "${topic}" -> ${topicOutDir}`);
          await spawnNode(SCRIPT_PATHS.topicWiki, topicArgs, {
            WIKI_OUTPUT_DIR: topicOutDir,
          });
          return {
            topic,
            out_dir: topicOutDir,
            scopes: args.scopes,
          };
        },
        args.bestEffort,
      );
    }
  }

  if (args.gmail && !args.skipGmailWiki) {
    const gmailArgs = [];
    if (args.dryRun) gmailArgs.push("--dry-run");
    if (args.gmailLimit > 0) gmailArgs.push(`--limit=${args.gmailLimit}`);
    if (args.reEvaluate) gmailArgs.push("--re-evaluate");

    await runStep(
      manifest,
      "gmail-wiki",
      async () => {
        console.log(`[wiki-compiler] generating Gmail thread wiki pages`);
        await spawnNode(SCRIPT_PATHS.gmailWiki, gmailArgs);
        return {
          limit: args.gmailLimit,
          re_evaluate: Boolean(args.reEvaluate),
        };
      },
      args.bestEffort,
    );
  }

  manifest.finished_at = new Date().toISOString();
  const manifestPath = writeManifest(manifest);
  console.log(`[wiki-compiler] manifest -> ${manifestPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[wiki-compiler] FAILED: ${message}`);
  process.exitCode = 1;
});
