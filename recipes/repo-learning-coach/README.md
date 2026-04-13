# Repo Learning Coach

> Turn repo research into a local lesson app backed by Supabase learning tables, with durable takeaways captured into Open Brain.

## What It Does

Repo Learning Coach gives you a local React + Express learning workspace for understanding a codebase. Research docs and lesson files live in markdown, structured learning state lives in dedicated Supabase tables, and the best takeaways flow back into `thoughts` so they can resurface in future sessions.

Unlike an OB1 extension, this stays a local app in v1. It uses your existing Open Brain project as the backend, but it does not create a new MCP server.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Node.js 18+ and `npm`
- Supabase project URL and service role key from your existing Open Brain setup
- OpenRouter API key for related-thought retrieval and durable capture into `thoughts`

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
REPO LEARNING COACH -- CREDENTIAL TRACKER
-----------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Supabase Project URL:        ____________
  Supabase Service Role Key:   ____________
  OpenRouter API Key:          ____________

LOCAL APP
  Recipe folder path:          ____________
  Local app URL:               ____________

-----------------------------------------
```

![Step 1](https://img.shields.io/badge/Step_1-Create_the_Learning_Tables-1E88E5?style=for-the-badge)

Open your Supabase SQL Editor and run the contents of [schema.sql](./schema.sql).

<details>
<summary>📋 <strong>SQL: Repo Learning Coach tables</strong> (copy from <code>schema.sql</code>)</summary>

This recipe keeps its structured state in these tables:

- `repo_learning_projects`
- `repo_learning_research_documents`
- `repo_learning_tracks`
- `repo_learning_lessons`
- `repo_learning_quizzes`
- `repo_learning_quiz_questions`
- `repo_learning_lesson_progress`
- `repo_learning_quiz_attempts`
- `repo_learning_quiz_responses`
- `repo_learning_lesson_comments`

The SQL also creates the `updated_at` trigger helper and grants `service_role` access for every table.

</details>

> [!IMPORTANT]
> This recipe does **not** modify the core `thoughts` table. The only Open Brain integration is through the existing `upsert_thought` and `match_thoughts` path your OB1 setup already provides.

✅ **Done when:** The new `repo_learning_*` tables appear in Supabase Table Editor and the query finishes without errors.

---

![Step 2](https://img.shields.io/badge/Step_2-Configure_the_Local_App-1E88E5?style=for-the-badge)

**1. Move into the recipe folder:**

```bash
cd recipes/repo-learning-coach
```

**2. Copy the environment file:**

```bash
cp .env.example .env
```

**3. Fill in the variables:**

```text
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENROUTER_API_KEY=your-openrouter-key
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small
PORT=8787
```

**4. Install dependencies:**

```bash
npm install
```

✅ **Done when:** `node_modules/` exists and your `.env` file contains real values.

---

![Step 3](https://img.shields.io/badge/Step_3-Sync_the_Source_Content-1E88E5?style=for-the-badge)

The recipe treats markdown as the source of truth.

**1. Run the importer:**

```bash
npm run sync
```

**2. Inspect the content files if you want to understand the contract:**

- Project config: [repo-learning.config.ts](./repo-learning.config.ts)
- Research docs: [research/](./research/)
- Lessons: [curriculum/lessons/](./curriculum/lessons/)

> [!NOTE]
> Re-running `npm run sync` updates content in place for surviving lesson and research slugs. If you delete or rename source content, the importer prunes the stale database rows so markdown remains the source of truth.

✅ **Done when:** The sync command reports lesson and research counts, and you can see rows in the new `repo_learning_*` tables.

---

![Step 4](https://img.shields.io/badge/Step_4-Run_the_App-1E88E5?style=for-the-badge)

**1. Start the local app:**

```bash
npm run dev
```

**2. Open the browser UI:**

```text
http://localhost:5173
```

You should see:

- a lesson path in the sidebar
- a research library
- lesson progress controls
- quizzes and note capture
- an Open Brain capture panel
- related thoughts when the bridge is configured successfully

✅ **Done when:** You can open a lesson, save progress, submit a quiz, and save a note without errors.

---

![Step 5](https://img.shields.io/badge/Step_5-Adapt_It_to_Your_Repo-1E88E5?style=for-the-badge)

To retarget this recipe to a new repo, change content first, not app code.

**1. Update the project identity in [repo-learning.config.ts](./repo-learning.config.ts).**

**2. Replace the sample research docs in [research/](./research/).**

Each research file uses frontmatter:

```yaml
---
slug: architecture-overview
title: Architecture Overview
summary: What matters most about the system design.
category: architecture
sourceUrl: https://example.com/optional-source
---
```

**3. Replace the lesson files in [curriculum/lessons/](./curriculum/lessons/).**

Each lesson file uses frontmatter for the lesson metadata and quiz, followed by markdown for the actual lesson body:

```yaml
---
slug: orient-the-system
title: Orient the System
stage: Foundations
difficulty: Intro
order: 1
estimatedMinutes: 20
summary: What this lesson is trying to teach.
goals:
  - First goal
  - Second goal
relatedResearch:
  - architecture-overview
quiz:
  title: Check the basics
  passingScore: 70
  questions:
    - prompt: A real question
      options:
        - Option A
        - Option B
      correctOption: Option A
      explanation: Why that answer is right.
---
```

**4. Re-run the importer:**

```bash
npm run sync
```

✅ **Done when:** Your own repo title, research docs, and lessons show up in the UI.

---

![Step 6](https://img.shields.io/badge/Step_6-Use_the_Open_Brain_Bridge-1E88E5?style=for-the-badge)

Open a lesson and use the **Open Brain capture** panel to save one of three artifact types:

- `Takeaway` — a durable lesson insight
- `Confusion note` — something worth resurfacing later
- `Lesson summary` — a reusable summary for future work

The lesson view also shows **Related thoughts** pulled from your existing `thoughts` table when OpenRouter retrieval is configured.

> [!TIP]
> Keep this bridge narrow. Capture durable artifacts, not every note or every quiz result.

✅ **Done when:** Clicking **Send to Open Brain** returns a success message and a later search can find that saved artifact.

## Expected Outcome

When working correctly, you should have:

- a local lesson app running against your existing OB1 Supabase project
- research and lesson content sourced from plain markdown files
- persistent progress, notes, and quiz history in dedicated `repo_learning_*` tables
- explicit capture of durable learning artifacts back into `thoughts`
- lesson views that can surface related prior thoughts from Open Brain

## Future Extraction Path

This v1 intentionally keeps the UI local. If you want to turn it into a hosted OB1 dashboard later, the clean extraction path is:

1. keep the content contract and Supabase tables the same
2. move the React app into `dashboards/`
3. keep the capture/retrieval bridge behind the existing server-layer interface

That way the frontend can move without redesigning the learning schema.

## Troubleshooting

**Issue: `npm run sync` fails with a missing table error**  
Solution: Run the full contents of [schema.sql](./schema.sql) in Supabase first. The app assumes the `repo_learning_*` tables already exist.

**Issue: The app loads, but “Related thoughts” stays empty**  
Solution: Check `OPENROUTER_API_KEY` in `.env`. The bridge needs embeddings to query `match_thoughts`. Also make sure your Open Brain already has useful content in `thoughts`.

**Issue: “Send to Open Brain” fails**  
Solution: Confirm your OB1 project includes the usual `upsert_thought` flow from the core setup and that your service role key is correct. This recipe writes through that existing path; it does not define its own capture RPC.

**Issue: Re-syncing creates duplicate lessons**  
Solution: Keep lesson `slug` values stable. The importer uses slugs as the durable source-of-truth key for content updates.
