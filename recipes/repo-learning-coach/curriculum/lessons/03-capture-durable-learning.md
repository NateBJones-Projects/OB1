---
slug: capture-durable-learning
title: Capture Durable Learning
stage: Advanced
difficulty: Intermediate
order: 3
estimatedMinutes: 18
summary: Use the Open Brain bridge to save what matters from the learning session without duplicating the whole learning database into thoughts.
goals:
  - Identify which learning artifacts belong in thoughts and which do not.
  - Explain how related thought retrieval strengthens a lesson at the moment of use.
  - Use explicit capture actions instead of hiding writes inside the app.
relatedResearch:
  - brain-bridge
  - recipe-overview
quiz:
  title: Check the memory loop
  passingScore: 70
  questions:
    - prompt: Which artifact is the best fit for capture into thoughts?
      options:
        - Every quiz response
        - Every comment, regardless of quality
        - A durable takeaway or follow-up worth resurfacing later
        - The full learning dashboard state
      correctOption: A durable takeaway or follow-up worth resurfacing later
      explanation: Thoughts should hold durable memory artifacts, not the entire learning system.
    - prompt: Why surface related prior thoughts inside a lesson?
      options:
        - To replace the lesson content entirely
        - To bring relevant prior context into the moment the learner needs it
        - To avoid storing research documents
        - To make the app work without Supabase
      correctOption: To bring relevant prior context into the moment the learner needs it
      explanation: The lesson becomes stronger when OB1 can re-surface earlier work right when it is useful.
    - prompt: Why keep capture explicit?
      options:
        - Because explicit writes are easier to trust and operate
        - Because Open Brain cannot store summaries
        - Because quizzes should never influence memory
        - Because local apps cannot call Supabase RPCs
      correctOption: Because explicit writes are easier to trust and operate
      explanation: Hidden writes make the system harder to trust. Explicit capture keeps the memory loop inspectable.
---

## The narrow bridge is the right bridge

If you push the entire learning app into `thoughts`, you lose the value of structured state.

If you never capture anything back into `thoughts`, the learning work stays trapped inside one app.

The recipe needs the middle path.

## What to capture

Good capture candidates:

- a concise takeaway you want to remember later
- a confusion note that should resurface in a future build session
- a summary of what this lesson changed for you

Bad capture candidates:

- raw quiz submissions
- every note just because it exists
- internal table state

## What retrieval gives you

Related thoughts turn isolated lessons into compounding context.

A lesson about a subsystem is more useful when the learner can also see:

- prior decisions
- earlier experiments
- notes from another session that hit the same theme
