# Agent Memory Dashboard Screenshots

These captures show the first OB1 Agent Memory dashboard design pass inspired by the Content Master Pro graphite workspace aesthetic. They are intended as baseline visual assets for Linear updates, tutorial planning, and Nate-facing walkthroughs.

| File | Surface | Capture Notes |
| --- | --- | --- |
| `agent-memory-review-queue.png` | Review queue | Pending agent-written memories with scope strip, trust labels, policy labels, and review actions. |
| `agent-memory-inspector.png` | Memory inspector | Single-memory provenance, source refs, metadata, use policy, scope, and origin. |
| `agent-memory-recall-trace.png` | Recall trace | Retrieval debug path showing request metadata, returned memories, scores, policy, and usage reporting. |

Capture source:

- Local dashboard: `http://localhost:3020`
- API proxy: `http://127.0.0.1:3022`
- Workspace: `ob1-staging`
- Test project: `agent-memory-api-smoke`

The source test memories were created with the live smoke harness and then cleaned from the personal OB1 Supabase project after capture. Refresh these screenshots after any major visual pass or before publishing public docs.
