# OB1 Local HTTP

Skill pack that lets Claude Code (or any skill-aware AI coding tool) capture and search thoughts against a self-hosted Open Brain over plain HTTPS, with no MCP transport involved. Pairs with the [`local-brain-no-mcp`](../../recipes/local-brain-no-mcp/) recipe.

## What it does

Tells the AI coding tool, in `SKILL.md`, how to:

1. Recognize when the user wants to capture, search, or browse thoughts.
2. Translate those intents into authenticated HTTP calls (`curl`) against the LAN-resident Open Brain stack.
3. Surface results, score-ordered for searches, time-ordered for browses, and confirmation-ids for captures.

No MCP server is started, registered, or referenced. The skill is pure bash-via-curl.

## Prerequisites

- The [`local-brain-no-mcp`](../../recipes/local-brain-no-mcp/) recipe deployed on a host reachable from this dev host on the local network.
- Claude Code (or a compatible skill-aware AI tool) installed on this dev host.
- `curl` installed (default on every Linux and macOS).

## Setup

1. Get the brain host's URL and anon key. After the brain admin runs `setup.sh`, the values are printed at the bottom of that script's output -- and are also stored in `supabase-docker/docker/.env` on the brain host as `ANON_KEY` and the printed `BRAIN_HOST` + `KONG_HTTP_PORT`.

2. On this dev host, export both as environment variables (add them to your shell rc file so they persist):

   ```sh
   export BRAIN_URL="http://brain.local:8000"
   export BRAIN_ANON_KEY="eyJhbGciOi..."
   ```

3. Install the skill into your AI tool's skills directory. For Claude Code:

   ```sh
   mkdir -p ~/.claude/skills
   cp -r skills/ob1-local-http ~/.claude/skills/
   ```

   For other tools, copy the directory into wherever they read skills from.

4. Verify reachability:

   ```sh
   curl -fsS "$BRAIN_URL/functions/v1/list?limit=1" \
     -H "apikey: $BRAIN_ANON_KEY" \
     -H "Authorization: Bearer $BRAIN_ANON_KEY"
   ```

   Expected: HTTP 200 with `{"ok":true,"limit":1,"offset":0,"total":N,"results":[...]}`.

## Expected outcome

When asking Claude Code things like "remember that the Q3 sales review is on the 14th" or "what did I note about the Apex deal", the tool calls the brain over curl and confirms or returns matches, without ever invoking an MCP feature.

## Troubleshooting

- **Skill not picked up**: confirm Claude Code's skills directory and that `SKILL.md` is at `<skills-dir>/ob1-local-http/SKILL.md`.
- **`BRAIN_URL` or `BRAIN_ANON_KEY` not set**: re-source your shell rc or export them in the current shell.
- **HTTP 401/403**: the anon key is wrong or the brain host has been re-bootstrapped (which rotates keys). Re-export the new `ANON_KEY` from `supabase-docker/docker/.env`.
- **HTTP 502 with embedding errors**: see the failure modes section in `SKILL.md` -- usually an Ollama issue on the brain host, not on this dev host.
- **Network unreachable**: ping `<brain-host>` and check the brain host's firewall is open on `KONG_HTTP_PORT`.

## Why no MCP

This skill exists because some environments disable Claude Code's MCP feature entirely (corporate policy, locked-down build, restricted network). When MCP is unavailable, the canonical OB1 capture/search tools don't work. This skill is the documented HTTP-only fallback. See the recipe's README for the architectural rationale.
