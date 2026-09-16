---
slug: brain-bridge
title: The Open Brain Bridge
summary: How lesson summaries, takeaways, and follow-up questions get captured into thoughts without duplicating the whole learning database there.
category: integration
---

# The Open Brain Bridge

The bridge into Open Brain should stay narrow on purpose.

Repo Learning Coach has richer structured state than `thoughts`:

- quizzes
- progress
- lesson comments
- curriculum order

Those belong in dedicated learning tables.

What belongs in `thoughts` is the durable part:

- a takeaway worth resurfacing later
- a confusion note worth revisiting in another session
- a summary that should influence future work

That gives you a useful memory loop without forcing the whole learning system into the generic thought schema.

The bridge also works in the other direction.

When a lesson opens, the server can search `thoughts` for related context and surface it in the lesson view. That makes prior work visible at the moment it matters, which is exactly what OB1 is good at.
