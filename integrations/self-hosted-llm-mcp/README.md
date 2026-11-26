# Self-Hosted LLM MCP Server

> Open Brain's six MCP tools as a Supabase Edge Function that embeds and extracts metadata with a model server you run yourself, with no cloud AI account.

## What It Does

This integration serves the same six tools as the core Open Brain server (`capture_thought`, `search_thoughts`, `list_thoughts`, `thought_stats`, `search`, `fetch`), so your AI clients need no change beyond the connector address. Instead of calling OpenRouter, it sends embedding and metadata requests to any OpenAI-compatible server you choose, such as Ollama or vLLM. It never falls back to a cloud default: if a model setting is missing, every tool fails and names the setting.

It is for owners who already run a Supabase-backed Open Brain and want their model traffic to stay on their own hardware.

How it differs from [`../kubernetes-deployment/`](../kubernetes-deployment/): both offer the same six tools and can talk to a local model. That integration runs on Kubernetes with plain Postgres. This one is a Supabase Edge Function that uses your existing Supabase database, and it deploys the same way on Supabase Cloud and on a self-hosted Supabase stack.

It also adds a `GET .../setup-check` route that tests your configuration, so you can see what is wrong before you capture a thought.

## Prerequisites

- A working Open Brain setup with the `thoughts` table, `match_thoughts` and `upsert_thought` created at **1536 dimensions** ([guide](../../docs/01-getting-started.md))
- The [Supabase CLI](https://supabase.com/docs/guides/cli) (for Supabase Cloud deploys)
- An OpenAI-compatible model server with one embedding model and one chat model. See [Choosing an embedding model](#choosing-an-embedding-model).
- The model server must be reachable **from where the function runs**. A function on Supabase Cloud cannot reach `localhost` or a private network address on your machine. For Supabase Cloud, the server must be on the public internet over HTTPS behind an access key. See [Supabase Cloud reachability](#supabase-cloud-reachability).

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
SELF-HOSTED LLM MCP -- CREDENTIAL TRACKER
-----------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:             ____________
  Secret key:              ____________

MODEL SERVER
  Embedding API base:      ____________   (ends in /v1)
  Embedding API key:       ____________   (leave blank if none)
  Embedding model:         ____________
  Chat API base:           ____________   (leave blank to reuse the embedding base)
  Chat API key:            ____________   (leave blank if none)
  Chat model:              ____________

GENERATED DURING SETUP
  MCP access key:          ____________
  Function URL:            ____________
  MCP connection URL:      ____________   (function URL + ?key=your-access-key)

-----------------------------------------
```

Generate the MCP access key with `openssl rand -hex 32`.

## Configure

The function reads these settings from its environment on every request. Set them as function secrets (see the deploy steps below).

| Setting | Required | What it does |
|---------|----------|--------------|
| `EMBEDDING_API_BASE` | Yes | Base URL of the OpenAI-compatible server used for embeddings, for example `http://ollama:11434/v1`. Must start with `http://` or `https://`. |
| `EMBEDDING_API_KEY` | No | Access key sent as `Authorization: Bearer <key>` to the embedding server. Leave unset if the server needs none; no `Authorization` header is sent then. |
| `EMBEDDING_MODEL` | Yes | Embedding model name, for example `qwen3-embedding:4b`. It must be able to return 1536-dimension vectors. |
| `CHAT_API_BASE` | No | Base URL for the chat model used for metadata extraction. Falls back to `EMBEDDING_API_BASE`. |
| `CHAT_API_KEY` | No | Access key for the chat server. See the key rule below. |
| `CHAT_MODEL` | Yes | Chat model name, for example `qwen3:4b`. There is no fallback between the two model settings. |
| `FETCH_TIMEOUT_MS` | No | Milliseconds to wait for each model request. Default `60000`. |
| `MCP_ACCESS_KEY` | Yes | The key your MCP client sends in the `x-brain-key` header or the `?key=` query parameter. If it is unset, every request is refused. |

Rules to know:

- **Chat key rule.** `CHAT_API_KEY` falls back to `EMBEDDING_API_KEY` only when `CHAT_API_BASE` also falls back. If you point chat at a different server with `CHAT_API_BASE`, set `CHAT_API_KEY` yourself, or leave it unset for a server with no key. The embedding key is never sent to a different server.
- **Missing settings.** If `EMBEDDING_API_BASE`, `EMBEDDING_MODEL` or `CHAT_MODEL` is missing, every tool fails with a message naming each missing setting, and no request is sent to any model server. A base URL without `http://` or `https://` is treated the same way.
- **Strict timeout.** `FETCH_TIMEOUT_MS` must be a positive integer. A value such as `60s` or `0` is reported as a configuration error that fails every tool and the setup check. It does not silently fall back to the default.
- **Keep the timeout below 140000.** Both Supabase Cloud and a self-hosted stack stop a request after about 150 seconds. The setup check runs its model requests at the same time, so its worst case is about one timeout.
- **Shared environment.** On a self-hosted Supabase stack, every function in the stack sees the same environment, and Supabase Cloud secrets apply to the whole project. So one `FETCH_TIMEOUT_MS` also applies to any other Open Brain function you deploy in the same place that reads that name, such as `enhanced-mcp`. It means the same thing in each.
- **Key over http.** A key sent to an `http://` address travels unencrypted. The setup check warns about it. Use HTTPS for any endpoint that needs a key.

## Choosing an embedding model

Your Open Brain database stores 1536-dimension vectors. The function asks the model server for 1536 dimensions by sending `"dimensions": 1536` with each embedding request. A model must be able to produce that size, and the server must honor the field. If a server returns any other size, the function refuses to store the thought and names both sizes.

| Server | Status for this integration |
|--------|-----------------------------|
| **Ollama** 0.11.11 or newer | Candidate. Honors `dimensions` on `/v1/embeddings`. Pair it with `qwen3-embedding:4b`, which has a native size of 2560 and can be reduced to 1536. |
| **vLLM** | Fallback. Start it with `--hf-overrides '{"is_matryoshka": true}'` for `Qwen/Qwen3-Embedding-4B`. Without that flag, vLLM rejects the `dimensions` field. |
| **llama.cpp** (`llama-server`) | Not usable. It ignores `dimensions` and returns the model's native size. |
| **LM Studio** | Untested. Its documentation lists no parameters for embeddings. |

Smaller models do not work for this: `qwen3-embedding:0.6b` is native 1024 and cannot produce 1536. A model that natively returns 1536 dimensions also works.

These findings come from server documentation and source code, not from a live run. See the table below for what has been checked on real hardware.

### Tested with (known good, not a minimum)

This table records the environment where one embedding and chat setup was checked end to end. It describes a setup that worked once. It is not a list of minimum requirements.

| Item | Value |
|------|-------|
| Self-hosted Supabase version | pending verification |
| Supabase CLI version (Cloud deploys) | pending verification |
| Model server and version | pending verification |
| Embedding model and digest | pending verification |
| Chat model and tag | pending verification |
| Length of one embedding response with `dimensions: 1536` | pending verification |
| Machine RAM | pending verification |
| Machine GPU | pending verification |

## Steps

1. Pick and start your model server (see [Choosing an embedding model](#choosing-an-embedding-model)). With Ollama:

   ```bash
   ollama pull qwen3-embedding:4b
   ollama pull qwen3:4b
   ```

2. Fill in the [Credential Tracker](#credential-tracker).
3. Deploy the function, either to [Supabase Cloud](#deploy-to-supabase-cloud) or to [an existing self-hosted stack](#deploy-to-an-existing-self-hosted-stack).
4. If you deployed to Supabase Cloud, make the model server reachable ([Supabase Cloud reachability](#supabase-cloud-reachability)).
5. [Run the setup check](#run-the-setup-check) and fix anything it reports.
6. Add the connector to your AI client: Settings, Connectors, Add custom connector, and paste your MCP connection URL (the function URL followed by `?key=your-access-key`). The client lists the six tools.
7. Capture a thought, then search for it by its exact text and by a paraphrase.

### Deploy to Supabase Cloud

From the root of your Open Brain project, with the Supabase CLI logged in and linked to your project:

1. Copy this folder to `supabase/functions/self-hosted-llm-mcp/` in your project.
2. Deploy with JWT verification off. MCP clients send only the access key, not a Supabase token:

   ```bash
   supabase functions deploy self-hosted-llm-mcp --no-verify-jwt
   ```

3. Set the secrets. Use placeholder values from your tracker. Skip the `*_API_KEY` lines for a server with no key:

   ```bash
   supabase secrets set \
     MCP_ACCESS_KEY=your-access-key \
     EMBEDDING_API_BASE=https://models.example.com/v1 \
     EMBEDDING_API_KEY=your-model-key \
     EMBEDDING_MODEL=qwen3-embedding:4b \
     CHAT_MODEL=qwen3:4b
   ```

   Add `CHAT_API_BASE`, `CHAT_API_KEY` or `FETCH_TIMEOUT_MS` the same way if you need them. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function itself.
4. Your function URL is `https://<project-ref>.supabase.co/functions/v1/self-hosted-llm-mcp`.

### Deploy to an existing self-hosted stack

This applies to the official Supabase Docker Compose stack. The stack itself is not part of this integration.

1. Copy this folder to `docker/volumes/functions/self-hosted-llm-mcp/` in your Supabase stack.
2. Add the settings from the [Configure](#configure) table to the environment of the `functions` service in `docker-compose.yml` (or an override file). The router passes the container environment to every function, so there is no per-function setting. Then restart the service: `docker compose restart functions`.
3. Make sure `FUNCTIONS_VERIFY_JWT=false` in the stack's `.env`. That is the default. MCP clients send only the access key.
4. Your function URL is `http://<host>:8000/functions/v1/self-hosted-llm-mcp`.

Warning: JWT checking on the Compose stack is one setting for all functions. With `FUNCTIONS_VERIFY_JWT=false`, every function in that stack is reachable without a Supabase JWT, so each one must check its own credentials. The functions container also hands `SUPABASE_SERVICE_ROLE_KEY` to every function. If you need `FUNCTIONS_VERIFY_JWT=true` for other functions, the only option is a local edit to `volumes/functions/main/index.ts` that exempts this function by name. Supabase does not document that, and you must redo the edit after each stack update. This README gives no patch.

These files change often, so each link is pinned to a commit:

- [`docker-compose.yml`](https://github.com/supabase/supabase/blob/160f233b4e/docker/docker-compose.yml) (the `VERIFY_JWT` variable and its TODO)
- [`volumes/functions/main/index.ts`](https://github.com/supabase/supabase/blob/3580c144a4/docker/volumes/functions/main/index.ts) (the single `VERIFY_JWT` switch and the shared import map)
- [`volumes/api/kong.yml`](https://github.com/supabase/supabase/blob/1b5d89f78a/docker/volumes/api/kong.yml) (the `functions-v1` route, with no key requirement)

### Supabase Cloud reachability

A function on Supabase Cloud runs on the public internet. It can reach your model server only if that server is on the public internet over HTTPS, behind an access key enforced in front of it. This integration ships no tunnel tooling. The worked example below uses a reverse proxy that you run next to the model server. Any proxy or tunnel that serves HTTPS and rejects requests without the key works the same way.

Example with [Caddy](https://caddyserver.com/), Ollama on the same machine, and the placeholder host `models.example.com`:

1. Point a DNS record for `models.example.com` at the machine, and open ports 80 and 443 to it. Keep Ollama's own port (11434) closed to the internet.
2. Choose a model key, for example with `openssl rand -hex 32`. Write it in your tracker.
3. Put this in your Caddyfile. Caddy gets an HTTPS certificate for the host by itself. Requests without the exact header get a 401 and never reach Ollama:

   ```text
   models.example.com {
       @authorized header Authorization "Bearer your-model-key"
       handle @authorized {
           reverse_proxy localhost:11434 {
               header_up Host localhost:11434
           }
       }
       handle {
           respond "Unauthorized" 401
       }
   }
   ```

4. Reload Caddy, then test from another machine:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://models.example.com/v1/models
   curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer your-model-key" https://models.example.com/v1/models
   ```

   The first prints `401`. The second prints `200`.
5. Set the secrets so the function sends the same key:

   ```bash
   supabase secrets set \
     EMBEDDING_API_BASE=https://models.example.com/v1 \
     EMBEDDING_API_KEY=your-model-key
   ```

   If chat uses the same server, leave `CHAT_API_BASE` and `CHAT_API_KEY` unset so they inherit these values. If chat is on a different server, set `CHAT_API_BASE` and `CHAT_API_KEY` for it.
6. Run the setup check. The reachability checks should now pass.

The setup check cannot tell whether an unkeyed `http://` endpoint is exposed to the internet. Keeping the endpoint behind HTTPS and a key is your responsibility.

## Run the setup check

The setup check is an HTTP route on the function, not an MCP tool. Send the access key in the `x-brain-key` header. Prefer the header over the `?key=` query parameter, because query strings can end up in access logs.

```bash
curl -s -H "x-brain-key: your-access-key" \
  "https://<project-ref>.supabase.co/functions/v1/self-hosted-llm-mcp/setup-check"
```

On a self-hosted stack, use `http://<host>:8000/functions/v1/self-hosted-llm-mcp/setup-check`.

The response is JSON. Read the HTTP status and the `checks` list:

| Status | Meaning |
|--------|---------|
| 200 | `"ok": true`. Every check passed. Warnings do not change this. |
| 503 | At least one check failed. Read `checks` to see which. |
| 401 | The access key is missing or wrong. |
| 500 | The check itself crashed. The body reads `Setup check failed unexpectedly.` |
| 502 or 504 with no JSON body | The Supabase gateway answered, not the function. The function did not respond. |

Each entry in `checks` has an `id`, a `role` (`embedding` or `chat`) where it applies, `ok`, and a `reason` when it failed:

| Check id | What it tests |
|----------|---------------|
| `config` | All required settings are present and valid. When this fails, every other check is skipped and no request is sent to any model server. |
| `embedding_reachable`, `chat_reachable` | The server answers `GET <base>/models` with something other than 401 or 403. |
| `embedding_model`, `chat_model` | The model is listed by the server, or a real request to it succeeded. |
| `embedding_dimension` | A real embedding of a sample sentence returns exactly 1536 numbers. |
| `chat_metadata` | A real chat request returns usable metadata. |

Other fields:

- `warnings` lists problems that do not fail the check. `key_over_http` means a key is set for an `http://` endpoint.
- `thoughts.other_model` is how many stored thoughts were embedded by a different or unknown model. See [Switching an existing brain](#switching-an-existing-brain).
- `config` shows each role's base, model and whether a key is set. It never shows a key.

## Expected Outcome

- The setup check returns HTTP 200 with `"ok": true`, and `thoughts.other_model` is `0` on a new brain.
- Your AI client lists the six tools: `capture_thought`, `search_thoughts`, `list_thoughts`, `thought_stats`, `search` and `fetch`.
- Capturing a thought returns `Captured as <type> ...`. The stored thought carries `metadata.embedding_model` with your embedding model's name, and `metadata.enrichment_status` of `complete`.
- Searching for the thought's exact text returns it as the top result, and a paraphrase of it also returns it.
- Your model server's log shows `/v1/embeddings` and `/v1/chat/completions` requests, and no cloud AI account is involved.

## Troubleshooting

**Issue: A tool or the setup check says "Model endpoint not configured: missing ..."**
Solution: Set each setting the message names (see [Configure](#configure)). The same message appears for a base URL without `http://` or `https://` and for a `FETCH_TIMEOUT_MS` that is not a positive integer. On Supabase Cloud, new secrets apply after the next request. On a self-hosted stack, restart the `functions` service.

**Issue: The server could not be reached (`embedding_reachable` or `chat_reachable` fails, or a capture names the base URL as unreachable)**
Solution: Check from where the function runs, not from your laptop. On Supabase Cloud, the model server must be public over HTTPS behind a key; see [Supabase Cloud reachability](#supabase-cloud-reachability). On a self-hosted stack, use an address the `functions` container can resolve, such as a Compose service name. Nothing is stored when the embedding server is unreachable.

**Issue: The access key was rejected (HTTP 401 or 403 from the model server)**
Solution: The key in `EMBEDDING_API_KEY` or `CHAT_API_KEY` does not match what your proxy expects. Remember the chat key rule: a separate `CHAT_API_BASE` does not inherit the embedding key.

**Issue: Unknown model (`embedding_model` or `chat_model` fails, naming the model)**
Solution: The server does not have that model. Check the exact tag with `ollama list`, and pull it on the server (for example `ollama pull qwen3-embedding:4b`).

**Issue: Wrong vector size (`embedding_dimension` fails, or a capture says the model "returned N-dimension vectors; this brain stores 1536")**
Solution: Choose a model that can output 1536 dimensions on a server that honors `dimensions` (see [Choosing an embedding model](#choosing-an-embedding-model)). A 768-dimension model such as `nomic-embed-text` cannot work. llama.cpp ignores the field. vLLM needs `--hf-overrides '{"is_matryoshka": true}'` for Qwen3-Embedding. Nothing is stored until the size is right.

**Issue: The request timed out**
Solution: The model did not answer within `FETCH_TIMEOUT_MS` (60000 ms by default). The first request after idle time is slow because the server must load the model into memory. With Ollama, keep the models loaded by setting `keep_alive` (for example the `OLLAMA_KEEP_ALIVE=24h` environment variable) so later requests are fast. If your hardware is slow, raise `FETCH_TIMEOUT_MS`, and keep it below 140000. A timed-out embedding stores nothing. A timed-out chat request still saves the thought with default metadata.

**Issue: "Metadata extraction skipped: ..." appears after a capture, or `chat_metadata` fails**
Solution: The chat model returned something other than a JSON object, or failed. The thought was saved with its embedding and default metadata (`topics: ["uncategorized"]`, `type: "observation"`, `enrichment_status: "fallback"`). Search still works. Try a stronger chat model, or one that follows JSON instructions better. Capturing the same text again with chat working replaces the default metadata and sets the status back to `complete`.

**Issue: The setup check warns `key_over_http`**
Solution: A key is set for an endpoint that starts with `http://`, so the key travels unencrypted. Serve the endpoint over HTTPS, or remove the key if the server is on a trusted private network.

**Issue: "Embedding could not be saved: ... The thought was not kept; capture it again."**
Solution: The database rejected the embedding update. The function removed the row it had just created. Capture the thought again.

**Issue: "... This text was already in your brain; its metadata was updated but its embedding was not. Capture it again to repair."**
Solution: The same text was already saved. Its metadata was updated, but the new embedding was not written. Nothing was deleted. Capture the same text again. It reaches the same row and writes the embedding.

**Issue: "... The thought may be saved without its embedding; capture it again to repair."**
Solution: The database failed twice in a row, so the function could not tell what is stored. Capture the thought again. A retry reaches the same row and writes the embedding.

## Switching an existing brain

If your brain already holds thoughts embedded by a cloud model, such as `openai/text-embedding-3-small`, note the following:

- **Old embeddings are not comparable.** Embeddings from different models do not live in the same space. Until those thoughts are re-embedded, searches mix good and meaningless matches. This integration provides **no re-embedding tool**. A bulk re-embed belongs to a follow-up feature, or to upstream pull request #252 (which adds a re-embed command to `recipes/local-ollama-embeddings`). Until then, thoughts saved before the switch are not reliably searchable.
- **See how many are affected.** The setup check reports `thoughts.other_model`: the count of thoughts whose `metadata.embedding_model` is missing or different from your `EMBEDDING_MODEL`. Every thought captured through this integration records the model name.
- **Find thoughts saved with default metadata.** When the chat model fails, the thought is saved with default metadata and marked. List them in the Supabase SQL editor:

  ```sql
  select id, created_at
  from thoughts
  where metadata->>'enrichment_status' = 'fallback';
  ```

  Capturing the same text again with chat working restores real metadata and sets the status to `complete`.
- **Switching back.** Nothing about this integration changes your data layout. To go back, reconnect your AI client's connector to the core Open Brain server, or point both model roles here at a cloud endpoint that serves your original models. Thoughts captured through this integration keep their new embeddings, so they need re-embedding if you return to the old model.

## Tool Surface Area

> This integration exposes the same six MCP tools as the core server, so deploying it in place of the core server does not add tools. If you connect both, the tools appear twice. See the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) for strategies on managing your tool count as your Open Brain grows.
