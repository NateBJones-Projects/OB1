#!/usr/bin/env node
/**
 * Evaluate provenance chains on derived thoughts.
 *
 * For each derived thought (derivation_layer='derived' and a non-empty
 * derived_from), fetches its parents, formats a grading prompt, and asks an
 * LLM grader to score three dimensions (0-5):
 *   - existence:   do parents render cleanly with real content?
 *   - relevance:   are parents topically about what the derived thought claims?
 *   - sufficiency: is the claim supported by the cited parents?
 *
 * Scores persist on the derived row as metadata:
 *   eval_score, eval_dimensions, eval_rationale, eval_graded_at, eval_grader
 *
 * Graders (pick one):
 *   openrouter  — call a hosted model via OpenRouter (default, requires key)
 *   stdin       — print the prompt, read JSON from stdin (manual / scripted)
 *   queue       — emit prompts to a JSONL file for another worker to grade;
 *                 resume with --apply-scores FILE to write scores back
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   ANTHROPIC_API_KEY=<key>   # or OPENROUTER_API_KEY as a fallback
 *   node eval.mjs --limit 5
 *
 *   node eval.mjs --grader stdin --ids <uuid>,<uuid>
 *   node eval.mjs --grader queue --limit 20 --out prompts.jsonl
 *   node eval.mjs --apply-scores scores.jsonl
 *
 * Flags:
 *   --grader {openrouter|stdin|queue}   default openrouter
 *   --limit N                          default 10, cap 200
 *   --ids a,b,c                        grade specific thought IDs only
 *   --force                            re-grade thoughts already scored
 *   --dry-run                          skip PATCH back to DB
 *   --model NAME                       openrouter model (default: anthropic/claude-3.5-haiku)
 *   --concurrency N                    openrouter grader concurrency (default 3)
 *   --out FILE                         queue mode prompts output path
 *   --apply-scores FILE                write scores from a queue-mode JSONL back to DB
 *   --report FILE                      markdown report output path (default stdout)
 */

import fs from "node:fs";

// ── CLI + env ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    grader: "openrouter",
    limit: 10,
    ids: null,
    force: false,
    dryRun: false,
    model: "anthropic/claude-3.5-haiku",
    concurrency: 3,
    out: null,
    applyScores: null,
    report: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--grader") args.grader = argv[++i];
    else if (a === "--limit") args.limit = Math.min(Math.max(1, Number(argv[++i]) || 10), 200);
    else if (a === "--ids") args.ids = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--concurrency") args.concurrency = Math.max(1, Number(argv[++i]) || 3);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--apply-scores") args.applyScores = argv[++i];
    else if (a === "--report") args.report = argv[++i];
  }
  if (!["openrouter", "stdin", "queue"].includes(args.grader)) {
    throw new Error(`invalid --grader: ${args.grader}. Use openrouter|stdin|queue.`);
  }
  return args;
}

// Canonical SUPABASE_* names first, legacy OPEN_BRAIN_* accepted as a
// fallback so existing setups keep working. Warn once per run if legacy
// names are in use.
//
// Grader key: the openrouter grader hits openrouter.ai/api/v1 with a
// bearer token, so either an OPENROUTER_API_KEY or (if your setup aliases
// the canonical OB1 ANTHROPIC_API_KEY to an OpenRouter key) ANTHROPIC_API_KEY
// will work. If only ANTHROPIC_API_KEY is set we warn that a real OpenRouter
// key is expected for the openrouter grader so mis-set tokens fail loudly
// instead of returning 401 deep in the run.
const URL_FROM_CANONICAL = process.env.SUPABASE_URL;
const URL_FROM_LEGACY = process.env.OPEN_BRAIN_URL;
const KEY_FROM_CANONICAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KEY_FROM_LEGACY = process.env.OPEN_BRAIN_SERVICE_KEY;
const ANTHROPIC_KEY_RAW = process.env.ANTHROPIC_API_KEY ?? "";
const OPENROUTER_KEY_RAW = process.env.OPENROUTER_API_KEY ?? "";

