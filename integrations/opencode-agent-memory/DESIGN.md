# OpenCode V2 integration plan

1. Use the existing runtime-neutral Agent Memory API; add no database schema,
   server, model dependency, or replacement compaction engine.
2. Recall on primary model dispatch using the latest user request. Cache within a
   turn, isolate sessions/projects, refresh after compaction, and inject a bounded
   evidence block. Auxiliary title/generate/compaction requests never recall.
3. Make automatic checkpoint extraction explicitly opt-in. Summarize only public
   user/assistant text; exclude tool payloads and reasoning. Save small structured
   findings with generated provenance, review required, and retry-safe identities.
4. Use supported V2 hooks and durable plugin storage for checkpoint receipts.
   Network failures must not prevent normal coding or compaction.
5. Verify budget enforcement, project isolation, policy filtering, duplicate
   events, failed requests, and disabled capture offline. Run live read-only
   validation against an existing OB1 instance and a native OpenCode smoke test.
6. Make model-assisted review independently opt-in, with an explicit reviewer model.
   Check only captured IDs from the same session against the visible source excerpt.
   Supported routine findings become evidence-only; never promote to user-confirmed
   instructions. Preserve successful capture receipts across review failures and
   recheck scope, edits and human review state before any review mutation.

The contribution is a client plugin for a remote Supabase Edge Function, not an
additional MCP server. Existing MCP tools can coexist for explicit memory review.
Automatic injection is not evidence that the model used a memory; usage reporting
must not mark every injected item as used.
