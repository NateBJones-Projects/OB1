#!/usr/bin/env node
/**
 * bootstrap.mjs -- one-command Open Brain installer.
 *
 * Takes an already-created Supabase project to a fully functional Open Brain
 * with the wiki + CRM stack, then smoke-verifies the surfaces. It does NOT
 * create the Supabase project (that costs money/slots and is a human step --
 * see the README) and it does NOT configure MCP connectors in your AI client.
 *
 * What it does, each step idempotent and individually reported:
 *   1. Preflight  -- verify the access token + project ref, and (unless
 *                    --skip-functions) that the Supabase CLI is on PATH.
 *   2. Apply SQL  -- POST each schema file to the Supabase Management API query
 *                    endpoint, core setup first, then the bundle's schemas in
 *                    dependency order. Every schema ships idempotent, so a
 *                    re-run is safe.
 *   3. Functions  -- deploy the bundle's Edge Functions with the Supabase CLI
 *                    (`--use-api`, so no Docker needed).
 *   4. Secrets    -- set MCP_ACCESS_KEY (generated + printed once if you did
 *                    not supply one) and pass through any LLM keys in your env.
 *   5. Verify     -- hit the gateway health route and run the repo smoke
 *                    scripts; print a per-surface PASS/FAIL table.
 *   6. Finish     -- print the exact dashboard env values and the
 *                    Deploy-to-Vercel link.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... node bootstrap.mjs --project-ref abcd1234 --yes
 *   node bootstrap.mjs --project-ref abcd1234 --bundle wiki-crm --dry-run
 *
 * Flags:
 *   --project-ref <ref>   Existing Supabase project ref (required unless --dry-run).
 *   --bundle <name>       core | wiki | crm | wiki-crm   (default: wiki-crm)
 *   --dry-run             Print the full plan; make no network calls.
 *   --skip-functions      Apply SQL + secrets but do not deploy Edge Functions.
 *   --skip-verify         Do not run the health check / smoke scripts.
 *   --yes                 Skip the confirmation prompt.
 *   --repo-root <path>    Override the repo checkout root (default: two levels up).
 *
 * Env:
 *   SUPABASE_ACCESS_TOKEN   Management API personal access token (required
 *                           unless --dry-run). Used as `Authorization: Bearer`.
 *   MCP_ACCESS_KEY          Gateway access key (sent as x-brain-key). Generated
 *                           and printed once if unset.
 *   OPENROUTER_API_KEY      Passed through to the functions if present (needed
 *   OPENAI_API_KEY          for embeddings, metadata extraction, and the
 *   ANTHROPIC_API_KEY       wiki-profile worker's LLM synthesis).
 *
 * No dependencies beyond the Node standard library. Node 20+.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANAGEMENT_API = "https://api.supabase.com";
const SUPABASE_HOST_SUFFIX = ".supabase.co";
const VERCEL_CLONE_BASE = "https://vercel.com/new/clone";
const DASHBOARD_REPO = "https://github.com/alanshurafa/OB1";
const DASHBOARD_ROOT_DIR = "dashboards/open-brain-dashboard-pro";

// Core setup SQL -- the base thoughts table, search function, RLS, grants,
// dedup fingerprint, and upsert_thought. This is the exact SQL a manual install
// runs from docs/01-getting-started.md Steps 2.2-2.6, folded into one
// idempotent script so a re-run never fails. pgvector is enabled first (the
// manual guide toggles it in the Extensions UI; over the API we do it in SQL).
const CORE_SETUP_SQL = `-- Open Brain core setup (getting-started Steps 2.1-2.6), idempotent.
create extension if not exists vector;

create table if not exists thoughts (
  id uuid default gen_random_uuid() primary key,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists thoughts_embedding_idx on thoughts
  using hnsw (embedding vector_cosine_ops);
create index if not exists thoughts_metadata_idx on thoughts using gin (metadata);
create index if not exists thoughts_created_at_idx on thoughts (created_at desc);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists thoughts_updated_at on thoughts;
create trigger thoughts_updated_at
  before update on thoughts
  for each row
  execute function update_updated_at();

create or replace function match_thoughts(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    t.id,
    t.content,
    t.metadata,
    1 - (t.embedding <=> query_embedding) as similarity,
    t.created_at
  from thoughts t
  where 1 - (t.embedding <=> query_embedding) > match_threshold
    and (filter = '{}'::jsonb or t.metadata @> filter)
  order by t.embedding <=> query_embedding
  limit match_count;
end;
$$;

alter table thoughts enable row level security;

drop policy if exists "Service role full access" on thoughts;
create policy "Service role full access"
  on thoughts
  for all
  using (auth.role() = 'service_role');

grant select, insert, update, delete on table public.thoughts to service_role;

-- Deduplication: content fingerprint column + upsert.
alter table thoughts add column if not exists content_fingerprint text;

create unique index if not exists idx_thoughts_fingerprint
  on thoughts (content_fingerprint)
  where content_fingerprint is not null;

create or replace function upsert_thought(p_content text, p_payload jsonb default '{}')
returns jsonb as $$
declare
  v_fingerprint text;
  v_result jsonb;
  v_id uuid;
begin
  v_fingerprint := encode(sha256(convert_to(
    lower(trim(regexp_replace(p_content, '\\s+', ' ', 'g'))),
    'UTF8'
  )), 'hex');

  insert into thoughts (content, content_fingerprint, metadata)
  values (p_content, v_fingerprint, coalesce(p_payload->'metadata', '{}'::jsonb))
  on conflict (content_fingerprint) where content_fingerprint is not null do update
  set updated_at = now(),
      metadata = thoughts.metadata || coalesce(excluded.metadata, '{}'::jsonb)
  returning id into v_id;

  v_result := jsonb_build_object('id', v_id, 'fingerprint', v_fingerprint);
  return v_result;
end;
$$ language plpgsql;`;

// A schema step. `file` is relative to the repo root; `null` means the inline
// CORE_SETUP_SQL. `label` is what we print.
const SCHEMA_STEPS = {
  core: { file: null, label: "core setup (thoughts, match_thoughts, RLS, dedup)" },
  workflowStatus: {
    file: "schemas/workflow-status/migration.sql",
    label: "workflow-status (status columns for kanban)",
  },
  enhancedThoughts: {
    file: "schemas/enhanced-thoughts/schema.sql",
    label: "enhanced-thoughts (typed columns + search/stats RPCs)",
  },
  entityExtraction: {
    file: "schemas/entity-extraction/schema.sql",
    label: "entity-extraction (entities, edges, consolidation_log)",
  },
  typedReasoningEdges: {
    file: "schemas/typed-reasoning-edges/schema.sql",
    label: "typed-reasoning-edges (thought_edges; needs entity edges)",
  },
  wikiPages: {
    file: "schemas/wiki-pages/schema.sql",
    label: "wiki-pages (persistent wiki + regen guard)",
  },
  crmCore: {
    file: "schemas/crm-core/schema.sql",
    label: "crm-core (editable contacts + proposal truth layer)",
  },
  crmEngagement: {
    file: "schemas/crm-engagement/schema.sql",
    label: "crm-engagement (notes, tasks, keep-in-touch; needs crm-core)",
  },
};

// An Edge Function deploy unit. `dir` is the function's own folder (relative to
// repo root). `shared` is an optional sibling folder that must be copied
// alongside the function (wiki-profile imports ../_shared/*). `denoJson` is the
// deno.json to place next to index.ts when it lives outside the function folder.
const FUNCTIONS = {
  "open-brain-rest": {
    dir: "integrations/open-brain-rest",
    files: ["index.ts", "deno.json"],
  },
  "wiki-mcp": {
    dir: "integrations/wiki-mcp",
    files: ["index.ts", "deno.json"],
  },
  "crm-mcp": {
    dir: "integrations/crm-mcp",
    files: ["index.ts", "deno.json"],
  },
  "wiki-profile": {
    dir: "integrations/consolidation-workers/wiki-profile",
    files: ["index.ts"],
    denoJson: "integrations/consolidation-workers/deno.json",
    shared: "integrations/consolidation-workers/_shared",
  },
};

// Bundle -> ordered schema steps + Edge Functions. Order matters: every hard
// prerequisite an actual schema enforces is respected (workflow-status before
// enhanced-thoughts' upsert override; entity-extraction's edges before
// typed-reasoning-edges; crm-core before crm-engagement).
const BUNDLES = {
  core: {
    schemas: ["core", "workflowStatus", "enhancedThoughts"],
    functions: ["open-brain-rest"],
    smokes: ["live"],
  },
  wiki: {
    schemas: [
      "core",
      "workflowStatus",
      "enhancedThoughts",
      "entityExtraction",
      "typedReasoningEdges",
      "wikiPages",
    ],
    functions: ["open-brain-rest", "wiki-mcp", "wiki-profile"],
    smokes: ["live", "wiki"],
  },
  crm: {
    schemas: ["core", "workflowStatus", "enhancedThoughts", "crmCore", "crmEngagement"],
    functions: ["open-brain-rest", "crm-mcp"],
    smokes: ["live", "crm"],
  },
  "wiki-crm": {
    schemas: [
      "core",
      "workflowStatus",
      "enhancedThoughts",
      "entityExtraction",
      "typedReasoningEdges",
      "wikiPages",
      "crmCore",
      "crmEngagement",
    ],
    functions: ["open-brain-rest", "wiki-mcp", "crm-mcp", "wiki-profile"],
    smokes: ["live", "wiki", "crm"],
  },
};

const LLM_KEYS = ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"];

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const flags = { bundle: "wiki-crm" };
  const bools = new Set(["dry-run", "skip-functions", "skip-verify", "yes"]);
  const values = new Set(["project-ref", "bundle", "repo-root"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      fail(`Unexpected argument: ${arg} (flags start with --; see the README).`);
    }
    // Accept both `--flag value` and `--flag=value`.
    let name = arg.slice(2);
    let inlineValue;
    const eq = name.indexOf("=");
    if (eq !== -1) {
      inlineValue = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (bools.has(name)) {
      if (inlineValue !== undefined) fail(`Flag --${name} does not take a value.`);
      flags[camel(name)] = true;
    } else if (values.has(name)) {
      let value = inlineValue;
      if (value === undefined) {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
          fail(`Flag --${name} needs a value.`);
        }
        value = next;
        i += 1;
      }
      if (!value) fail(`Flag --${name} needs a non-empty value.`);
      flags[camel(name)] = value;
    } else {
      fail(`Unknown flag: --${name}`);
    }
  }
  return flags;
}

function camel(kebab) {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function generateKey() {
  return randomBytes(32).toString("hex");
}

function functionsBaseUrl(projectRef) {
  return `https://${projectRef}${SUPABASE_HOST_SUFFIX}/functions/v1`;
}

function gatewayUrl(projectRef) {
  return `${functionsBaseUrl(projectRef)}/open-brain-rest`;
}

function wikiProfileHealthUrl(projectRef) {
  return `${functionsBaseUrl(projectRef)}/wiki-profile/health`;
}

// Build the Deploy-to-Vercel button URL for the dashboard subfolder. Only
// non-secret defaults are pre-filled (NEXT_PUBLIC_API_URL); SESSION_SECRET is
// listed in `env` so the user is prompted, never embedded.
function vercelDeployUrl(projectRef) {
  const params = new URLSearchParams();
  params.set("repository-url", DASHBOARD_REPO);
  params.set("root-directory", DASHBOARD_ROOT_DIR);
  params.set("env", "NEXT_PUBLIC_API_URL,SESSION_SECRET");
  params.set(
    "envDescription",
    "NEXT_PUBLIC_API_URL is your open-brain-rest URL (printed above). SESSION_SECRET is any 32+ char random string.",
  );
  params.set("envLink", `${DASHBOARD_REPO}/tree/main/${DASHBOARD_ROOT_DIR}#configuration`);
  params.set("project-name", "open-brain-dashboard");
  if (projectRef) {
    params.set(
      "envDefaults",
      JSON.stringify({ NEXT_PUBLIC_API_URL: gatewayUrl(projectRef) }),
    );
  }
  return `${VERCEL_CLONE_BASE}?${params.toString()}`;
}

function resolveRepoRoot(flags) {
  if (flags.repoRoot) return path.resolve(flags.repoRoot);
  // recipes/brain-bootstrap/bootstrap.mjs -> repo root is two levels up.
  return path.resolve(__dirname, "..", "..");
}

// Read a schema step's SQL. Core is inline; everything else comes off disk so
// the installer always applies the checked-out version.
function readSchemaSql(step, repoRoot) {
  if (step.file === null) return CORE_SETUP_SQL;
  const abs = path.join(repoRoot, step.file);
  if (!fs.existsSync(abs)) {
    fail(`Schema file not found: ${step.file} (looked in ${repoRoot}). Pass --repo-root if your checkout is elsewhere.`);
  }
  return fs.readFileSync(abs, "utf8");
}

function byteLength(str) {
  return Buffer.byteLength(str, "utf8");
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg = "") {
  console.log(msg);
}

function step(title) {
  log("");
  log(`== ${title}`);
}

function ok(msg) {
  log(`  [ok]   ${msg}`);
}

function warn(msg) {
  log(`  [warn] ${msg}`);
}

function info(msg) {
  log(`  ${msg}`);
}

function fail(msg) {
  console.error(`\nError: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Confirmation prompt
// ---------------------------------------------------------------------------

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => rl.question(`${question} [y/N] `, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Management API
// ---------------------------------------------------------------------------

async function managementRequest(method, apiPath, token, body) {
  const res = await fetch(`${MANAGEMENT_API}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, ok: res.ok, data };
}

async function preflightProject(projectRef, token) {
  const { status, ok: reachable, data } = await managementRequest(
    "GET",
    `/v1/projects/${projectRef}`,
    token,
  );
  if (status === 401 || status === 403) {
    fail(
      `Access token rejected (HTTP ${status}). Confirm SUPABASE_ACCESS_TOKEN is a valid ` +
        `personal access token from https://supabase.com/dashboard/account/tokens.`,
    );
  }
  if (status === 404) {
    fail(
      `Project '${projectRef}' not found for this token (HTTP 404). Check --project-ref ` +
        `and that the token's account owns the project.`,
    );
  }
  if (!reachable) {
    fail(`Could not reach project '${projectRef}' (HTTP ${status}): ${JSON.stringify(data)}`);
  }
  return data;
}

async function applySql(projectRef, token, sql) {
  const { status, ok: applied, data } = await managementRequest(
    "POST",
    `/v1/projects/${projectRef}/database/query`,
    token,
    { query: sql },
  );
  if (!applied) {
    throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Supabase CLI (functions + secrets)
// ---------------------------------------------------------------------------

function runSupabase(args, opts = {}) {
  const base = {
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
    cwd: opts.cwd,
    timeout: 5 * 60 * 1000, // a hung CLI call should not block an unattended run forever
  };
  let res = spawnSync("supabase", args, base);
  // Windows: an npm-global CLI install is a .cmd shim, which Node cannot spawn
  // without a shell (spawnSync resolves .exe but not .cmd). Retry through
  // cmd.exe with conservatively quoted args. The documented installs (Scoop,
  // standalone) ship a .exe and take the direct path above.
  if (res.error && res.error.code === "ENOENT" && process.platform === "win32") {
    res = spawnSync("supabase", args.map(quoteForCmd), { ...base, shell: true });
  }
  return res;
}

// Quote an argument for the cmd.exe fallback path only. Our args are function
// names, refs, flags, and file paths; anything with whitespace gets wrapped.
function quoteForCmd(arg) {
  return /[\s&|^%()]/.test(arg) ? `"${arg}"` : arg;
}

// Human-useful failure detail from a spawnSync result: prefer the spawn error
// (ENOENT etc.), then the last output lines, then the exit code.
function spawnFailureDetail(res, tailLines) {
  if (res.error) return res.error.code || res.error.message;
  const text = ((res.stderr || "") + (res.stdout || "")).trim();
  if (text) return text.split("\n").slice(-tailLines).join(" | ");
  return `exit ${res.status}`;
}

function supabaseAvailable() {
  const res = runSupabase(["--version"]);
  if (res.error) return { available: false, version: null };
  if (res.status !== 0) return { available: false, version: null };
  return { available: true, version: (res.stdout || "").trim() };
}

// Stage a function's source into <workdir>/supabase/functions/<name> (plus a
// sibling _shared when needed) and deploy it. Returns { name, ok, detail }.
function deployFunction(name, spec, projectRef, token, repoRoot, workdir) {
  const functionsRoot = path.join(workdir, "supabase", "functions");
  const destDir = path.join(functionsRoot, name);
  fs.mkdirSync(destDir, { recursive: true });

  // Copy the function's own files.
  for (const file of spec.files) {
    const src = path.join(repoRoot, spec.dir, file);
    if (!fs.existsSync(src)) {
      return { name, ok: false, detail: `missing source file ${spec.dir}/${file}` };
    }
    fs.copyFileSync(src, path.join(destDir, path.basename(file)));
  }

  // deno.json living outside the function folder (wiki-profile).
  if (spec.denoJson) {
    const src = path.join(repoRoot, spec.denoJson);
    if (!fs.existsSync(src)) {
      return { name, ok: false, detail: `missing deno.json ${spec.denoJson}` };
    }
    fs.copyFileSync(src, path.join(destDir, "deno.json"));
  }

  // Shared sibling folder (wiki-profile imports ../_shared/*).
  if (spec.shared) {
    const src = path.join(repoRoot, spec.shared);
    if (!fs.existsSync(src)) {
      return { name, ok: false, detail: `missing shared dir ${spec.shared}` };
    }
    fs.cpSync(src, path.join(functionsRoot, path.basename(spec.shared)), { recursive: true });
  }

  const res = runSupabase(
    [
      "functions",
      "deploy",
      name,
      "--project-ref",
      projectRef,
      "--no-verify-jwt",
      "--use-api",
    ],
    { cwd: workdir, env: { SUPABASE_ACCESS_TOKEN: token } },
  );

  if (res.status === 0) {
    return { name, ok: true, detail: "deployed" };
  }
  return { name, ok: false, detail: spawnFailureDetail(res, 4) };
}

// Set all secrets in ONE CLI call via a temporary env file, so secret values
// never appear in the process argument list. The file lives in a fresh
// mode-0600 temp dir and is removed in a finally, success or failure.
function setSecrets(projectRef, token, pairs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ob1-secrets-"));
  const envFile = path.join(dir, "secrets.env");
  try {
    const body = `${Object.entries(pairs)
      .map(([key, value]) => `${key}="${value}"`)
      .join("\n")}\n`;
    fs.writeFileSync(envFile, body, { mode: 0o600 });
    const res = runSupabase(
      ["secrets", "set", "--env-file", envFile, "--project-ref", projectRef],
      { env: { SUPABASE_ACCESS_TOKEN: token } },
    );
    if (res.status === 0) return { ok: true, detail: "set" };
    // Defense in depth: never let a secret value reach the terminal via CLI
    // error output, even if a future CLI version echoes it back.
    return { ok: false, detail: scrubValues(spawnFailureDetail(res, 2), Object.values(pairs)) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function scrubValues(text, values) {
  let out = text;
  for (const value of values) {
    if (value) out = out.split(value).join("***");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function checkHealth(url, accessKey) {
  try {
    const res = await fetch(url, { headers: { "x-brain-key": accessKey } });
    const data = await res.json().catch(() => ({}));
    const healthy = res.ok && (data.ok === true || data.status === "ok");
    const detail = healthy
      ? "200 ok"
      : res.ok
        ? `200 but unexpected body: ${JSON.stringify(data).slice(0, 120)}`
        : `HTTP ${res.status}`;
    return { ok: healthy, detail };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkWikiProfileHealth(url) {
  try {
    const res = await fetch(url);
    return { ok: res.ok, detail: res.ok ? "200 ok (worker live)" : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

function runSmoke(scriptRel, repoRoot, restUrl, accessKey) {
  const script = path.join(repoRoot, scriptRel);
  if (!fs.existsSync(script)) {
    return { ok: false, detail: `smoke script not found: ${scriptRel}` };
  }
  const res = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, OB1_REST_URL: restUrl, OB1_REST_KEY: accessKey },
    timeout: 3 * 60 * 1000,
  });
  if (res.status === 0) {
    return { ok: true, detail: (res.stdout || "").trim().split("\n").pop() || "passed" };
  }
  return { ok: false, detail: spawnFailureDetail(res, 1) };
}

const SMOKE_SCRIPTS = {
  live: "integrations/open-brain-rest/smoke/live-smoke.mjs",
  crm: "integrations/open-brain-rest/smoke/crm-smoke.mjs",
  // Added to the repo by the wiki milestone (the same PR train that adds the
  // /wiki/* route group to open-brain-rest). Detected by file existence at
  // run time: present -> run it like the other smokes; absent (pre-milestone
  // checkout) -> explicit SKIP with a reason, never a silent omission.
  wiki: "integrations/open-brain-rest/smoke/wiki-smoke.mjs",
};

const WIKI_SMOKE_SKIP_REASON = "wiki-smoke.mjs not in this checkout — expected on merged main";

function wikiSmokePresent(repoRoot) {
  return fs.existsSync(path.join(repoRoot, SMOKE_SCRIPTS.wiki));
}

// ---------------------------------------------------------------------------
// Plan printing (dry run) and rendering
// ---------------------------------------------------------------------------

function renderPlan(bundleName, bundle, projectRef, repoRoot, opts) {
  step(`Execution plan (bundle: ${bundleName})`);
  info(`Repo checkout : ${repoRoot}`);
  info(`Project ref   : ${projectRef || "(none — dry run)"}`);
  info(`Functions URL : ${projectRef ? functionsBaseUrl(projectRef) : "(set once project ref is known)"}`);

  log("");
  info("1. SQL schemas applied via Management API, in this order:");
  bundle.schemas.forEach((key, idx) => {
    const s = SCHEMA_STEPS[key];
    const size = s.file === null ? byteLength(CORE_SETUP_SQL) : safeSize(path.join(repoRoot, s.file));
    info(`     ${idx + 1}. ${s.label}  [${size} bytes]${s.file ? `  (${s.file})` : "  (inline core setup)"}`);
  });

  log("");
  if (opts.skipFunctions) {
    info("2. Edge Functions: SKIPPED (--skip-functions).");
  } else {
    info("2. Edge Functions deployed with the Supabase CLI (--use-api, no Docker):");
    bundle.functions.forEach((name) => {
      const spec = FUNCTIONS[name];
      const extra = spec.shared ? `  (+ ${path.basename(spec.shared)} sibling)` : "";
      info(`     - ${name}  (from ${spec.dir})${extra}`);
    });
  }

  log("");
  info("3. Secrets set via `supabase secrets set`:");
  info("     - MCP_ACCESS_KEY  (generated + printed once if not in env)");
  const present = LLM_KEYS.filter((k) => process.env[k]);
  if (present.length) info(`     - passthrough from env: ${present.join(", ")}`);
  else info("     - no OPENROUTER/OPENAI/ANTHROPIC key in env (embeddings + wiki-profile need one; see README)");

  log("");
  if (opts.skipVerify) {
    info("4. Verification: SKIPPED (--skip-verify).");
  } else {
    info("4. Verification:");
    info(`     - GET ${projectRef ? gatewayUrl(projectRef) : "<functions-url>/open-brain-rest"}/health`);
    bundle.smokes.forEach((smk) => {
      if (smk === "wiki") {
        if (wikiSmokePresent(repoRoot)) {
          info(`     - node ${SMOKE_SCRIPTS.wiki}`);
        } else {
          info(`     - wiki-smoke.mjs: SKIP (${WIKI_SMOKE_SKIP_REASON})`);
        }
        info(`     - GET <functions-url>/wiki-profile/health  (worker liveness)`);
      } else {
        info(`     - node ${SMOKE_SCRIPTS[smk]}`);
      }
    });
  }

  log("");
  info("5. Finish: print dashboard env values + Deploy-to-Vercel link.");
}

function safeSize(abs) {
  try {
    return fs.statSync(abs).size;
  } catch {
    return "?";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  const bundleName = flags.bundle;
  const bundle = BUNDLES[bundleName];
  if (!bundle) {
    fail(`Unknown bundle '${bundleName}'. Choose one of: ${Object.keys(BUNDLES).join(", ")}.`);
  }

  const repoRoot = resolveRepoRoot(flags);
  const projectRef = flags.projectRef || "";
  const dryRun = Boolean(flags.dryRun);

  log("Open Brain :: brain-bootstrap");
  log("=============================");

  // Dry run: render the plan and stop before any network call.
  if (dryRun) {
    renderPlan(bundleName, bundle, projectRef, repoRoot, flags);
    step("Dry run complete");
    info("No network calls were made. Re-run without --dry-run to apply.");
    info("The first live run is how this recipe self-verifies (health + smoke).");
    return;
  }

  // --- Validate inputs for a live run ---
  const token = process.env.SUPABASE_ACCESS_TOKEN || "";
  if (!token) {
    fail(
      "SUPABASE_ACCESS_TOKEN is required for a live run. Create one at " +
        "https://supabase.com/dashboard/account/tokens and export it. (Use --dry-run to preview without a token.)",
    );
  }
  if (!projectRef) {
    fail("--project-ref <ref> is required for a live run. This recipe does not create projects (see README).");
  }
  if (!/^[a-z0-9]{16,}$/i.test(projectRef)) {
    warn(`Project ref '${projectRef}' does not look like a standard ref; continuing anyway.`);
  }

  const willDeploy = !flags.skipFunctions;

  // Access key: use env or generate one to print once at the end.
  let accessKey = process.env.MCP_ACCESS_KEY || "";
  const generatedAccessKey = !accessKey;
  if (generatedAccessKey) accessKey = generateKey();

  // Render the plan, then confirm.
  renderPlan(bundleName, bundle, projectRef, repoRoot, flags);
  if (!flags.yes) {
    log("");
    const proceed = await confirm("Apply this to the project above?");
    if (!proceed) {
      log("Aborted. Nothing was changed.");
      return;
    }
  }

  // --- Step 1: Preflight ---
  step("1. Preflight");
  const project = await preflightProject(projectRef, token);
  ok(`project reachable: ${project.name || projectRef} (${project.region || "region ?"})`);

  let cli = { available: false, version: null };
  if (willDeploy) {
    cli = supabaseAvailable();
    if (!cli.available) {
      fail(
        "Supabase CLI not found on PATH, but functions are due to deploy. Install it " +
          "(https://supabase.com/docs/guides/local-development/cli/getting-started) or pass --skip-functions.",
      );
    }
    ok(`supabase CLI present: ${cli.version}`);
  } else {
    info("supabase CLI check skipped (--skip-functions).");
  }

  // --- Step 2: Apply SQL ---
  step("2. Apply SQL schemas");
  for (const key of bundle.schemas) {
    const s = SCHEMA_STEPS[key];
    const sql = readSchemaSql(s, repoRoot);
    process.stdout.write(`  applying ${s.label} [${byteLength(sql)} bytes] ... `);
    try {
      await applySql(projectRef, token, sql);
      log("ok");
    } catch (err) {
      log("FAILED");
      fail(`Applying '${s.label}' failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  ok(`${bundle.schemas.length} schema step(s) applied (idempotent — safe to re-run).`);

  // --- Step 3: Deploy functions ---
  const deployResults = [];
  if (willDeploy) {
    step("3. Deploy Edge Functions");
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "ob1-bootstrap-"));
    try {
      for (const name of bundle.functions) {
        process.stdout.write(`  deploying ${name} ... `);
        const result = deployFunction(name, FUNCTIONS[name], projectRef, token, repoRoot, workdir);
        deployResults.push(result);
        log(result.ok ? "ok" : "FAILED");
        if (!result.ok) warn(`${name}: ${result.detail}`);
      }
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
    const failed = deployResults.filter((r) => !r.ok);
    if (failed.length) {
      warn(`${failed.length}/${deployResults.length} function(s) failed to deploy; SQL is applied. See messages above.`);
    } else {
      ok(`${deployResults.length} function(s) deployed.`);
    }
  } else {
    step("3. Deploy Edge Functions");
    info("Skipped (--skip-functions).");
  }

  // --- Step 4: Secrets ---
  let secretsFailed = false;
  if (willDeploy) {
    step("4. Set secrets");
    const pairs = { MCP_ACCESS_KEY: accessKey };
    for (const key of LLM_KEYS) {
      if (process.env[key]) pairs[key] = process.env[key];
    }
    const names = Object.keys(pairs);
    const secretResult = setSecrets(projectRef, token, pairs);
    if (secretResult.ok) {
      ok(`${names.join(", ")} set (one call, via temporary env file).`);
    } else {
      secretsFailed = true;
      warn(`secrets (${names.join(", ")}): ${secretResult.detail}`);
    }
  } else {
    step("4. Set secrets");
    info("Skipped (--skip-functions).");
  }

  // --- Step 5: Verify ---
  const verdicts = [];
  if (!flags.skipVerify && willDeploy) {
    step("5. Verify");
    const restUrl = gatewayUrl(projectRef);

    const health = await checkHealth(`${restUrl}/health`, accessKey);
    verdicts.push({ surface: "gateway /health", ...health });

    if (health.ok) {
      for (const smk of bundle.smokes) {
        if (smk === "wiki") {
          // The wiki milestone ships wiki-smoke.mjs alongside the /wiki/*
          // route group on open-brain-rest. Run it when the checkout has it;
          // on a pre-milestone checkout, report an explicit SKIP instead of
          // silently omitting the surface.
          if (wikiSmokePresent(repoRoot)) {
            const r = runSmoke(SMOKE_SCRIPTS.wiki, repoRoot, restUrl, accessKey);
            verdicts.push({ surface: "wiki-smoke.mjs", ...r });
          } else {
            verdicts.push({ surface: "wiki-smoke.mjs", ok: true, skip: true, detail: WIKI_SMOKE_SKIP_REASON });
          }
          const wp = await checkWikiProfileHealth(wikiProfileHealthUrl(projectRef));
          verdicts.push({ surface: "wiki-profile /health", ...wp });
        } else {
          const r = runSmoke(SMOKE_SCRIPTS[smk], repoRoot, restUrl, accessKey);
          verdicts.push({ surface: `${smk}-smoke.mjs`, ...r });
        }
      }
    } else {
      warn("Gateway health failed; skipping smoke scripts (they need a live gateway).");
    }

    printVerdicts(verdicts);
  } else {
    step("5. Verify");
    info(flags.skipVerify ? "Skipped (--skip-verify)." : "Skipped (no functions deployed).");
  }

  // --- Step 6: Finish ---
  step("6. Finish — dashboard + Vercel");
  const restUrl = gatewayUrl(projectRef);
  const sessionSecret = generateKey();

  log("");
  log("  Dashboard environment (open-brain-dashboard-pro):");
  log(`    NEXT_PUBLIC_API_URL=${restUrl}`);
  log(`    SESSION_SECRET=${sessionSecret}`);
  if (bundleName === "wiki" || bundleName === "wiki-crm") {
    log(`    # optional (auto-derived from API URL if unset):`);
    log(`    WIKI_PROFILE_URL=${functionsBaseUrl(projectRef)}/wiki-profile`);
  }

  if (generatedAccessKey) {
    log("");
    log("  >>> SAVE THIS NOW — generated MCP access key (shown once) <<<");
    log(`      MCP_ACCESS_KEY=${accessKey}`);
    log("      This is your x-brain-key for the dashboard login and MCP clients.");
  }
  log("");
  log("  >>> SESSION_SECRET above is freshly generated and shown once — save it too. <<<");

  log("");
  log("  Deploy the dashboard (one click):");
  log(`    ${vercelDeployUrl(projectRef)}`);
  log("");
  log("  In the Vercel form, NEXT_PUBLIC_API_URL is pre-filled; paste the SESSION_SECRET above.");

  // A failed function deploy or secrets write is always a real failure.
  // Smoke/health verdicts only count when verification actually ran.
  const deployFailed = deployResults.some((r) => !r.ok);
  const verifyFailed = verdicts.some((v) => !v.ok);
  if (deployFailed || secretsFailed || verifyFailed) {
    log("");
    fail("One or more surfaces failed. See the messages above and the troubleshooting section of the README.");
  }

  log("");
  log("Done. Your Open Brain is live.");
}

function printVerdicts(verdicts) {
  log("");
  const width = Math.max(...verdicts.map((v) => v.surface.length), 20);
  for (const v of verdicts) {
    const tag = v.skip ? "SKIP" : v.ok ? "PASS" : "FAIL";
    log(`  ${v.surface.padEnd(width)}  ${tag}  ${v.detail}`);
  }
}

main().catch((err) => {
  fail(err instanceof Error ? (err.stack || err.message) : String(err));
});