if (
  (!URL_FROM_CANONICAL && URL_FROM_LEGACY) ||
  (!KEY_FROM_CANONICAL && KEY_FROM_LEGACY)
) {
  console.warn(
    "[eval] DEPRECATION: OPEN_BRAIN_URL / OPEN_BRAIN_SERVICE_KEY are the " +
    "legacy names. Prefer SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — every " +
    "other OB1 recipe uses those and the fallback will be removed in a future " +
    "release.",
  );
}

if (!OPENROUTER_KEY_RAW && ANTHROPIC_KEY_RAW) {
  console.warn(
    "[eval] Using ANTHROPIC_API_KEY as the OpenRouter bearer token. The " +
    "openrouter grader calls openrouter.ai; if your ANTHROPIC_API_KEY is a " +
    "real Anthropic key (not an OpenRouter alias) it will return 401. Set " +
    "OPENROUTER_API_KEY explicitly, or use --grader stdin / --grader queue.",
  );
}

const BASE_URL = (URL_FROM_CANONICAL ?? URL_FROM_LEGACY ?? "").replace(/\/+$/, "");
const SERVICE_KEY = KEY_FROM_CANONICAL ?? KEY_FROM_LEGACY ?? "";
const OPENROUTER_KEY = OPENROUTER_KEY_RAW || ANTHROPIC_KEY_RAW;

if (!BASE_URL || !SERVICE_KEY) {
  console.error(
    "[eval] missing env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. " +
    "(Legacy OPEN_BRAIN_URL / OPEN_BRAIN_SERVICE_KEY are still accepted.)",
  );
  process.exit(1);
}

const REST = `${BASE_URL}/rest/v1`;
const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// ── Supabase helpers ───────────────────────────────────────────────────────

async function sbGet(queryPath) {
  const res = await fetch(`${REST}/${queryPath}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${queryPath}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbPatch(queryPath, body) {
  const res = await fetch(`${REST}/${queryPath}`, {
    method: "PATCH",
    headers: { ...HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${queryPath}: ${res.status} ${await res.text()}`);
}

// Tag attached to errors raised by sbRpc when the server-side plpgsql
// function signalled a missing-row RAISE (SQLSTATE 22023 no_data_found,
// surfaced by PostgREST as HTTP 400/404 with a JSON body containing
// "code":"P0001" or the mapped no_data_found code). Callers that care —
// applyScoresFromFile — test err.notFound to classify the write as a
// failed write rather than a success.
class RpcNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "RpcNotFoundError";
    this.notFound = true;
  }
}

