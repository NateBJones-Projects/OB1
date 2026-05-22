# Agent Memory Dashboard Screenshots

These captures show the OB1 Agent Memory dashboard design pass inspired by the Content Master Pro graphite workspace aesthetic, with added Nate B. Jones / OB1 micro-branding and the beanie/glasses OB1 mark. They are intended as baseline visual assets for Linear updates, tutorial planning, and Nate-facing walkthroughs.

| File | Surface | Capture Notes |
| --- | --- | --- |
| `agent-memory-review-queue.png` | Review queue | Pending agent-written memories with scope strip, trust labels, policy labels, and review actions. |
| `agent-memory-inspector.png` | Memory inspector | Single-memory provenance, source refs, metadata, use policy, scope, and origin. |
| `agent-memory-recall-trace.png` | Recall trace | Retrieval debug path showing request metadata, returned memories, scores, policy, and usage reporting. |
| `nate-continuity-pending-desktop.png` | Review queue | Desktop capture of Nate continuity demo data with pending agent-written memories. |
| `nate-continuity-evidence-desktop.png` | Evidence view | Desktop capture of imported/source-backed reference memories marked evidence-only. |
| `nate-continuity-confirmed-desktop.png` | Confirmed view | Desktop capture of trusted operating rules that can guide future agents. |
| `nate-continuity-rejected-desktop.png` | Rejected view | Desktop capture showing false assumptions blocked from future recall. |
| `nate-continuity-stale-desktop.png` | Stale view | Desktop capture showing old assumptions preserved but not auto-injected. |
| `nate-continuity-trace-desktop.png` | Recall trace | Desktop trace for the Nate continuity demo recall run. |

## Full Dashboard Walkthrough Captures

These captures are 1920x1080 walkthrough frames generated from the local dashboard demo REST shim. They show every major dashboard tab as wired for a full product tour, not only the Agent Memory pages.

| File | Surface | Capture Notes |
| --- | --- | --- |
| `dashboard-walkthrough/dashboard-overview.png` | Dashboard | Stats, topic mix, recent continuity notes, and workflow summary. |
| `dashboard-walkthrough/thoughts-table.png` | Thoughts | Dense canonical memory table with Nate proposal, OpenClaw, repo, and launch seed rows. |
| `dashboard-walkthrough/workflow-board.png` | Workflow | Task and idea board for OpenClaw launch, screenshots, evals, and publishing work. |
| `dashboard-walkthrough/agent-memory-review.png` | Agent Memory | Review queue seeded with governed write-back examples. |
| `dashboard-walkthrough/recall-trace.png` | Recall Trace | Debug trace for the Nate continuity demo request. |
| `dashboard-walkthrough/duplicates-review.png` | Duplicates | Similar-memory pairs for merge/dismiss review. |
| `dashboard-walkthrough/audit-quality.png` | Audit | Low-quality and risky memory-policy examples for cleanup. |

Generated walkthrough outputs:

- PDF guide: `docs/walkthroughs/ob1-agent-dashboard/output/OB1-Agent-Dashboard-Walkthrough.pdf`
- HTML guide: `docs/walkthroughs/ob1-agent-dashboard/output/OB1-Agent-Dashboard-Walkthrough.html`
- Video walkthrough: `docs/walkthroughs/ob1-agent-dashboard/output/OB1-Agent-Dashboard-Walkthrough.mp4`
- Voiceover script/audio: `docs/walkthroughs/ob1-agent-dashboard/output/audio/`

Capture source:

- Local dashboard: `http://localhost:3020`
- API proxy: `http://127.0.0.1:3022`
- Smoke workspace/project: `ob1-staging` / `agent-memory-api-smoke`
- Nate continuity demo workspace/project: `nate-jones-personal-ob1` / `continuity-os`
- Nate continuity trace request: `d766f44e-5a11-4034-8ab5-3f497fa29492`
- Brand assets: `docs/assets/agent-memory/brand` and `dashboards/open-brain-dashboard-next/public/brand`

The original smoke memories were created with the live smoke harness and then cleaned from the personal OB1 Supabase project after capture. The Nate continuity demo memories are intentionally seeded reference/demo data for visual docs and should be removed or reseeded before public launch captures if the data story changes.

Use `integrations/agent-memory-api/smoke/seed-nate-continuity-demo.mjs` to recreate the Nate continuity project.

Use `docs/walkthroughs/ob1-agent-dashboard` to recreate the full dashboard walkthrough screenshots, PDF, and video. The demo REST shim is intentionally local-only and exists to make dashboard walkthroughs repeatable while the production `open-brain-rest` gateway is still separate from the Agent Memory API.
