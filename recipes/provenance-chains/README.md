# Provenance Chains Pipeline

> Backfill, evaluate, and query the derivation relationships added by the Provenance Chains schema — so Open Brain can answer "show me why I believe X" and "what downstream artifacts cite this atomic thought?"

## What It Does

The [Provenance Chains schema](../../schemas/provenance-chains/) adds four columns (`derived_from`, `derivation_method`, `derivation_layer`, `supersedes`) and two SQL helper functions to `public.thoughts`. This recipe is the operational layer on top:

1. **`backfill.mjs`** — One-time script to mark existing derived artifacts (weekly digests, wikis, lint reports, etc.) as `derivation_layer='derived'` and, where the saved artifact exposes thought IDs, populate `derived_from`.
2. **`eval.mjs`** — Nightly (or on-demand) grader that scores each derived thought on existence / relevance / sufficiency using an LLM, and writes the scores into the thought's metadata so dashboards can surface low-quality chains. Three grader backends: `openrouter` (hosted, default), `stdin` (manual), and `queue` (emit prompts → another worker grades → apply back).
3. **`mcp-tools.ts`** — Two MCP tool handler snippets (`trace_provenance`, `find_derivatives`) to drop into your `open-brain-mcp` Edge Function. They wrap the SQL helpers and handle redaction of restricted ancestors, cycle tolerance, and node caps.

