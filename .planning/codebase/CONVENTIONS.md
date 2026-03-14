# Coding Conventions

**Analysis Date:** 2026-03-13

## Naming Patterns

**Files:**
- TypeScript/JavaScript files: `camelCase` with `.ts` extension
  - Extension servers: `index.ts` (main server) or descriptive names like `shared-server.ts`
  - Scripts: `kebab-case.ts` or `kebab-case.py`
  - Examples: `index.ts`, `shared-server.ts`, `backfill-metadata.ts`, `import-chatgpt.py`

**Functions:**
- Function names: `camelCase`
- Tool names (MCP): `snake_case` for consistency with protocol
  - Examples: `add_household_item`, `search_recipes`, `generate_shopping_list`, `update_recipe`, `mark_item_purchased`
- Async helper functions: `snake_case` with descriptive purpose
  - Examples: `extract_conversations()`, `walk_messages()`, `extract_user_text()`, `should_skip()`, `http_post_with_retry()`

**Variables:**
- Local variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE` (used for environment variables, config thresholds)
  - Examples: `SUPABASE_URL`, `OPENROUTER_API_KEY`, `MIN_TOTAL_MESSAGES`, `SKIP_TITLE_PATTERNS`

**Types:**
- TypeScript interfaces: `PascalCase`
- Zod schema definitions: Destructured inline with tool definitions using `z.string()`, `z.number()`, etc.
- Example: `interface Args { source: string | null; limit: number; dryRun: boolean; }`

## Code Style

**Formatting:**
- No formatter detected in this codebase; relies on consistent manual formatting
- Indentation: 2 spaces (observed in all TypeScript/Python files)
- Line length: No strict limit enforced, but typically under 120 characters
- JSDoc/comments: 80-character blocks common

**Linting:**
- No ESLint, Prettier, or other linting tools configured
- Code follows functional/procedural style without strict linting rules

## Import Organization

**Order:**
1. External framework/library imports (Hono, MCP SDK, etc.)
2. Utility library imports (Supabase, Zod, standard library)
3. Local/relative imports (none in this codebase yet)

**Path Aliases:**
- Not used in this codebase; all imports use full package names
- Examples:
  ```typescript
  import { Hono } from "hono";
  import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
  import { createClient } from "@supabase/supabase-js";
  import { z } from "zod";
  ```

**Python imports:**
- Standard library imports first, then third-party
- Group by functionality
- Example pattern from `import-chatgpt.py`:
  ```python
  import argparse
  import hashlib
  import json
  import os
  import re
  import sys
  import time
  import zipfile
  from datetime import datetime, timezone
  from pathlib import Path
  ```

## Error Handling

**TypeScript/MCP:**
- Async errors are thrown and caught in try-catch blocks
- Errors are transformed into MCP response format: `{ isError: true, content: [{ type: "text", text: JSON.stringify(...) }] }`
- Pattern: Check Supabase client response for `error` object before proceeding
  ```typescript
  const { data, error } = await supabase.from("table").select();
  if (error) throw new Error(`Context: ${error.message}`);
  ```
- Tool handlers wrap all operations in try-catch and return error responses
  - Success: `{ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }`
  - Error: `{ content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }) }], isError: true }`

**Python:**
- Errors use custom retry logic with exponential backoff for HTTP failures (`http_post_with_retry`)
- Arguments are validated with argparse; invalid args trigger `sys.exit(1)` with error message
- Environment variable validation happens early in `main()` before any processing
- Exception handling is selective—catches specific exceptions (json.JSONDecodeError, KeyError) rather than broad catches
- Return dictionaries with `{ "ok": bool, "error": string }` for success/failure indication

## Logging

**Framework:** `console` for TypeScript; `print()` for Python

**Patterns:**
- TypeScript: Minimal logging; main output is MCP response JSON
- Python scripts: Progress logging to stdout
  - Progress indicators: `print(f"Batch {batchNum}/{totalBatches}...")`, `print(f"  ✓ {id}: ...")`, `print(f"  ✗ {id}: ...")`
  - Summaries and statistics printed to stdout at end
  - Optional verbose mode: `--verbose` flag controls detail level
  - Dry-run logging: When `--dry-run`, prints what would happen without actually writing

## Comments

**When to Comment:**
- File headers: JSDoc block at top of file explaining purpose and usage
  - `/**\n * Extension Name: what it does\n * ...\n */`
  - For scripts: Unix shebang + docstring explaining usage, options, requirements
  - Python example: Module docstring with usage examples, environment variables, options

- Inline comments: Section markers used for visual organization
  - Pattern: `// ─── Section Name ───────────────────────────────────────────`
  - Used to divide major logical sections within files
  - Seen in both TypeScript and Python files