// POST to a PostgREST RPC endpoint. The server-side function is expected to
// RETURNS VOID, so we ask PostgREST not to send a body back (`return=minimal`)
// and we do not try to parse one here. Matches the RPC helper in backfill.mjs.
//
// Zero-row merges raise "Thought <id> not found" (no_data_found, 22023) —
// PostgREST maps that to HTTP 400/404 with a JSON body. We detect the
// message and surface it as RpcNotFoundError so apply-scores can classify
// the write as a failed write instead of a silent success.
async function sbRpc(fnName, body) {
  const res = await fetch(`${REST}/rpc/${fnName}`, {
    method: "POST",
    headers: { ...HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // PostgREST surfaces plpgsql RAISE ... USING ERRCODE = 'no_data_found'
    // as HTTP 404 (or 400 on older builds) with a JSON body whose `message`
    // field carries our "Thought <id> not found" string. Detect either the
    // status or the message so the caller can treat it as a failed write.
    const isNotFound =
      res.status === 404 ||
      /Thought\s+[0-9a-f-]+\s+not found/i.test(text) ||
      /no_data_found/i.test(text);
    if (isNotFound) {
      throw new RpcNotFoundError(
        `RPC ${fnName}: target thought not found (${res.status} ${text.slice(0, 200)})`,
      );
    }
    throw new Error(`RPC ${fnName}: ${res.status} ${text.slice(0, 300)}`);
  }
}

// ── Candidate + parent fetchers ────────────────────────────────────────────

async function fetchCandidates(args) {
  // Canonical public.thoughts stores source_type, type, and eval_graded_at
  // inside metadata. We alias just the specific keys we read via PostgREST's
  // "alias:path" select rather than snapshotting the whole metadata blob —
  // any later write-back from a stale snapshot would race with backfill's
  // merge_thought_provenance_metadata and silently erase metadata.provenance.
  // eval_graded_at is only used to skip already-graded rows; all other eval
  // fields are written via the merge_thought_eval_metadata RPC.
  const select = "select=id,source_type:metadata->>source_type,type:metadata->>type,eval_graded_at:metadata->>eval_graded_at,content,derived_from,derivation_layer";
  let query = `thoughts?${select}&order=created_at.desc`;
  if (args.ids) {
    // PostgREST in.(…) with UUIDs needs no quoting per element.
    query += `&id=in.(${args.ids.join(",")})`;
  } else {
    query += `&derivation_layer=eq.derived&limit=${args.limit * 3}`;
  }
  const rows = await sbGet(query);
  const candidates = rows.filter((r) => {
    if (r.derivation_layer !== "derived") return false;
    if (!Array.isArray(r.derived_from) || r.derived_from.length === 0) return false;
    if (!args.force && r.eval_graded_at) return false;
    return true;
  });
  return candidates.slice(0, args.limit);
}

async function fetchParents(parentIds) {
  if (!parentIds || parentIds.length === 0) return [];
  const sliced = parentIds.slice(0, 40);
  // PostgREST handles UUID and int ids the same way in in.() lists. Alias
  // metadata-stored source_type / type back to flat fields for the prompt
  // formatter which reads p.source_type / p.type directly.
  const query = `thoughts?select=id,source_type:metadata->>source_type,type:metadata->>type,content,created_at&id=in.(${sliced.join(",")})`;
  return sbGet(query);
}

// ── Prompt shaping ─────────────────────────────────────────────────────────

function formatPrompt(child, parents) {
  const parentLines = parents.map((p, i) => {
    const preview = String(p.content ?? "").replace(/\s+/g, " ").slice(0, 280);
    const date = String(p.created_at ?? "").slice(0, 10);
    return `  [${i + 1}] id:${p.id} source:${p.source_type} type:${p.type} date:${date}\n      ${preview}`;
  }).join("\n");

  return (
    `You are grading a provenance chain in a personal knowledge system.\n` +
    `A DERIVED thought cites multiple atomic PARENT thoughts as its evidence.\n` +
    `Grade whether the derived thought is actually supported by its parents.\n` +
    `\n` +
    `Return ONLY valid JSON. No preamble, no commentary, no code fences. Schema:\n` +
    `{"existence":<0-5>,"relevance":<0-5>,"sufficiency":<0-5>,"rationale":"<1-2 sentences explaining any sub-5 score, or 'all good' if 5/5/5>"}\n` +
    `\n` +
    `Rubric:\n` +
    `  existence:   5 if every parent below renders with real, non-empty content; deduct for empty or unreadable rows.\n` +
    `  relevance:   5 if every parent is topically on-subject for what the derived thought claims; deduct for off-topic or noisy parents.\n` +
    `  sufficiency: 5 if the derived claim is clearly supported by the cited parents; deduct for over-reach, leaps, or missing evidence.\n` +
    `\n` +
    `---\n` +
    `DERIVED thought:\n` +
    `  id: ${child.id}\n` +
    `  source_type: ${child.source_type}\n` +
    `  type: ${child.type}\n` +
    `  content: ${String(child.content ?? "").replace(/\s+/g, " ").slice(0, 600)}\n` +
    `\n` +
    `PARENTS (n=${parents.length}, showing up to 40):\n` +
    `${parentLines}\n` +
    `---\n` +
    `Grade this chain. Return the JSON object only.`
  );
}

function extractJson(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  try { return JSON.parse(trimmed); } catch {}
  // Find the last balanced {…} block — LLMs often trail it with junk.
  const start = trimmed.lastIndexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    if (trimmed[i] === "{") depth++;
    else if (trimmed[i] === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(trimmed.slice(start, i + 1)); } catch {}
      }
    }
  }
  return null;
}