Together, the schema + this recipe turn a flat thoughts table into a directed provenance graph that any Claude/GPT client can query through MCP.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- [Provenance Chains schema](../../schemas/provenance-chains/) applied (adds the columns and helper SQL functions this recipe depends on)
- Node.js 18+
- Optional: an [OpenRouter](https://openrouter.ai) API key for the `openrouter` grader in `eval.mjs`. You can use `--grader stdin` or `--grader queue` instead if you prefer not to pay per-call grading costs.
- Deno-style Supabase Edge Function runtime if you install the MCP tool handlers

## Credential Tracker

```text
PROVENANCE CHAINS PIPELINE -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase URL:              ____________   (SUPABASE_URL)
  Service role key:          ____________   (SUPABASE_SERVICE_ROLE_KEY)

OPTIONAL — FOR OPENROUTER GRADER
  OpenRouter API key:        ____________   (OPENROUTER_API_KEY)
  Grader model override:     ____________   (e.g., anthropic/claude-3.5-haiku)

Legacy names (still accepted with a deprecation warning):
  OPEN_BRAIN_URL, OPEN_BRAIN_SERVICE_KEY
--------------------------------------
```

## Steps

![Step 1](https://img.shields.io/badge/Step_1-Apply_Schema-1E88E5?style=for-the-badge)

1. Install the [Provenance Chains schema](../../schemas/provenance-chains/) first. The recipe will fail with `column "derivation_layer" does not exist` otherwise.

![Step 2](https://img.shields.io/badge/Step_2-Configure_Credentials-1E88E5?style=for-the-badge)

2. Export your Supabase credentials (or put them in a `.env` file your shell sources). The canonical names match every other OB1 recipe:

   ```bash
   export SUPABASE_URL="https://<project-ref>.supabase.co"
   export SUPABASE_SERVICE_ROLE_KEY="<service_role key>"
   # Optional:
   export OPENROUTER_API_KEY="<openrouter key>"
   ```

   The legacy pair `OPEN_BRAIN_URL` / `OPEN_BRAIN_SERVICE_KEY` still works — the scripts accept either and print a one-time deprecation warning when they see the legacy names. `ANTHROPIC_API_KEY` is also accepted as a fallback for `OPENROUTER_API_KEY` if your setup aliases the Anthropic key to an OpenRouter one.

   > [!CAUTION]
   > The service key must be your **service_role** key, not the anon key. The backfill/eval scripts need to PATCH the `thoughts` table, which is protected by RLS for non-service callers.

![Step 3](https://img.shields.io/badge/Step_3-Dry_Run_Backfill-1E88E5?style=for-the-badge)

3. Preview what the backfill would change. The default pattern matches any `source_type` ending in `_pointer`; adjust `--patterns` if your recipes use different suffixes like `_digest` or `_summary`:

   ```bash
   node backfill.mjs --dry-run --patterns _pointer,_digest,_summary
   ```

   The output reports each candidate row, whether an artifact file was found on disk, and how many parent IDs were parseable.

![Step 4](https://img.shields.io/badge/Step_4-Run_Backfill-1E88E5?style=for-the-badge)

4. When the dry-run output looks right, run it for real. If your artifacts live in a specific directory, pass `--root`:

   ```bash
   node backfill.mjs --patterns _pointer,_digest,_summary --root ./artifacts
   ```

   The script is idempotent — re-runs skip rows already marked `derivation_layer='derived'`. Pass `--force` if you need to re-process (e.g., after regenerating artifacts).

   The metadata mirror (`metadata.provenance`) is written via the `merge_thought_provenance_metadata` RPC, which performs the merge in a single server-side `UPDATE`. This is race-free against concurrent writers like `eval.mjs` — no stale JS snapshot of `metadata` is ever replayed back.

![Step 5](https://img.shields.io/badge/Step_5-Evaluate_Quality-1E88E5?style=for-the-badge)

5. Score the backfilled chains. For a quick smoke test with the default OpenRouter grader:

   ```bash
   node eval.mjs --limit 3
   ```

   For a scripted nightly run without API cost, pipe JSON scores in via stdin, or use queue mode:

   ```bash
   # Queue mode: emit prompts, let a separate worker grade, then apply.
   node eval.mjs --grader queue --limit 20 --out tmp/prompts.jsonl
   # (grade tmp/prompts.jsonl externally, writing one JSON score per line to tmp/scores.jsonl)
   node eval.mjs --apply-scores tmp/scores.jsonl
   ```

   Scores land on the derived thought's `metadata` under `eval_score`, `eval_dimensions`, `eval_rationale`, `eval_graded_at`, and `eval_grader`. A low composite score (e.g., `< 3`) is a good prompt to regenerate the artifact.

![Step 6](https://img.shields.io/badge/Step_6-Install_MCP_Tools-1E88E5?style=for-the-badge)

6. Open your `open-brain-mcp` Edge Function (usually `supabase/functions/open-brain-mcp/index.ts`) and paste the two `server.registerTool(...)` blocks from [`mcp-tools.ts`](./mcp-tools.ts) alongside your other tool registrations.

   Deploy the function:

   ```bash
   supabase functions deploy open-brain-mcp
   ```

   In Claude Desktop, open your Open Brain connector — you should now see `trace_provenance` and `find_derivatives` in the tool list.

## Expected Outcome

After the full pipeline:

- Every derived artifact row has `derivation_layer = 'derived'` and `derivation_method = 'synthesis'` at the top level.
- The same fields (plus `backfilled_at`, `backfill_reason`, and, when parsed, `derived_from`) are mirrored into `metadata.provenance` so the canonical `upsert_thought` RPC — which only preserves the metadata blob on `content_fingerprint` conflicts — round-trips provenance if the row is ever re-upserted.
- Rows whose artifact files expose thought IDs have a non-empty top-level `derived_from` array.
- Derived rows have `metadata.eval_score` and the three `eval_dimensions` set.
- Two new MCP tools are live: `trace_provenance(thought_id, depth?)` and `find_derivatives(thought_id, limit?)`. Restricted-tier rows are always filtered out by `find_derivatives` at the SQL layer — there is no caller-visible override.
- Claude can now answer questions like:
  - "Show me the sources that feed into my March weekly digest."
  - "What wikis or digests cite the thought about the bug I fixed on Friday?"
  - "Is this digest actually supported by its cited thoughts, or is the model overreaching?"

## ID Type Note

This recipe assumes `public.thoughts.id` is a `UUID` (the canonical Open Brain setup). If you have customized your schema to a `BIGINT` primary key:

- In `mcp-tools.ts`, change the `z.string().uuid()` input schemas to `z.number().int().positive()` and remove the UUID casts.
- In `backfill.mjs`, **integer-style `#123` references raise a hard error** on the canonical UUID install — the script logs `parse error: refusing to write N integer ref(s) ...` and continues. That row is still flipped to `derivation_layer='derived'` but without any `derived_from`, so operators can fix the artifact and re-run with `--force`. Nothing corrupt reaches PostgREST. Users on a BIGINT fork must skip this recipe's backfill and repopulate `derived_from` themselves (or edit the `parseParentIds` helper to emit the integers uncasted). Mixing UUID and integer elements in one `derived_from` array also breaks the GIN containment index; keep one ID shape per array.
- In `eval.mjs`, PostgREST `in.(…)` accepts either shape without changes.

See the schema README's ID Type Note for the SQL-side adjustments.

## Scheduling the Eval

To grade new derived thoughts every night, create a small wrapper that sources your env and runs `eval.mjs`:

```bash
#!/usr/bin/env bash
set -euo pipefail
source /opt/open-brain/.env
cd /opt/open-brain/recipes/provenance-chains
node eval.mjs --grader openrouter --limit 50 --report ./reports/eval-$(date +%F).md
```

Drop it in cron or a systemd timer. For a weekly deep-dive on low scorers, add `--force` and filter by score in your dashboard.

## Troubleshooting

**Issue: `[backfill] GET thoughts: 400 "column \"derivation_layer\" does not exist"`**
Solution: Apply the [Provenance Chains schema](../../schemas/provenance-chains/) first. This recipe depends on the columns and helper functions it installs.

**Issue: Backfill patches rows but `derived_from` stays NULL**
Solution: Most artifact files don't print thought IDs in a machine-parseable way. The script will still mark the row `derived` (so `trace_provenance` knows it's regenerable) and still mirror provenance into `metadata.provenance` for durability, but without a `derived_from` array the row appears as a synthesis with no known parents. For new artifacts, write the parent ID list into `metadata.provenance.derived_from` at generation time so `upsert_thought` (which only persists the metadata blob on content_fingerprint conflicts) keeps it across re-captures; a companion recipe or migration can then promote metadata.provenance.derived_from → the top-level `derived_from` column for fast GIN lookup.

**Issue: `eval.mjs` "grader returned no valid score"**
Solution: The model returned something other than strict JSON. Try a stronger/temperature-0 model via `--model anthropic/claude-3.5-sonnet`, or use `--grader stdin` to inspect the prompt and craft the JSON yourself.

**Issue: `find_derivatives` returns no rows even after backfill**
Solution: Usually an ID-type mismatch. The default SQL function builds the needle as `jsonb_build_array(p_thought_id::text)` (JSON string UUID). If your `derived_from` stored JSON numbers (integer IDs), the GIN containment won't match. See the schema README's ID Type Note for the fix.

**Issue: `trace_provenance` returns only the root node**
Solution: The root thought has `derived_from = NULL` or an empty array. That means it's a primary (atomic) thought, which is correct — primaries have no ancestors. Confirm with `SELECT derived_from, derivation_layer FROM thoughts WHERE id = '<uuid>';`.

**Issue: OpenRouter returns 401 / 402**
Solution: Check that `OPENROUTER_API_KEY` is exported in the shell running `eval.mjs`. 402 means your account is out of credits. Use `--grader stdin` or `--grader queue` as a free fallback.

## FAQ

**Q: Does this replace metadata-based provenance like `metadata.sources_seen`?**
A: No — they serve different purposes. `sources_seen` tracks *where a thought came in from* (Slack, email, etc). `derived_from` tracks *which thoughts were synthesized into this one*. Both can coexist on the same row.

**Q: What about sensitivity? Can a derived thought leak a restricted parent?**
A: `trace_provenance` redacts restricted ancestors (content → NULL, `restricted=true` flag set on the node). `find_derivatives` hardcodes the restricted filter at the SQL layer — the MCP tool exposes no caller-visible override. If you need an admin path that returns restricted rows, wire a separate service-role-only RPC in a private recipe. Sensitivity is enforced at the SQL layer, not just the MCP layer.

**Q: Why JSONB array instead of a `thought_parents` join table?**
A: One row per derived thought is simpler for the common query pattern (walk upward) and for recipes to write. The GIN index makes reverse lookup (`derived_from @> '[...]'`) fast enough for the sizes Open Brain targets (100K–1M thoughts). Swap to a join table later if provenance becomes a hot UI path.

**Q: How does this interact with `upsert_thought` deduplication?**
A: `upsert_thought` deduplicates by `content_fingerprint`. If you re-capture a derived artifact with the same content, the fingerprint matches the existing row and no new thought is created. If you want to track "this digest regenerated on a new day" as a fresh row, change the content (e.g., prepend a timestamp) and set `supersedes` to the prior row's ID.
