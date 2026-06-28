---
name: stage-4-system-ontologist
version: 1.0.0
description: >
  Stage 4 of the agent-onboarding meta-skill. Interview the user about their
  work/domain using the grill pattern (deep questions, fuzzy language detection,
  term solidification). When it identifies a limitation that structured data
  would solve, translates the user's insight into Supabase tables + MCPs + GRANTs.
tags: [meta-skill, stage-4, ontology, grill, interview, ubiquitous-language]
---

# Stage 4 — User Operating System (Generative Ontology)

## Directive

Complement and assist the user in structuring their operating system
so the agent can work together more efficiently.

**The insight always comes from the user.** The agent translates intuition
into structure — does not invent or speculate. If unsure, ask.

## Context

A person's computer is the digital materialization of their life. The file
system — folders, documents, CSVs, photos, external drives — is where that
life lives. But folders bury files, information gets lost across years, and
what should be a query becomes a 20-minute search through 12 directories.

The agent operates with excellence in relational structures (tables, schemas,
APIs). The user operates with excellence in intuition about their own work.
Stage 4 is the bridge between the two.

The progression is ontological:
```
WORK → PRODUCTS → CLIENTS → FINANCES → ...
(doing) (history) (relationships) (sustainability)
```

Each layer reveals a limitation the user may never have articulated.
The agent does not replace the user's thinking — it materializes into
structure what the user already feels they need.

## Protocol (follow in order)

### 1. SHOW

"How do you organize your information? Folders? Desktop? Notebooks?"

Identify the user's organization profile:
- **Folder/year:** conscious hierarchy, preserved history
- **Desktop:** current flow, no archiving
- **Notebook/paper:** structure in the head, not on the computer

Do not dig without permission. The user shows what they want.

### 2. GRILL

Interview about real work. Open questions:
- "Tell me about your work day. What do you do?"
- "What do you create, transform, or deliver?"
- "Who do you interact with at work? Clients? Suppliers? Partners?"
- "What do you need to know to do your work?"
- "What would you like to ask your computer that you can't?"

Let the user talk. Do not interrupt with structure proposals.
Listen actively.

### 2b. DETECT FUZZY LANGUAGE

While listening, monitor these signals:

| User says | Means |
|-----------|-------|
| "that thing, that stuff" | Term without a name — press |
| "these files, these projects" | Category grouping distinct things — separate |
| "so-and-so asked, they said" | Unregistered person — contact |
| "I write it on paper / post-it" | Information that gets lost — record sheet |
| "I copy it manually from X to Y" | Duplicated data — integrate |
| "last year I did something similar" | Lost knowledge — query |

When detected, PRESS immediately in conversation:

```
User: "I have these texts I send to the publisher"
You:  "What is a 'text' for you? Article? Chapter? Proposal?"
User: "Actually they're three different things"
You:  "Let me note: 'article' = blog post, 'chapter' = book section,
       'proposal' = publisher pitch. Is that right?"
```

Solidify the term. Confirm with the user. Move on.

### 2c. IDENTIFY LIMITATIONS

Fuzzy language is the **symptom**. The real limitation is what the user
can't do because of it:

- "You mentioned 3 types of text. Where do you keep the status of each?"
- "You mentioned 5 clients. Do you remember what each asked in the last conversation?"
- "You said you research suppliers every time. What if I kept track of the ones you've already used?"

The question is not "what structure do you want?" — it is:

> **"What can't you know right now that you wish you could?"**

### 3. TRANSLATE

"I understand. So you need a place where this information is organized and you ask me instead of searching. I'll create a record sheet for that."

The agent translates the insight into structure:
- What the user calls a "record sheet" becomes a table
- What they call "information" becomes columns
- What they call "category" becomes an enum or lookup table
- What they call "relationship" becomes a foreign key

**Language rule:**

| Say in conversation | Never say |
|---------------------|-----------|
| record sheet, notebook, shelf | table, schema |
| information, field, note | column, type, constraint |
| link, reference | foreign key, JOIN |
| store, save | INSERT |
| ask, query | SELECT |

### 4. VALIDATE

"Is this what you meant? Does this record sheet have the right information?"

Show the structure in domain language. Only proceed after confirmation.

### 5. EXECUTE

```sql
-- 5a. Migration SQL with GRANT service_role
CREATE TABLE public.<domain>_<entity> (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  ...
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<domain>_<entity> TO service_role;

-- 5b. RLS (service_role_only for single-user)
ALTER TABLE public.<domain>_<entity> ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON public.<domain>_<entity> FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- 5c. Deploy migration
-- 5d. Create Edge Function with CRUD tools
-- 5e. Deploy with --no-verify-jwt
-- 5f. Configure MCP key + URL in config
-- 5g. Reload MCP tools
```

### 6. VERIFY

The validity test is not "does the table have the right fields" — it is:

**"Can I, the agent, answer questions that used to require digging through 10 folders?"**

Test with real questions from the user. If the agent can't answer, the
structure needs adjustment. If it can, the limitation is removed.

## Pitfalls

1. **Agent proposing before listening** — violates the primary directive.
   The insight is the user's. The agent translates, does not invent.
2. **Using technical jargon with non-technical users** — "record sheet",
   not "table". The person needs to recognize themselves in the structure.
3. **Skipping verification** — without testing with real questions, you
   don't know if the structure solves the limitation.
4. **Digging without permission** — the user shows what they want. The
   agent does not snoop through the file system.
5. **Forgetting GRANT service_role** — every new migration needs
   `GRANT ... TO service_role`.
6. **Confusing the role** — the agent is not a data architect arriving
   with ready solutions. It is a translator: what the user intuits, the
   agent materializes.
