---
slug: recipe-overview
title: What Repo Learning Coach Builds
summary: The product boundary for the recipe: a local learning app backed by Supabase tables inside an existing Open Brain project.
category: orientation
---

# What Repo Learning Coach Builds

Repo Learning Coach is not a new MCP server and it is not a replacement for your core Open Brain setup.

It is a local app that does three jobs:

1. turns repo research into a browseable library
2. turns that research into a lesson path with quizzes and notes
3. captures the durable outputs of learning back into `thoughts`

That boundary matters.

The local app owns the teaching surface: lessons, quiz state, comments, and progress.
Open Brain owns the durable memory layer: the things worth surfacing again later across other sessions and tools.

The result is a cleaner split than the original local-first prototype:

- local UI for active onboarding and study
- Supabase tables for structured learning state
- `thoughts` only for durable takeaways and follow-up questions

That keeps the recipe compatible with OB1 instead of turning it into a parallel product stack.