- No excessive commenting; code is self-documenting where possible

**JSDoc/TSDoc:**
- Not extensively used in MCP tools; parameters are documented via Zod `.describe()` calls instead
- Example: `z.string().describe("User ID (UUID) — typically auth.uid()")`
- Comments in complex logic blocks explain algorithms or edge cases
  - Example in `import-chatgpt.py`: `walk_messages()` includes comments explaining the tree traversal algorithm

## Function Design

**Size:**
- Functions are typically 20-80 lines; longer functions are only when dealing with complex business logic
- MCP tool handlers: 20-50 lines on average (setup, query, error check, return)
- Helper functions: 10-30 lines (focused on single responsibility)

**Parameters:**
- MCP tools accept a single object (destructured in function signature)
  - Example: `async ({ user_id, name, category, location, details, notes }) => { ... }`
- Helper functions accept individual parameters
- Python scripts use argparse for CLI parameters

**Return Values:**
- MCP tools always return `{ content: [{ type: "text", text: ... }], isError?: boolean }`
- Helper functions return data directly (not wrapped in response objects)
- Functions that might fail use tuple or error object pattern: `{ ok: bool, error?: string, data?: any }`

## Module Design

**Exports:**
- TypeScript: Exports not used; single `app.post("/mcp", ...)` handler is the main export to Deno.serve
- Python: Single `if __name__ == "__main__": main()` pattern

**Tool Organization (MCP):**
- Each tool is registered via `server.tool(name, description, schema, handler)`
- Tools are logically grouped in comments (e.g., `// Tool 1: add_...`, `// Tool 2: search_...`)
- No separate tool files; all tools for a server live in a single `index.ts`

**Module File Structure:**
- `index.ts` — Main MCP server implementation (Hono app + all tools)
- `shared-server.ts` — Secondary read-only server for sharing (e.g., `meal-planning/shared-server.ts`)
- `schema.sql` — Database schema for the extension
- `metadata.json` — Contribution metadata
- `README.md` — User-facing documentation
- `deno.json` — Deno runtime dependencies

## Constants and Configuration

**Environment Variables:**
- Accessed via `Deno.env.get("VAR_NAME")` in TypeScript
- Accessed via `os.environ.get("VAR_NAME")` in Python
- All external credentials (API keys, database URLs) come from environment variables
- Required environment variables are validated at startup before processing

**Magic Numbers/Thresholds:**
- Defined as named constants at module top
- Example in `import-chatgpt.py`:
  ```python
  MIN_TOTAL_MESSAGES = 4
  MIN_USER_WORDS = 20
  OPENROUTER_BASE = "https://openrouter.ai/api/v1"
  ```

## Data Structures

**JSON Responses:**
- Always formatted with `JSON.stringify(data, null, 2)` for readability in MCP responses
- Metadata stored as JSONB in Supabase; accessed via dot notation in queries

**Arrays and Objects:**
- Use native JavaScript/Python collections (Array, dict, etc.)
- No custom collection abstractions

---

*Convention analysis: 2026-03-13*
