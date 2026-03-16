# Extension Generator Spec

This document is a machine-readable specification for generating new Open Brain extensions. An AI agent given this spec and a description of the desired extension should be able to produce all required files in a single pass.

## Required Output Files

Every extension produces exactly 5 files in `extensions/{extension-slug}/`:

| File | Purpose |
|------|---------|
| `README.md` | Human-readable setup guide (follows template below) |
| `metadata.json` | Machine-readable metadata (follows schema below) |
| `schema.sql` | PostgreSQL tables, indexes, RLS policies |
| `index.ts` | Supabase Edge Function — the MCP server |
| `deno.json` | Deno import map for the Edge Function |

---

## File 1: deno.json

This file is **identical for every extension** unless the extension needs additional dependencies. Start with this exact content:

```json
{
  "imports": {
    "@hono/mcp": "npm:@hono/mcp@0.1.1",
    "@modelcontextprotocol/sdk": "npm:@modelcontextprotocol/sdk@1.24.3",
    "hono": "npm:hono@4.9.2",
    "zod": "npm:zod@4.1.13",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2.47.10"
  }
}
```

Only add entries if the extension imports something not listed here.

---

## File 2: metadata.json

Must validate against `/.github/metadata.schema.json`. Required fields:

```json
{
  "name": "Human-Readable Extension Name",
  "description": "One sentence. What capability does this add?",
  "category": "extensions",
  "author": {
    "name": "Author Name",
    "github": "github-username"
  },
  "version": "1.0.0",
  "requires": {
    "open_brain": true,
    "services": [],
    "tools": ["Supabase CLI"]
  },
  "requires_primitives": ["deploy-edge-function", "remote-mcp"],
  "learning_order": null,
  "tags": ["at-least-one-tag"],
  "difficulty": "beginner | intermediate | advanced",
  "estimated_time": "30 minutes"
}
```

Rules:
- `requires_primitives` always includes `deploy-edge-function` and `remote-mcp`. Add others (e.g., `rls`, `shared-mcp`) only if the extension teaches those concepts.
- `learning_order` is only set for curated learning path extensions (1-6). Community extensions omit it.
- `services` lists external APIs beyond Supabase/OpenRouter (e.g., `["Gmail API"]`).
- `tags` should include the extension's domain and difficulty-related terms.

---

## File 3: schema.sql

PostgreSQL DDL that runs in the Supabase SQL Editor. Must follow these rules:

1. **Every table must have:**
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL`
   - `created_at TIMESTAMPTZ DEFAULT now() NOT NULL`

2. **Use `CREATE TABLE IF NOT EXISTS`** — safe to re-run.

3. **Include indexes** for columns that will be queried frequently (user_id + any filter columns).

4. **Include Row Level Security:**
   ```sql
   ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

   CREATE POLICY table_name_user_policy ON table_name
       FOR ALL
       USING (auth.uid() = user_id)
       WITH CHECK (auth.uid() = user_id);
   ```

5. **Never modify the core `thoughts` table.** Adding new tables is fine. Referencing `thoughts` via foreign key is fine. Altering or dropping `thoughts` columns is not.

6. **No `DROP TABLE`, `TRUNCATE`, or unqualified `DELETE FROM`.**

7. **Use JSONB for flexible metadata fields** where the structure might vary (e.g., `details JSONB DEFAULT '{}'`).

8. **Add update triggers** if the table has `updated_at`:
   ```sql
   CREATE OR REPLACE FUNCTION update_updated_at_column()
   RETURNS TRIGGER AS $$
   BEGIN
       NEW.updated_at = now();
       RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;
   ```

---

## File 4: index.ts

Supabase Edge Function that implements an MCP server. Must follow this exact structure:

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// --- Environment Variables ---
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- MCP Server ---
const server = new McpServer({
  name: "extension-slug",
  version: "1.0.0",
});

// --- Tools ---
// Register tools here using server.registerTool()

// --- Hono App with Auth ---
const app = new Hono();

app.all("*", async (c) => {
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401);
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
```

### Tool Registration Pattern

Every tool follows this pattern:

```typescript
server.registerTool(
  "tool_name",
  {
    title: "Human-Readable Tool Name",
    description: "When should the AI use this tool? Be specific about triggers.",
    inputSchema: {
      param_name: z.string().describe("What this parameter is for"),
      optional_param: z.number().optional().default(10),
    },
  },
  async ({ param_name, optional_param }) => {
    try {
      // Supabase query here
      const { data, error } = await supabase
        .from("table_name")
        .select("*")
        .eq("user_id", "USER_ID"); // See note below about user_id

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: `Result: ${JSON.stringify(data)}` }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);
```

### Tool Design Rules

1. **Every tool must return `{ content: [{ type: "text" as const, text: string }] }`**. Never return raw strings.
2. **Every tool must have a try/catch** that returns `isError: true` on failure.
3. **Tool descriptions should describe WHEN to use the tool**, not what it does technically. The AI reads these to decide which tool to call.
4. **Use Zod for input validation.** Every parameter needs `.describe()` for the AI to understand it.
5. **Minimum tools per extension:** one for adding data, one for retrieving/searching data.
6. **The service role key bypasses RLS.** If the extension uses RLS and needs user-scoped queries, the tool must accept a `user_id` parameter or derive it from context.

### Extensions That Need OpenRouter

If the extension uses embeddings or LLM extraction (like the core brain), add:

```typescript
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
```

And include the embedding/extraction helper functions from `server/index.ts`.

---

## File 5: README.md

Must follow the template at `extensions/_template/README.md`. Key sections:

### Deployment Table (CRITICAL)

The README must include this exact table format in the "Deploy the MCP Server" step:

```markdown
| Setting | Value |
|---------|-------|
| Function name | `{extension-slug}-mcp` |
| Download path | `extensions/{extension-slug}` |
```

This table is consumed by the [Deploy an Edge Function](../../primitives/deploy-edge-function/) primitive. The `Download path` value must match the extension's actual directory name in the repo.

### SQL Setup

Point users to the Supabase SQL Editor, not the CLI:

```markdown
Run the SQL in `schema.sql` in your Supabase SQL Editor
(`https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql/new`).
Copy, paste, click Run.
```

### Test Prompts

Include 3-5 example prompts a user can try immediately after setup. These should demonstrate the core tools and produce visible results.

---

## Naming Conventions

| Thing | Pattern | Example |
|-------|---------|---------|
| Directory | `extensions/{kebab-case-name}/` | `extensions/household-knowledge/` |
| Function name | `{kebab-case-name}-mcp` | `household-knowledge-mcp` |
| MCP server name | `{kebab-case-name}` | `household-knowledge` |
| Table names | `{snake_case}` | `household_items`, `household_vendors` |
| Tool names | `{snake_case}` | `add_household_item`, `search_items` |
| Connector name | Title Case | `Household Knowledge` |

---

## Validation Checklist

Before submitting, verify:

- [ ] `deno.json` contains standard imports (add extras only if needed)
- [ ] `metadata.json` validates against `/.github/metadata.schema.json`
- [ ] `schema.sql` uses `IF NOT EXISTS`, includes RLS, includes indexes
- [ ] `schema.sql` does NOT modify the `thoughts` table
- [ ] `index.ts` follows the exact server structure (imports, auth, Hono app)
- [ ] `index.ts` tools return `{ content: [{ type: "text" as const, text }] }` format
- [ ] `index.ts` tools have try/catch with `isError: true` error handling
- [ ] `README.md` includes the deployment table with correct function name and download path
- [ ] `README.md` includes test prompts
- [ ] No credentials, API keys, or secrets in any file
- [ ] No binary files over 1MB
- [ ] Directory name matches the download path in the README deployment table

---

## Example Prompt for AI Agent

> Create a new Open Brain extension called "Reading List" that tracks books, articles, and papers. Users should be able to add items with title, author, URL, status (to-read, reading, finished), notes, and a rating. Include tools for adding items, searching by title/author/status, and getting stats on reading habits. Follow the AGENT_SPEC.md in extensions/_template/.

This prompt, combined with this spec, should produce all 5 files correctly formatted and ready for a PR.
