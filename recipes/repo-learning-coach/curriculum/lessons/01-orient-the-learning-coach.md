---
slug: orient-the-learning-coach
title: Orient the Learning Coach
stage: Foundations
difficulty: Intro
order: 1
estimatedMinutes: 15
summary: Understand the product boundary so you do not collapse the learning app, Open Brain, and repo content into one blurry system.
goals:
  - Distinguish the local teaching surface from the durable Open Brain memory layer.
  - Explain why this ships as a recipe instead of an extension.
  - Identify the three pieces you adapt for a new repo.
relatedResearch:
  - recipe-overview
  - content-contract
quiz:
  title: Check the product boundary
  passingScore: 70
  questions:
    - prompt: Why is Repo Learning Coach an OB1 recipe instead of an extension?
      options:
        - Because recipes are allowed to have any number of dashboards.
        - Because the product is a local app and content workflow, not a remote MCP server.
        - Because extensions cannot use Supabase.
        - Because lessons should never connect to thoughts.
      correctOption: Because the product is a local app and content workflow, not a remote MCP server.
      explanation: OB1 extensions are remote MCP builds. This recipe preserves a local app UX instead.
    - prompt: Which layer should own quizzes, comments, and progress?
      options:
        - The core thoughts table
        - Dedicated learning tables
        - The MCP connector URL
        - The browser only, with no persistence
      correctOption: Dedicated learning tables
      explanation: Structured learning state belongs in its own tables so thoughts can stay a durable memory layer.
    - prompt: What should you mostly change when adapting this recipe to a new repo?
      options:
        - The React router and server framework
        - The project config plus research and lesson files
        - The Open Brain MCP server code
        - The Supabase auth model
      correctOption: The project config plus research and lesson files
      explanation: The recipe is built so adaptation happens in content files, not core app rewrites.
---

## The boundary to keep clear

Repo Learning Coach works because it keeps three concerns separate:

- the reusable app
- the repo-specific content
- the durable Open Brain memory loop

When those get blurred together, every new repo turns into a rewrite.

## What changes per repo

For a new repo, the important edits should be:

- the config file that names the project and defines the lesson/research directories
- the research markdown
- the lesson markdown

That means the app can stay boring in a good way.

## Why that is the right v1

The original prototype proved the UX. OB1 needs the architecture translated.

That translation is:

- local Express + React stays
- the original local prototype backend becomes Supabase tables
- hardcoded seeds become frontmatter-driven content
- useful outputs get captured back into `thoughts`
