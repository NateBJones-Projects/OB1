# MCP Server

This doc covers the Open Brain MCP server changes required for the OpenClaw native memory integration.

## What is different here

If you deploy the plain upstream server shape from old instructions, you will not get the full behavior this integration expects.

This integration expects the MCP server to provide:
- `search_thoughts`
- `capture_thought`
- `list_thoughts`
- `thought_stats`
- `delete_thought`

It also expects:
- ids returned in `structuredContent.items[]` for search/list
- human-readable text to stay clean
- delete by exact id

## Structured output contract

For `search_thoughts` and `list_thoughts`, `structuredContent.items[]` should contain at least:
- `id` — string UUID
- `content` — string
- `metadata` — object
- `created_at` — ISO 8601 string

Optional fields may include:
- `similarity` — number

## Source files

Use these server files from OB1:
- `server/index.ts`
- `server/deno.json`

If this PR is not merged yet, use the files from this contribution branch, not an older main-branch copy that lacks the integration changes.

## Auth modes and security

Supported patterns:
- key in URL
- bearer-style token in config

Use one mode, not both.

Security notes:
- do not paste long-lived keys into shell history unless you mean to keep them there
- prefer environment variables or your secret manager when possible
- be careful with logs, screenshots, and copied config files
- `--no-verify-jwt` is expected in this deployment pattern because access control is handled inside the function, but that makes your MCP access key handling more important

## Prerequisites

You need:
- a linked Supabase project
- the Supabase CLI
- the required secrets already set

Deploy command uses:

```bash
supabase functions deploy open-brain-mcp --no-verify-jwt
```

## Step 1: create the function

```bash
supabase functions new open-brain-mcp
```

## Step 2: use the correct server files

### If this PR is not merged yet

Use the files from this PR branch or a local checkout of this branch, because the older server shape will not include the MCP changes this extension expects.

Direct fetch example:

```bash
curl -o supabase/functions/open-brain-mcp/index.ts   https://raw.githubusercontent.com/NomLom/OB1/feat/openclaw-native-memory-docs/server/index.ts
curl -o supabase/functions/open-brain-mcp/deno.json   https://raw.githubusercontent.com/NomLom/OB1/feat/openclaw-native-memory-docs/server/deno.json
```

Local checkout example:

```bash
cp server/index.ts supabase/functions/open-brain-mcp/index.ts
cp server/deno.json supabase/functions/open-brain-mcp/deno.json
```

### After this PR is merged

Use the merged main-branch files:

```bash
curl -o supabase/functions/open-brain-mcp/index.ts   https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/server/index.ts
curl -o supabase/functions/open-brain-mcp/deno.json   https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/server/deno.json
```

## Step 3: deploy

```bash
supabase functions deploy open-brain-mcp --no-verify-jwt
```

## Step 4: validate tool list

```bash
curl -s -X POST 'https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=MCP_KEY' \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expected tools include:
- `search_thoughts`
- `capture_thought`
- `list_thoughts`
- `thought_stats`
- `delete_thought`

## Step 5: validate search output shape

```bash
curl -s -X POST 'https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=MCP_KEY' \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_thoughts","arguments":{"query":"where NomLom lives","limit":1}}}'
```

Expected shape:

```json
{
  "result": {
    "content": [
      { "type": "text", "text": "Found 1 thought(s): ..." }
    ],
    "structuredContent": {
      "items": [
        {
          "id": "UUID_HERE",
          "content": "NomLom is in Cambridge, UK.",
          "metadata": { "type": "observation" },
          "created_at": "2026-03-21T17:34:28.670935+00:00",
          "similarity": 0.57
        }
      ]
    }
  }
}
```

## Step 6: validate list output shape

```bash
curl -s -X POST 'https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=MCP_KEY' \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_thoughts","arguments":{"limit":1}}}'
```

Expected shape:

```json
{
  "result": {
    "content": [
      { "type": "text", "text": "1 recent thought(s): ..." }
    ],
    "structuredContent": {
      "items": [
        {
          "id": "UUID_HERE",
          "content": "example content",
          "metadata": { "type": "observation" },
          "created_at": "2026-03-21T17:34:28.670935+00:00"
        }
      ]
    }
  }
}
```

## Step 7: validate thought_stats

```bash
curl -s -X POST 'https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=MCP_KEY' \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"thought_stats","arguments":{}}}'
```

Expected result: a successful text response summarising totals and breakdowns.

## Step 8: validate delete by id

Capture a row:

```bash
curl -s -X POST 'https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=MCP_KEY' \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"capture_thought","arguments":{"content":"smoke test delete by id"}}}'
```

Search for it and copy the returned id from `structuredContent.items[]`, then delete it:

```bash
curl -s -X POST 'https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=MCP_KEY' \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"delete_thought","arguments":{"id":"UUID_HERE"}}}'
```

Expected response:

```json
{
  "result": {
    "content": [
      { "type": "text", "text": "Deleted 1 thought(s)" }
    ]
  }
}
```

## Done when

You are done when:
- the function deploys cleanly
- tool list includes `delete_thought`
- search/list return ids in structured output
- delete by id works
