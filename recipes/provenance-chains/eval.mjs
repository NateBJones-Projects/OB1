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
 *   OPEN_BRAIN_URL=https://<ref>.supabase.co \
 *   OPEN_BRAIN_SERVICE_KEY=<service-role-key> \
 *   OPENROUTER_API_KEY=<key> \
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
import path from "node:path";

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

const BASE_URL = (process.env.OPEN_BRAIN_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.OPEN_BRAIN_SERVICE_KEY ?? "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? "";

if (!BASE_URL || !SERVICE_KEY) {
  console.error("[eval] missing env. Set OPEN_BRAIN_URL and OPEN_BRAIN_SERVICE_KEY.");
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

// ── Candidate + parent fetchers ────────────────────────────────────────────

async function fetchCandidates(args) {
  const select = "select=id,source_type,type,content,metadata,derived_from,derivation_layer";
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
    if (!args.force && r.metadata?.eval_graded_at) return false;
    return true;
  });
  return candidates.slice(0, args.limit);
}

async function fetchParents(parentIds) {
  if (!parentIds || parentIds.length === 0) return [];
  const sliced = parentIds.slice(0, 40);
  // PostgREST handles UUID and int ids the same way in in.() lists.
  const query = `thoughts?select=id,source_type,type,content,created_at&id=in.(${sliced.join(",")})`;
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

async function writeScore(thoughtId, score, grader, existingMetadata) {
  const avg = Math.round(
    ((score.existence + score.relevance + score.sufficiency) / 3) * 100,
  ) / 100;
  const merged = {
    ...(existingMetadata ?? {}),
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
  await sbPatch(`thoughts?id=eq.${thoughtId}`, { metadata: merged });
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
    results.push({ id: obj.thought_id, score, avg, sourceType: obj.source_type ?? "?", parentCount: obj.parent_count ?? 0 });
    if (!dryRun) {
      const rows = await sbGet(`thoughts?select=metadata&id=eq.${obj.thought_id}`);
      if (rows.length === 0) {
        console.error(`[eval] thought ${obj.thought_id} not found, skipping`);
        continue;
      }
      await writeScore(obj.thought_id, score, obj.grader ?? "queue", rows[0].metadata ?? {});
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
    writeReport(results, summarize(scored), "queue", args.report);
    console.log(`[eval] applied ${scored.length}/${results.length} scores`);
    return;
  }

  console.log(`[eval] grader=${args.grader} limit=${args.limit} model=${args.model}`);

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
      if (!args.dryRun) await writeScore(child.id, score, args.grader, child.metadata ?? {});
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
