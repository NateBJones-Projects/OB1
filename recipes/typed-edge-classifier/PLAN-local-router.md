# Plan: let the typed-edge classifier use any OpenAI-compatible endpoint

Branch `typed-edges`. Scope: `recipes/typed-edge-classifier/` only.
This file is the brief for the session doing the work; delete it in the final commit.

## Problem

`classify-edges.mjs` hardcodes two endpoints:

- `https://api.anthropic.com/v1/messages` in `callAnthropicDirectOnce` (about line 493)
- `https://openrouter.ai/api/v1/chat/completions` in `callOpenRouterOnce` (about line 531)

`loadEnv()` picks the provider from whichever key is set (`LLM_PROVIDER` becomes
`openrouter` or `anthropic`). There is no way to point the recipe at a self-hosted
router. The sibling recipes `entity-wiki/generate-wiki.mjs` and
`wiki-synthesis/synthesize-wiki.mjs` already honour `LLM_BASE_URL`, `LLM_API_KEY`
and `LLM_MODEL` (defaulting to OpenRouter). This recipe is the odd one out, so a
deployment that runs the whole `wiki-compiler` pipeline against a local router
has to pass `--skip-edges` and lose the typed relations.

## Goal

Adopt the sibling recipes' convention, fully backward compatible:

- `LLM_BASE_URL` (default `https://openrouter.ai/api/v1`): base of an
  OpenAI-compatible chat-completions API. The OpenRouter path becomes the generic
  path and posts to `${LLM_BASE_URL}/chat/completions`.
- `LLM_API_KEY`: bearer token for that endpoint. Falls back to `OPENROUTER_API_KEY`.
- `ANTHROPIC_BASE_URL` (default `https://api.anthropic.com`): base for the direct
  Anthropic path, kept so `ANTHROPIC_API_KEY` users see no change.
- `LLM_PROVIDER`: still auto-detected from the keys; may also be set explicitly.
  Setting `LLM_BASE_URL` or `LLM_API_KEY` selects the generic path.
- `--model`, `--filter-model`, `--classify-model`: unchanged. `resolveModel()` must
  only prefix bare names with `anthropic/` when the base URL host is `openrouter.ai`.
  A self-hosted router uses its own aliases and must receive them untouched.
- Cost estimation: a model missing from the pricing table (a router alias) must
  not throw. Treat it as $0 with a single notice line; `--max-usd` keeps working.

## Constraints

- Zero behaviour change when none of the new variables are set. Every existing
  README example must still work as written.
- No new dependencies; Node 18+ `fetch` only.
- Keep the shared retry policy (`callAnthropic` wrapper) for both paths.
- Do not touch the other recipes.

## Tests

The recipe has none. Add `recipes/typed-edge-classifier/test/` using `node:test`
(run with `node --test recipes/typed-edge-classifier/test/`):

- a tiny `http` server that serves `/chat/completions` and `/v1/messages`; assert
  the URL, auth header and payload shape reached for each provider and base-URL
  combination, and that with `LLM_BASE_URL` set neither public host is contacted;
- `resolveModel` prefixing rules (OpenRouter host prefixes, any other host does not);
- `loadEnv` precedence (`LLM_API_KEY` over `OPENROUTER_API_KEY`; explicit
  `LLM_PROVIDER` over detection);
- unknown-model pricing does not throw.

To make the helpers importable, guard `main()` behind an `import.meta.url`
entry-point check. CLI behaviour must not change.

## Docs

- README: a "Self-hosted or OpenAI-compatible router" section with the env block,
  the prefixing rule, and the note that `--filter-model` / `--classify-model` take
  router aliases. Add an `LLM_BASE_URL` row to the credential tracker.
- `metadata.json` if it enumerates env vars.

## Definition of done

- New tests pass; `node classify-edges.mjs --help` is unchanged apart from the new
  env documentation.
- Three commits: code, tests, docs. Delete this file in the docs commit.
- Push the branch to the fork. Do not open the upstream pull request; the
  operator opens it after review.

## Out of scope

- Whether any deployment turns typed edges on. That is decided by the operator
  after real data, not by this change.
- The `wiki-compiler` `--skip-edges` default.
