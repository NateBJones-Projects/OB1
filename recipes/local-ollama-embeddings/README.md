# Local Embeddings via Ollama

> Generate embeddings locally and insert thoughts into Open Brain — no cloud API key needed.

## What It Does

Replaces the OpenRouter embedding step with a local Ollama model. You feed it text (stdin, file, or argument), it generates embeddings on your machine, and inserts the thoughts into your Supabase `thoughts` table. Zero API cost, full privacy, works offline.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- [Ollama](https://ollama.com) installed and running
- Python 3.10+

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
LOCAL OLLAMA EMBEDDINGS -- CREDENTIAL TRACKER
----------------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:           ____________
  Service role key:      ____________

GENERATED DURING SETUP
  Ollama model pulled:   ____________  (default: nomic-embed-text)

----------------------------------------------
```

## Steps

### 1. Install Ollama

Download from [ollama.com](https://ollama.com) and start it:

```bash
ollama serve
```

### 2. Pull an embedding model

The default model is **nomic-embed-text** — smallest pull, widest community support, and fast on any hardware:

```bash
ollama pull nomic-embed-text
```

**Tested models:**

All three models below were tested end-to-end: local Ollama embedding, live Supabase insertion, and `match_thoughts` semantic search verification.

| Model | Dimensions | Pull size | Best for |
|-------|-----------|-----------|----------|
| **nomic-embed-text** (default) | 768 | ~275 MB | Fastest setup, lowest resource use |
| **mxbai-embed-large** | 1024 | ~670 MB | Best retrieval quality |
| **rjmalagon/gte-qwen2-1.5b-instruct-embed-f16** | **1536** | ~3.2 GB | **Drop-in compatible** with default Open Brain schema (no ALTER needed) |

**Quality comparison:**

Tested with 4 text pairs (similar, unrelated, paraphrase, topically related). Gap = similar score minus unrelated score. Higher gap = better at distinguishing relevant from irrelevant results.

| Model | Dims | Speed | Gap | Notes |
|-------|:---:|:---:|:---:|-------|
| nomic-embed-text | 768 | 0.4s | 0.222 | Fastest, but weaker at filtering irrelevant results |
| **mxbai-embed-large** | 1024 | 0.4s | **0.587** | Best discrimination between related and unrelated |
| gte-qwen2 (1536) | 1536 | 1.9s | 0.492 | Strong discrimination, no schema change needed |

### Schema compatibility

The default Open Brain schema uses `vector(1536)` (matching OpenAI's `text-embedding-3-small`). If you use `rjmalagon/gte-qwen2-1.5b-instruct-embed-f16`, **no schema change is needed** — embeddings are directly compatible with the default `thoughts` table.

For nomic-embed-text or mxbai-embed-large, adjust your Supabase schema to match the model's dimensions:

```sql
-- For nomic-embed-text (768-dim):
ALTER TABLE thoughts ALTER COLUMN embedding TYPE vector(768);

-- For mxbai-embed-large (1024-dim):
ALTER TABLE thoughts ALTER COLUMN embedding TYPE vector(1024);
```

You will also need to recreate the `match_thoughts` function with the matching dimension. See the [getting started guide](../../docs/01-getting-started.md) for the function definition and replace `vector(1536)` with your model's dimension.

> **Note:** `rjmalagon/gte-qwen2-1.5b-instruct-embed-f16` is a community-published model (a quantized version of Alibaba's GTE-Qwen2-1.5B-instruct). It is not published by an official organization on Ollama. If you prefer an officially published model, use nomic-embed-text or mxbai-embed-large and adjust your schema accordingly.
>
> **Important:** Do **not** mix embeddings from different models in the same similarity search. Embeddings from different models occupy different semantic spaces — cosine similarity between them is meaningless, even if the dimensions happen to match. If you switch models, re-embed your entire corpus.

### 3. Clone and install

```bash
cd recipes/local-ollama-embeddings
pip install -r requirements.txt
```

### 4. Configure environment

```bash
cp .env.example .env
# Edit .env with your Supabase credentials
set -a
source .env
set +a
```

### 5. Embed a thought

**From a string argument:**

```bash
python embed-local.py "The key insight from today's meeting was that we need to ship the MVP before expanding the feature set."
```

**From stdin (pipe from another tool):**

```bash
echo "My important thought" | python embed-local.py
```

**From a text file (one thought per line):**

```bash
python embed-local.py --file my-thoughts.txt
```

**From a JSONL file (structured input):**

```bash
python embed-local.py --file thoughts.jsonl
```

JSONL format:

```json
{"content": "The thought text", "source": "journal", "metadata": {"project": "acme"}}
{"content": "Another thought", "source": "meeting-notes"}
```

### 6. Dry run first

Always test before live insertion:

```bash
python embed-local.py --file my-thoughts.txt --dry-run --verbose
```

This generates embeddings (confirming Ollama works) but skips the Supabase insert.

## Expected Outcome

After running against your Supabase instance, you should see:

```
Open Brain — Local Ollama Embeddings
  Mode:     LIVE
  Model:    nomic-embed-text (768-dim)
  Ollama:   http://localhost:11434
  Source:   ollama-local
  Thoughts: 3

1/3: The key insight from today's meeting was that we need to ship the MVP...
   -> Ingested
2/3: Our north star metric is weekly active users, not signups.
   -> Ingested
3/3: Decision: use Postgres RLS instead of application-level auth checks.
   -> Ingested

--------------------------------------------------
Summary:
  Input:     3 thoughts
  Embedded:  3
  Ingested:  3
  Errors:    0
  API cost:  $0.00 (local)
--------------------------------------------------
```

Verify in Supabase:

```sql
SELECT content, metadata->>'source' as source, metadata->>'embedding_model' as model
FROM thoughts
WHERE metadata->>'source' = 'ollama-local'
ORDER BY created_at DESC
LIMIT 10;
```

## Using With Other Recipes

This recipe works as a drop-in embedding replacement for any capture flow. Pipe output from other tools:

```bash
# Pipe from a custom extraction script
python my-extractor.py | python embed-local.py --source my-extractor

# Embed from a file another recipe produced
python embed-local.py --file extracted-thoughts.txt --source chatgpt-import
```

## Troubleshooting

**Issue: "Cannot reach Ollama at http://localhost:11434"**
Solution: Start Ollama with `ollama serve`. If you're running Ollama on a different host or port, use `--ollama-url` or set `OLLAMA_BASE_URL`.

**Issue: "Ollama embedding failed (404)"**
Solution: The model isn't pulled yet. Run `ollama pull nomic-embed-text` (or whichever model you're using).

**Issue: Supabase returns a dimension mismatch error**
Solution: Your embedding model's output dimension doesn't match your `thoughts` table. Alter your column to match (see the model table in Step 2). Back up first.

**Issue: Embeddings are slow**
Solution: First run for a model is slow (loading into memory). Subsequent calls are fast. If consistently slow, check that Ollama isn't competing for RAM with other processes. GPU acceleration (if available) speeds things up significantly.

**Issue: "requests" import error**
Solution: `pip install -r requirements.txt`
