# Entity Wiki Pages

> ⚠️ **Requires the entity-extraction companion PRs — not yet merged into OB1 `main`.** This recipe reads `public.entities`, `public.thought_entities`, and `public.edges`. Those tables are introduced by the in-flight entity-extraction schema + worker PRs (tracking: [#197](https://github.com/NateBJones-Projects/OB1/pull/197) schema, [#199](https://github.com/NateBJones-Projects/OB1/pull/199) worker). On the current `main` branch those tables do not exist and every query in `generate-wiki.mjs` will fail with `relation "public.entities" does not exist`. Do not try to install this recipe until both companion PRs are merged. See [Prerequisites](#prerequisites) for details.

> Auto-generate per-entity markdown wiki pages by aggregating every thought linked to a person, project, topic, organization, tool, or place — then synthesizing a structured narrative with an LLM.

## What It Does

Turns your scattered atomic thoughts about "Alan" or "ExoCortex" or "PostgreSQL" into a coherent wiki page. For each entity in your knowledge graph, this recipe:

1. Gathers every linked thought (via `thought_entities`) plus typed edges to other entities (via `edges`, skipping raw co-mention noise).
2. Optionally expands with semantic search if you enable embeddings.
3. Calls any OpenAI-compatible Chat Completions endpoint (OpenRouter by default) to synthesize a Summary / Key Facts / Timeline / Relationships / Open Questions page.
4. Emits the result to disk, to `entities.metadata.wiki_page`, or back into the thought store as a `dossier`-typed thought — your choice.

The wiki is an **emergent, regenerable view** of atomic state. `public.thoughts` remains the source of truth; wikis are cached snapshots you can rebuild anytime.

Inspired by [Andrej Karpathy's LLM Wiki concept](https://github.com/karpathy/llm-wiki) and the ExoCortex dossier pattern.

## How It Works

```
+--------------------+    +-------------------+    +------------------+
| entities           |--->| thought_entities  |--->| thoughts         |
| (id, canonical_... |    | (thought_id,      |    | (id, content,    |
|  aliases, type)    |    |  entity_id, role) |    |  metadata)       |
+--------------------+    +-------------------+    +------------------+
         |                                                   |
         | typed edges (excl. co_occurs_with)                |
         v                                                   v
   +-----------+                                    +----------------+
   | edges     |        +--------+                  | LLM synthesis  |
   | (from, to,|------->| Script |----------------->| (Chat          |
   |  relation)|        |        |                  | Completions)   |
   +-----------+        +--------+                  +----------------+
                            |                                |
                            v                                v
                    +-------+-----------------------------+--+
                    v                v                      v
              wikis/{slug}.md   entities.metadata    dossier thought
              (default)         .wiki_page            (trade-off!)
```

The script groups typed edges by relation, truncates thought content to 300 chars per snippet, caps the prompt at ~25 linked + ~15 semantic items (configurable), and asks the model to cite thought ids inline. Sections with no material are skipped rather than filled with boilerplate.

## Prerequisites

> [!WARNING]
> **Schema prereq not yet in OB1 `main`.** The `schemas/entity-extraction/` schema and the `integrations/entity-extraction-worker/` edge function referenced below are in-flight PRs, not merged code. Paths like `../../schemas/entity-extraction/` will 404 on GitHub today. This recipe will not run until both companion PRs land. Track: schema PR [#197](https://github.com/NateBJones-Projects/OB1/pull/197), worker PR [#199](https://github.com/NateBJones-Projects/OB1/pull/199).

- A working Open Brain setup ([guide](../../docs/01-getting-started.md)).
- The `schemas/entity-extraction/` schema deployed, and the companion `integrations/entity-extraction-worker/` edge function processing the queue. This recipe reads `public.entities`, `public.edges`, and `public.thought_entities` — if those tables are empty, there is nothing to synthesize. Let the worker ingest your thoughts for at least one run before you try this.
- An API key for any OpenAI-compatible Chat Completions provider (OpenRouter, OpenAI, Groq, Together, Anthropic via OpenRouter, a local Ollama/LM Studio server — anything that accepts `POST /chat/completions`).
- Node.js 18+ (uses built-in `fetch`).

> [!NOTE]
> This recipe does **not** require the `recipes/ob-graph/` manual graph layer. It uses the automatic extraction tables from the (pending) `schemas/entity-extraction/` PR. The two are independent.

## Credential Tracker

```text
ENTITY-WIKI -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL (OPEN_BRAIN_URL):          ____________
  Service role key (OPEN_BRAIN_SERVICE_KEY): ____________

LLM PROVIDER
  LLM_BASE_URL (default: openrouter.ai): ____________
  LLM_API_KEY:                           ____________
  LLM_MODEL (default: claude-haiku-4-5): ____________

REQUIRED WHEN --output-mode=thought OR --semantic-expand
  EMBEDDING_BASE_URL (default: openai):  ____________
  EMBEDDING_API_KEY:                     ____________
  EMBEDDING_MODEL (default: text-embedding-3-small): ____________

--------------------------------------
```

> [!CAUTION]
> `OPEN_BRAIN_SERVICE_KEY` is the Supabase **service role** key. It bypasses RLS. Keep it server-side only. Never ship it to a browser, a mobile client, or any environment an end user can inspect. This recipe is intended to run on your own machine or a trusted server.

## Installation

![Step 1](https://img.shields.io/badge/Step_1-Install_Files-1E88E5?style=for-the-badge)

No npm install needed — the script uses only Node.js built-ins. Just copy the recipe:

```bash
# From your Open Brain project root:
cp -r recipes/entity-wiki ./entity-wiki
cd entity-wiki
```

Done when: `generate-wiki.mjs` is sitting next to a `.env.local` you will create in Step 2.

---

![Step 2](https://img.shields.io/badge/Step_2-Configure_Env-1E88E5?style=for-the-badge)

Create `.env.local` next to `generate-wiki.mjs` (or export the variables in your shell):

```bash
OPEN_BRAIN_URL=https://<your-project-ref>.supabase.co
OPEN_BRAIN_SERVICE_KEY=<service-role-key>
LLM_API_KEY=<your-openrouter-or-openai-key>
# Optional overrides:
# LLM_BASE_URL=https://api.openai.com/v1
# LLM_MODEL=gpt-4o-mini
# OB_WIKI_OUT_DIR=./wikis
```

Done when: `node generate-wiki.mjs --help` prints the usage block without errors.

---

![Step 3](https://img.shields.io/badge/Step_3-Verify_Graph_Has_Data-1E88E5?style=for-the-badge)

<details>
<summary><strong>SQL: Sanity-check entity + link counts</strong> (click to expand)</summary>

```sql
-- Run in Supabase SQL Editor
SELECT
  (SELECT count(*) FROM public.entities) AS entities,
  (SELECT count(*) FROM public.thought_entities) AS thought_links,
  (SELECT count(*) FROM public.edges WHERE relation <> 'co_occurs_with') AS typed_edges;
```

</details>

If `entities` or `thought_links` is 0, wait for the entity-extraction worker to process your queue before running the recipe. See the pending `schemas/entity-extraction/` PR for worker setup (not yet on `main` — see warning at the top of this README).

Done when: all three counts are non-zero and at least one entity has 3+ linked thoughts.

## Usage Examples

**Single entity by name:**

```bash
node generate-wiki.mjs --entity "Alan Shurafa"
# Writes ./wikis/person-alan-shurafa.md
```

**Disambiguate by type** (useful when "Python" is both a tool and a topic):

```bash
node generate-wiki.mjs --entity "Python" --type tool
```

**Single entity by id** (BIGINT — not the UUID thought id):

```bash
node generate-wiki.mjs --id 42
```

**Dry-run** — print to stdout without writing anything:

```bash
node generate-wiki.mjs --entity "ExoCortex" --dry-run
```

**Batch mode** — generate pages for every entity with 3+ linked thoughts, capped at 25 entities per run:

```bash
node generate-wiki.mjs --batch --batch-min-linked 3 --batch-limit 25
```

**Choose an output mode:**

```bash
# Default: write to ./wikis/<slug>.md
node generate-wiki.mjs --entity "PostgreSQL" --output-mode file

# Cache under entities.metadata.wiki_page — no filesystem, queryable via SQL
node generate-wiki.mjs --entity "PostgreSQL" --output-mode entity-metadata

# Store as a dossier thought — REQUIRES EMBEDDING_API_KEY so the dossier is
# retrievable via match_thoughts / MCP search. Without an embedding the row
# is unreachable, so the CLI refuses to run if the key is missing. READ THE
# TRADE-OFFS SECTION BELOW before using this mode.
node generate-wiki.mjs --entity "PostgreSQL" --output-mode thought
```

**Enable semantic expansion** (requires `EMBEDDING_API_KEY`):

```bash
node generate-wiki.mjs --entity "ExoCortex" --semantic-expand
```

**Override the model per run:**

```bash
node generate-wiki.mjs --entity "Alan" --model "openai/gpt-4o-mini"
```

Run `node generate-wiki.mjs --help` for the full flag list.

## Output Mode Trade-offs

Pick the mode that matches how you plan to consume the wikis. Each has its own cost.

| Mode | Where it lives | Pros | Cons |
|------|----------------|------|------|
| `file` (default) | `./wikis/<slug>.md` | Human-readable, git-versionable, Obsidian-compatible, zero DB writes | Not queryable from SQL or MCP tools; lives outside the brain. Slug is derived from `canonical_name` with non-alphanumerics stripped, so distinct entities like `C`, `C#`, and `C++` share a base slug — the writer appends `-1`, `-2`, ... to avoid overwrites (and logs a warning). Re-running for the same entity id still overwrites its own file. |
| `entity-metadata` | `entities.metadata.wiki_page` JSONB | Queryable via SQL, travels with the entity, no new rows | Not searchable via embeddings, not picked up by `search_thoughts` |
| `thought` | A new row in `public.thoughts` with `metadata.type = 'dossier'` | Retrievable via normal search / MCP tools, full provenance back to the atoms it summarizes | **Requires `EMBEDDING_API_KEY`** (the dossier is embedded at write time so match_thoughts can find it). **Can pollute semantic search** — a long dossier that restates 20 atoms will match many queries and rank above the atoms themselves |

> [!WARNING]
> **Thought-mode pollution trade-off.** Storing the wiki back as a thought makes it show up in every search that touches the entity. Karpathy's original design argument against this is valid: a compressed summary that repeats 20 atomic facts will match any query that would have matched any of them, and because it's longer and more "on-topic" it often ranks above the atoms. That's good for "tell me about X" queries but bad for "what did I say on 2026-03-02 about X" queries.
>
> This recipe mitigates by tagging thought-mode output with `metadata.type = 'dossier'`, `metadata.generated_by`, and `metadata.exclude_from_default_search = true`. To keep your search clean, add a filter like `metadata->>'type' <> 'dossier'` in your default search view and only include dossiers when the user explicitly asks for them. The mitigation is a convention, not an enforcement — you have to wire the filter on the read side.
>
> If you are unsure, start with `file` or `entity-metadata` mode. You can always regenerate.

## Cost Notes

Each wiki is **one** LLM call. Input size scales with the number of linked + semantic snippets sent (capped at `--max-linked` + `--max-semantic`, default 25 + 15, each truncated to 300 chars). A typical page uses roughly 2–6k input tokens and produces up to 2048 output tokens.

At OpenRouter pricing for `anthropic/claude-haiku-4-5` (~$0.80 per million input, ~$4 per million output), a single wiki costs roughly **$0.01–$0.02**. A batch of 25 entities runs around **$0.25–$0.50**. Substitute `openai/gpt-4o-mini` or a local Ollama model to drop that by 10x or more.

Bounding behavior:

- `--batch-limit` caps the number of entities processed per batch run (default 25). The script stops after this many candidates, regardless of how many eligible entities exist.
- `--batch-min-linked` skips entities with fewer than N linked thoughts — prevents burning LLM calls on entities that will produce thin pages.
- `--max-linked` and `--max-semantic` bound per-call token usage.
- Entities with zero linked thoughts, zero typed edges, and zero semantic matches are skipped without an LLM call.

If you run this on a cron, start with `--batch-limit 10` for a week, measure your actual spend, then raise.

## Troubleshooting

**Issue: `Missing required env var: OPEN_BRAIN_URL`**
The script looks for `.env.local` or `.env` in the current working directory, then falls back to the process environment. Either `cd` into the recipe folder before running, or export the vars in your shell.

**Issue: `no entity found for name="..."`**
`--entity` resolves against `canonical_name` (case-insensitive) and `normalized_name` (exact) only — **alias matching is not implemented** (encoding JSONB `cs` inside a PostgREST `or=(...)` clause is brittle across versions). If your entity is reachable only by alias, find its id in SQL and rerun with `--id`. Try:

```sql
SELECT id, entity_type, canonical_name, aliases
FROM public.entities
WHERE normalized_name ILIKE '%yourname%'
ORDER BY last_seen_at DESC
LIMIT 10;
```

Then rerun with `--id <N>` against the exact id.

**Issue: Wiki only has a Summary — Timeline and Relationships are empty**
The entity has few linked thoughts or all its edges are `co_occurs_with` (which this recipe filters out as noise). Give the entity-extraction worker more content to process, or lower the `--max-linked` cap to force the model to use what little it has.

**Issue: Batch mode is slow on a large brain**

> [!WARNING]
> `listBatchCandidates` runs a serial `thought_entities` count per candidate entity (up to `max(batch_limit * 4, 100)` requests) before the first LLM call. On brains with a few thousand entities this adds tens of seconds of startup latency; on 10k+ brains it dominates the run and scales linearly with `--batch-limit`. A drop-in RPC workaround is below. A follow-up recipe PR will ship this RPC by default once the entity-extraction schema lands.

`listBatchCandidates` does a best-effort per-entity count because PostgREST does not expose `GROUP BY` directly. For brains with 10k+ entities, add an RPC like the following and swap it in:

<details>
<summary><strong>SQL: Optional batch-candidates RPC</strong> (click to expand)</summary>

```sql
CREATE OR REPLACE FUNCTION public.entities_with_min_links(min_links int, lim int)
RETURNS TABLE (id bigint, entity_type text, canonical_name text, link_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT e.id, e.entity_type, e.canonical_name, count(te.thought_id) AS link_count
  FROM public.entities e
  JOIN public.thought_entities te ON te.entity_id = e.id
  GROUP BY e.id
  HAVING count(te.thought_id) >= min_links
  ORDER BY link_count DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION public.entities_with_min_links(int, int) TO service_role;
```

</details>

**Issue: LLM returns empty or malformed markdown**
Some smaller models ignore structural instructions. Try a more capable model (`--model "anthropic/claude-haiku-4-5"` or `--model "openai/gpt-4o-mini"`). If you are running a local Ollama model, pick one with strong instruction-following (`llama3.1:70b`, `qwen2.5:32b`).

**Issue: `LLM call failed: 401`**
`LLM_API_KEY` is missing or wrong. For OpenRouter, the key starts with `sk-or-...`. For OpenAI, `sk-...`. For a local Ollama server, any non-empty string works and you should set `LLM_BASE_URL=http://localhost:11434/v1`.

**Issue: `permission denied for table entities` (or similar)**
`OPEN_BRAIN_SERVICE_KEY` must be the **service role** key, not the anon key. Regenerate it from Supabase Dashboard → Settings → API if in doubt.