function validateScore(obj) {
  if (!obj || typeof obj !== "object") return null;
  const keys = ["existence", "relevance", "sufficiency"];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 5) return null;
  }
  return {
    existence: obj.existence,
    relevance: obj.relevance,
    sufficiency: obj.sufficiency,
    rationale: String(obj.rationale ?? "").slice(0, 400),
  };
}

// ── Graders ────────────────────────────────────────────────────────────────

async function gradeWithOpenRouter(prompt, model) {
  if (!OPENROUTER_KEY) {
    throw new Error("OPENROUTER_API_KEY is required for the openrouter grader. Use --grader stdin or queue instead.");
  }
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      // OpenRouter recommends an app identifier so usage is traceable.
      "HTTP-Referer": "https://github.com/NateBJones-Projects/OB1",
      "X-Title": "Open Brain Provenance Eval",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`openrouter ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return validateScore(extractJson(text));
}

async function gradeWithStdin(prompt) {
  process.stdout.write("\n═══ PROMPT ═══\n");
  process.stdout.write(prompt + "\n");
  process.stdout.write("═══ END PROMPT ═══\n");
  process.stdout.write("Paste the JSON score and press Enter twice:\n");
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk.toString("utf8"));
    if (chunks.join("").includes("\n\n")) break;
  }
  return validateScore(extractJson(chunks.join("")));
}

// ── Concurrency helper ─────────────────────────────────────────────────────

async function processInChunks(items, fn, concurrency) {
  const out = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(fn));
    out.push(...results);
  }
  return out;
}

// ── Score persistence ──────────────────────────────────────────────────────

async function writeScore(thoughtId, score, grader) {
  const avg = Math.round(
    ((score.existence + score.relevance + score.sufficiency) / 3) * 100,
  ) / 100;
  // Flat top-level eval keys. merge_thought_eval_metadata performs
  // `metadata = metadata || p_eval` server-side, so these five keys replace
  // their own values while every other key (including metadata.provenance
  // written by backfill) is preserved. No GET+mutate+PATCH round trip here,
  // so there is no stale-snapshot race against the backfill RPC.
  const patch = {
    eval_score: avg,
    eval_dimensions: {
      existence: score.existence,
      relevance: score.relevance,
      sufficiency: score.sufficiency,
    },
    eval_rationale: score.rationale,
    eval_graded_at: new Date().toISOString(),
    eval_grader: grader,
  };
  await sbRpc("merge_thought_eval_metadata", {
    p_thought_id: thoughtId,
    p_eval: patch,
  });
}

// ── Queue mode helpers ─────────────────────────────────────────────────────

function emitQueue(candidates, parentsByChild, outPath) {
  const outFile = outPath ?? `eval-prompts-${Date.now()}.jsonl`;
  const lines = candidates.map((c) =>
    JSON.stringify({
      thought_id: c.id,
      source_type: c.source_type,
      parent_count: (parentsByChild.get(c.id) ?? []).length,
      prompt: formatPrompt(c, parentsByChild.get(c.id) ?? []),
    }),
  );
  fs.writeFileSync(outFile, lines.join("\n") + "\n", "utf8");
  console.log(`[eval] emitted ${candidates.length} prompts to ${outFile}`);
  console.log("Your grader should append one JSON line per thought to a score file:");
  console.log(`  {"thought_id":"<id>","score":{"existence":N,"relevance":N,"sufficiency":N,"rationale":"..."},"grader":"name"}`);
  console.log(`Then run: node eval.mjs --apply-scores <score-file>`);
  return outFile;
}

async function applyScoresFromFile(file, dryRun) {
  const raw = fs.readFileSync(file, "utf8");
  const results = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); }
    catch (e) { console.error(`[eval] invalid JSONL line: ${trimmed.slice(0, 120)}`); continue; }
    if (obj.error) {
      results.push({ id: obj.thought_id, error: obj.error });
      continue;
    }
    const score = validateScore(obj.score);
    if (!score) {
      results.push({ id: obj.thought_id, error: "invalid score shape" });
      continue;
    }
    const avg = (score.existence + score.relevance + score.sufficiency) / 3;
    const entry = { id: obj.thought_id, score, avg, sourceType: obj.source_type ?? "?", parentCount: obj.parent_count ?? 0 };
    if (!dryRun) {
      // merge_thought_eval_metadata performs a server-side
      // `metadata = metadata || p_eval` on the current row. No stale JS
      // snapshot, no clobber of a concurrent backfill RPC. The RPC now
      // RAISEs `no_data_found` (HTTP 404) when the target row is missing
      // — stale score files or mistyped thought_ids used to look
      // "applied" in the report even though nothing was written. Catch
      // that and classify the row as an error so the summary reflects
      // reality and downstream automation can detect the miss.
      try {
        await writeScore(obj.thought_id, score, obj.grader ?? "queue");
        results.push(entry);
      } catch (err) {
        if (err && err.notFound) {
          console.error(`  ${obj.thought_id} MISSING: target thought not found in DB`);
          results.push({ id: obj.thought_id, sourceType: entry.sourceType, parentCount: entry.parentCount, error: "thought not found (deleted or mistyped id)" });
        } else {
          console.error(`  ${obj.thought_id} FAILED: ${err.message}`);
          results.push({ id: obj.thought_id, sourceType: entry.sourceType, parentCount: entry.parentCount, error: err.message });
        }
      }
    } else {
      // Dry-run: no write attempted, so we cannot detect missing rows.
      // Still record the entry as scored so the report mirrors the input
      // queue faithfully.
      results.push(entry);
    }
  }
  return results;
}

// ── Report writer ──────────────────────────────────────────────────────────

function writeReport(results, summary, grader, reportPath) {
  const lines = [
    `# Provenance Eval Report`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    `Grader: ${grader}`,
    `Thoughts evaluated: ${results.length}`,
    `Average composite score: ${summary.avg?.toFixed(2) ?? "n/a"}/5`,
    `Per-dimension averages: existence=${summary.e?.toFixed(2) ?? "n/a"} relevance=${summary.r?.toFixed(2) ?? "n/a"} sufficiency=${summary.s?.toFixed(2) ?? "n/a"}`,
    ``,
    `## Results`,
    ``,
  ];
  for (const r of results) {
    lines.push(`### ${r.id} [${r.sourceType ?? "?"}]`);
    lines.push("");
    if (r.error) {
      lines.push(`**Error:** ${r.error}`);
    } else {
      lines.push(`- existence: **${r.score.existence}/5**`);
      lines.push(`- relevance: **${r.score.relevance}/5**`);
      lines.push(`- sufficiency: **${r.score.sufficiency}/5**`);
      lines.push(`- composite: **${r.avg.toFixed(2)}/5** (${r.parentCount} parents)`);
      lines.push("");
      lines.push(`_${r.score.rationale}_`);
    }
    lines.push("");
  }
  const text = lines.join("\n");
  if (reportPath) {
    fs.writeFileSync(reportPath, text, "utf8");
    console.log(`[eval] report written: ${reportPath}`);
  } else {
    process.stdout.write("\n" + text + "\n");
  }
}

