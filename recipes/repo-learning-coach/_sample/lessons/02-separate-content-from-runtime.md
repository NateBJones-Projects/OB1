---
slug: separate-content-from-runtime
title: Separate Content from Runtime
stage: Systems
difficulty: Intermediate
order: 2
estimatedMinutes: 20
summary: The importer is the contract that keeps markdown content and structured lesson state in sync without overwriting learner history.
goals:
  - Explain why frontmatter is the right contract for research and lesson content.
  - Understand why the sync step upserts content but preserves learner-generated history.
  - Recognize the role of stable slugs in keeping lessons and quiz history aligned.
relatedResearch:
  - content-contract
quiz:
  title: Check the content contract
  passingScore: 70
  questions:
    - prompt: Why use markdown plus frontmatter for research and lessons?
      options:
        - It is easier to hide complexity from the operator.
        - It keeps repo-specific content inspectable, editable, and easy to diff.
        - It removes the need for a sync pipeline.
        - It makes Supabase migrations unnecessary.
      correctOption: It keeps repo-specific content inspectable, editable, and easy to diff.
      explanation: The whole point is to make repo adaptation happen in content files instead of buried code or prompts.
    - prompt: What should the sync step avoid overwriting?
      options:
        - Lesson summaries and quiz prompts
        - Project title and track metadata
        - Learner progress, comments, and quiz attempt history
        - Research content hashes
      correctOption: Learner progress, comments, and quiz attempt history
      explanation: The importer updates source-controlled content while preserving user-generated learning state.
    - prompt: Why do stable slugs matter?
      options:
        - They let the browser avoid React state.
        - They let the importer update the right lesson records across re-syncs.
        - They remove the need for UUIDs.
        - They make embeddings cheaper.
      correctOption: They let the importer update the right lesson records across re-syncs.
      explanation: Slugs are the stable source-of-truth keys for content updates.
---

## Content should be portable

When a lesson changes, you want to edit a markdown file, not crack open the application data layer.

That is why the recipe moves away from a monolithic `content.ts` file.

## The importer is the real contract

The important job of the sync step is not just “load the files.”

It is to preserve the boundary between:

- source-controlled content
- learner-generated state

That means:

- lessons and research get updated from markdown
- progress, comments, and quiz attempts stay intact

## Treat slugs as stable IDs

If you rename lesson files casually, you create new records instead of updating existing ones.

The practical rule is simple:

- edit the content freely
- change slugs intentionally
