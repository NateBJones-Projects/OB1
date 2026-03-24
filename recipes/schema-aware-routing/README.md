# Schema-Aware Routing Pattern

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@claydunker-yalc](https://github.com/claydunker-yalc)**

*Reviewed and merged by the Open Brain maintainer team — thank you for building the future of AI memory!*

</div>


A pattern for using LLM-extracted metadata to route unstructured text into the correct database tables automatically. One input message becomes writes to four different tables — `thoughts`, `people`, `interactions`, and `action_items` — based entirely on what the LLM finds in the text.

> [!NOTE]
> I'm an elementary school teacher, not a developer. I built this entire system with Claude Code. If I can get it running, you can too. The instructions below are written for people like me.

## Prerequisites

Before you start, make sure you have:

- A **Supabase** project with the database tables created (SQL provided below)
- An **OpenAI-compatible API key** for LLM calls and embeddings (OpenAI, OpenRouter, Anthropic, etc.)
- **Node.js 18+** or **Deno** installed on your machine
- The `@supabase/supabase-js` package installed (`npm install @supabase/supabase-js`)

## How It Works

The routing pattern follows three stages:

```
Raw text
  │
  ▼
┌──────────────────────────┐
│  LLM Metadata Extraction │  ← Extracts people, action items, topics, type, domain
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  Schema-Aware Router     │  ← Reads metadata fields, decides which tables to write
└──────────┬───────────────┘
           │
           ├──→ thoughts table      (ALWAYS — the raw capture is never lost)
           ├──→ people table        (IF people are mentioned — find, fuzzy-match, or create)
           ├──→ interactions table  (FOR EACH resolved person — links person ↔ thought)
           └──→ action_items table  (ONLY IF speaker uses first-person intent)
```

### The Key Routing Decisions

**Decision 1 — Thoughts (always written):**
Every input always creates a `thoughts` row. This is your safety net — raw data is never lost regardless of what else happens.

**Decision 2 — People (find, fuzzy-match, or create):**
When the LLM extracts a `people` array, each person goes through a three-pass resolution:

1. **Exact match** — checks name and aliases (case-insensitive). If found, backfills any missing metadata (role, relationship_type) on the existing record.
2. **Fuzzy match** — uses first-name similarity. "Mike" matches "Mike Smith", "Rob" matches "Robert". Same last name alone does NOT match (so "Kristin Dunker" won't match "Rosie Dunker"). Fuzzy matches get flagged for human confirmation.
3. **First-name collision** — catches "Sarah J." vs existing "Sarah Johnson". Also flagged for confirmation.
4. **No match** — creates a new person record.

**Decision 3 — Interactions (one per resolved person):**
For every person that gets resolved (found or created) with a valid ID, an `interactions` record is written. This links the person to the original thought and carries the same embedding vector for semantic search.

**Decision 4 — Action items (first-person intent only):**
The LLM is prompted to ONLY extract action items when the speaker commits to doing something themselves: "I need to", "I should", "remind me to". If someone ELSE wants something ("she asked me to", "he needs"), that's an observation — not an action item. This prevents your task list from filling up with other people's requests.

> [!IMPORTANT]
> The LLM prompt is the single source of truth for routing. If you change the extraction prompt, you change what gets routed where. Treat it like a schema definition.

## Setup Instructions

![Step 1](https://img.shields.io/badge/Step_1-Create_Your_Database_Tables-2E86AB?style=for-the-badge)

<details>
<summary>📋 <strong>SQL: Create all five tables and grant permissions</strong> (click to expand)</summary>

```sql
-- Enable the vector extension for embeddings
create extension if not exists vector;

-- 1. Thoughts table — the raw capture
create table thoughts (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  embedding vector(1536),
  domain text default 'personal',
  status text default 'active',
  source text default 'api',
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. People table — your contact graph
create table people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  aliases text[] default '{}',
  relationship_type text,
  role text,
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. Interactions table — links people to thoughts
create table interactions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id),
  note text,
  source text default 'api',
  embedding vector(1536),
  created_at timestamptz default now()
);

-- 4. Action items table — first-person commitments only
create table action_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  domain text default 'personal',
  source text default 'api',
  status text default 'open',
  linked_person_id uuid references people(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 5. Pending confirmations table — for fuzzy match resolution
create table pending_confirmations (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null,
  slack_ts text,
  status text default 'pending',
  created_at timestamptz default now()
);

-- Grant permissions to service_role (required on newer Supabase projects)
grant select, insert, update, delete on table public.thoughts to service_role;
grant select, insert, update, delete on table public.people to service_role;
grant select, insert, update, delete on table public.interactions to service_role;
grant select, insert, update, delete on table public.action_items to service_role;
grant select, insert, update, delete on table public.pending_confirmations to service_role;
```

</details>

Run this SQL in your Supabase SQL Editor (Dashboard → SQL Editor → New Query → paste → Run).

✅ **Done when:** You can see all five tables in the Supabase Table Editor.

---

![Step 2](https://img.shields.io/badge/Step_2-Wire_Up_Your_LLM_and_Embedding_Calls-2E86AB?style=for-the-badge)

Open `index.ts` and find the two placeholder functions:

**1. Replace `extractMetadata()`:**
Swap out the `throw` with your LLM API call. The system prompt (`EXTRACTION_SYSTEM_PROMPT`) is already defined for you. Send it as the system message and the input text as the user message. Request JSON response format.

**2. Replace `getEmbedding()`:**
Swap out the `throw` with your embedding API call. We used `text-embedding-3-small` from OpenAI (1536 dimensions). If you use a different model, update the `vector(1536)` in the SQL above to match your model's dimensions.

> [!TIP]
> You can use OpenRouter as a proxy to access multiple LLM providers with one API key. That's what I use — it lets me swap models without changing code.

✅ **Done when:** Both functions make real API calls and return data instead of throwing errors.

---

![Step 3](https://img.shields.io/badge/Step_3-Initialize_Your_Supabase_Client-2E86AB?style=for-the-badge)

```typescript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://YOUR_PROJECT.supabase.co",
  "YOUR_SERVICE_ROLE_KEY"
);
```

> [!CAUTION]
> Use the **service role key**, not the anon key. The anon key has Row Level Security restrictions that will block server-side inserts. Never expose the service role key in client-side code.

✅ **Done when:** You can run `supabase.from("thoughts").select("id").limit(1)` without errors.

---

![Step 4](https://img.shields.io/badge/Step_4-Call_the_Router-2E86AB?style=for-the-badge)

```typescript
import { processThought } from "./index";

const result = await processThought(
  supabase,
  "I need to call Sarah tomorrow about the school fundraiser"
);

console.log(result);
// {
//   thoughtId: "uuid-here",
//   writes: [
//     { table: "thoughts", success: true },
//     { table: "people", success: true, details: "Created: Sarah" },
//     { table: "interactions", success: true, details: "For: Sarah" },
//     { table: "action_items", success: true, details: "call Sarah tomorrow about the school f..." }
//   ],
//   people: [
//     { name: "Sarah", id: "uuid-here", action: "created" }
//   ]
// }
```

✅ **Done when:** You see rows appear in all four tables in the Supabase Table Editor after running the script.

---

![Step 5](https://img.shields.io/badge/Step_5-Verify_the_Routing_Logic-2E86AB?style=for-the-badge)

Test these three inputs to confirm each routing path works:

| Input | Expected Tables Written |
|---|---|
| `"I need to call Sarah tomorrow"` | thoughts + people + interactions + action_items |
| `"My daughter Poppy has swimming tonight"` | thoughts + people + interactions (no action items — it's an observation) |
| `"Really interesting article about AI in education"` | thoughts only (no people, no action items) |

✅ **Done when:** Each test input writes to exactly the tables listed above — no more, no less.

## Expected Outcome

After following all five steps, you'll have a working schema-aware router that:

- Captures every input to the `thoughts` table (nothing is ever lost)
- Automatically builds a contact graph in the `people` table as you mention names
- Links every person mention to an `interactions` record with a semantic embedding
- Only creates action items for things YOU commit to doing (not other people's requests)
- Flags ambiguous name matches for human review instead of guessing

Your Supabase dashboard should show data flowing into all four tables, with proper foreign key relationships between `people`, `interactions`, and `action_items`.

## Troubleshooting

### "Error: relation 'thoughts' does not exist"

You haven't run the SQL from Step 1 yet, or you ran it in the wrong Supabase project. Double-check that you're looking at the correct project in your Supabase dashboard, then re-run the SQL in the SQL Editor.

> [!WARNING]
> If you have multiple Supabase projects, make sure your `SUPABASE_URL` matches the project where you created the tables. This is the #1 mistake I made — spent an hour debugging before I realized I was pointed at my dev project instead of production.

### "LLM returns empty people array even though I mentioned someone by name"

The extraction prompt expects clear, explicit name mentions. Pronouns like "he" or "she" won't resolve to a person. Try rephrasing: instead of "She wants me to call her", say "Sarah wants me to call her". The LLM is instructed to only extract what's explicitly there.

If you're consistently getting bad extractions, try upgrading your LLM model. `gpt-4o-mini` works well for this. Smaller or older models may struggle with the structured JSON output.

### "Action items are being created for things other people asked me to do"

The extraction prompt has very specific rules about first-person intent. Check that you haven't modified the `EXTRACTION_SYSTEM_PROMPT`. The key line is:

> "If someone ELSE wants something ('she wants', 'he asked', 'they need') that is NOT an action item"

If you've customized the prompt, make sure this rule survived your edits.

### "Fuzzy matching is creating duplicate people"

The `namesAreSimilar()` function intentionally has conservative matching — it only looks at first names. If "Mike" and "Michael Smith" aren't matching, it's because the first name "Mike" doesn't contain "Michael" (it goes the other direction). You may want to adjust the fuzzy logic for your specific use case, but be careful: too aggressive and you'll merge different people; too conservative and you'll create duplicates.

> [!TIP]
> Check the `pending_confirmations` table in Supabase. If fuzzy matches are being flagged there but never resolved, that's your queue of ambiguous matches waiting for human review. Build a simple UI or bot command to process them.

### "Embeddings dimension mismatch"

If you switched from `text-embedding-3-small` (1536 dimensions) to a different model, you need to update the `vector(1536)` in the SQL schema to match. For example, `text-embedding-3-large` uses 3072 dimensions. Drop and recreate the tables with the correct dimension, or alter the columns:

<details>
<summary>📋 <strong>SQL: Change embedding dimensions</strong> (click to expand)</summary>

```sql
alter table thoughts alter column embedding type vector(YOUR_DIMENSION);
alter table interactions alter column embedding type vector(YOUR_DIMENSION);
```

</details>

## Credits

Built by Clay Dunker ([@claydunker-yalc](https://github.com/claydunker-yalc)) — an elementary school teacher who builds with Claude Code. This pattern emerged from building a personal knowledge management system (Open Brain / OB1) that captures thoughts from Slack and routes them into a structured database.

If you want to learn more about the project, check out the main [OB1 repository](https://github.com/NateBJones-Projects/OB1).