function summarize(scored) {
  if (scored.length === 0) return {};
  const n = scored.length;
  return {
    avg: scored.reduce((a, r) => a + r.avg, 0) / n,
    e: scored.reduce((a, r) => a + r.score.existence, 0) / n,
    r: scored.reduce((a, r) => a + r.score.relevance, 0) / n,
    s: scored.reduce((a, r) => a + r.score.sufficiency, 0) / n,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // apply-scores short circuit
  if (args.applyScores) {
    console.log(`[eval] applying scores from ${args.applyScores} (dry-run=${args.dryRun})`);
    const results = await applyScoresFromFile(args.applyScores, args.dryRun);
    const scored = results.filter((r) => !r.error);
    const errors = results.filter((r) => r.error);
    const missing = errors.filter((r) => /thought not found/i.test(String(r.error ?? "")));
    writeReport(results, summarize(scored), "queue", args.report);
    console.log(`[eval] applied ${scored.length}/${results.length} scores (errors=${errors.length}, missing=${missing.length})`);
    if (missing.length > 0) {
      const ids = missing.slice(0, 10).map((r) => r.id);
      const more = missing.length > ids.length ? `, +${missing.length - ids.length} more` : "";
      console.error(`[eval] WARN — ${missing.length} score(s) targeted missing thoughts: ${ids.join(", ")}${more}. Re-verify the score file or regenerate with --grader queue.`);
    }
    // Non-zero exit if any write failed so unattended automation can detect
    // half-applied runs. Dry-run never writes, so never exits non-zero here.
    if (!args.dryRun && errors.length > 0) process.exit(1);
    return;
  }

  console.log(`[eval] grader=${args.grader} limit=${args.limit} model=${args.model}`);

  // Fail fast on missing grader credentials — otherwise the script would
  // fetch up to `limit` candidates plus one parents-lookup each, then
  // explode on the first grader call. Cheap Supabase round-trips are
  // still round-trips the operator didn't ask for.
  if (args.grader === "openrouter" && !OPENROUTER_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY (or ANTHROPIC_API_KEY aliased to an OpenRouter " +
      "key) is required for --grader openrouter. Use --grader stdin or " +
      "--grader queue for a no-key fallback.",
    );
  }

  const candidates = await fetchCandidates(args);
  if (candidates.length === 0) {
    console.log("[eval] no eligible derived thoughts found. Did you run backfill.mjs yet?");
    return;
  }
  console.log(`[eval] evaluating ${candidates.length} derived thought(s)`);

  // Fetch parents in parallel
  const parentsByChild = new Map();
  await Promise.all(candidates.map(async (c) => {
    const parents = await fetchParents(c.derived_from ?? []);
    parentsByChild.set(c.id, parents);
  }));

  // Queue mode just emits prompts and exits
  if (args.grader === "queue") {
    emitQueue(candidates, parentsByChild, args.out);
    return;
  }

  async function gradeOne(child) {
    const parents = parentsByChild.get(child.id) ?? [];
    const prompt = formatPrompt(child, parents);
    try {
      const score = args.grader === "stdin"
        ? await gradeWithStdin(prompt)
        : await gradeWithOpenRouter(prompt, args.model);
      if (!score) {
        return { id: child.id, sourceType: child.source_type, parentCount: parents.length, error: "grader returned no valid score" };
      }
      const avg = (score.existence + score.relevance + score.sufficiency) / 3;
      if (!args.dryRun) await writeScore(child.id, score, args.grader);
      console.log(`  ${child.id} -> ${avg.toFixed(2)}/5 (${score.existence}/${score.relevance}/${score.sufficiency})`);
      return { id: child.id, sourceType: child.source_type, parentCount: parents.length, score, avg };
    } catch (err) {
      console.error(`  ${child.id} FAILED: ${err.message}`);
      return { id: child.id, sourceType: child.source_type, parentCount: parents.length, error: err.message };
    }
  }

  // stdin grader must be serial; openrouter can run with configured concurrency.
  const concurrency = args.grader === "stdin" ? 1 : args.concurrency;
  const results = await processInChunks(candidates, gradeOne, concurrency);
  const scored = results.filter((r) => !r.error);
  writeReport(results, summarize(scored), args.grader, args.report);
  console.log(`\n[eval] complete: ${scored.length}/${results.length} scored.`);
}

main().catch((err) => {
  console.error("[eval] FAILED:", err.message);
  process.exit(1);
});
