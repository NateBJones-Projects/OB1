---
slug: content-contract
title: The Content Contract
summary: The repo-specific surface is plain files: one config file, research markdown, and lesson markdown with frontmatter.
category: architecture
---

# The Content Contract

Repo Learning Coach is designed so adaptation happens in files, not in application code.

The contract is intentionally small:

- `repo-learning.config.ts` defines the project identity and where content lives
- `research/*.md` stores source notes with frontmatter
- `curriculum/lessons/*.md` stores lesson bodies plus quiz data in frontmatter

This keeps the adaptation surface inspectable and diffable.

If you want to retarget the recipe to a new repo, you should mainly be changing:

- project metadata
- research documents
- lesson documents

You should not be redesigning the Express server or React app every time.

That is the same architectural idea that made the original prototype interesting, but reshaped for OB1:

- content is repo-specific
- the app/runtime is reusable
- the importer is the contract that keeps both aligned
