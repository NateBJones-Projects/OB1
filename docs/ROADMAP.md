# BigOleBrain Feature Roadmap

> This is the **index**. Detailed build specs live in `docs/specs/`. See `docs/SESSION_GUIDE.md` for how to use these with Claude Code.

---

## Guard rails (applies to every feature)

See `CLAUDE.md` for the full list. Key rules:

- Never modify the core `thoughts` table structure (adding columns is fine).
- MCP servers = remote Supabase Edge Functions only. No local servers.
- No credentials in code. Use `Deno.env.get()`.
- Follow the Edge Function pattern in `supabase/functions/open-brain-mcp/index.ts`.
- Every new table needs `README.md` + `metadata.json` per `CONTRIBUTING.md`.
- Dashboards: Next.js + Tailwind, deployed to Vercel. Template: `dashboards/data-browser/`.
- SQL: no `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, or unqualified `DELETE FROM`.

---

## Status overview

| Feature | Status | Spec file |
|---------|--------|-----------|
| 1.1 Actions table | ✅ Complete | — |
| 1.2L Thought explorer | ✅ Complete | — |
| 1.3L Calendar view | ✅ Complete | — |
| 1.1a UUID exposure | ✅ Complete| `docs/specs/1.1a-uuid-exposure.md` |
| 1.1b Recurring actions | ✅ Complete | `docs/specs/1.1b-recurring-actions.md` |
| 1.2a Command center scaffold | ✅ Complete | `docs/specs/1.2a-command-center-scaffold.md` |
| 1.2b Today view | ✅ Complete | `docs/specs/1.2b-today-view.md` |
| 1.2c Upcoming view | ✅ Complete | `docs/specs/1.2c-upcoming-view.md` |
| 1.2d Thoughts view | ✅ Complete | `docs/specs/1.2d-thoughts-view.md` |
| 3.2 Stale loop detector (MCP) | ✅ Complete | `docs/specs/3.2-stale-loop-mcp.md` |
| 4.2 Weekly trends (MCP) | 🔲 Quick win | `docs/specs/4.2-weekly-trends-mcp.md` |
| 1.1d-s1 Task engine schema | ✅ Complete | `docs/specs/1.1d-s1-task-engine-schema.md` |
| 1.1d-s2 Cron triggers | ✅ Complete | `docs/specs/1.1d-s2-cron-triggers.md` |
| 1.1d-s3 LLM prompt task type | ✅ Complete | `docs/specs/1.1d-s3-llm-prompt.md` |
| 1.1d-s4 Alert digest task type | ✅ Complete | `docs/specs/1.1d-s4-alert-digest.md` |
| 1.1d-s5 Stale loop scan task type | ✅ Complete | `docs/specs/1.1d-s5-stale-loop-scan.md` |
| 1.1d-s6 Deck builder task type | 🚫 Blocked on template | `docs/specs/1.1d-s6-deck-builder.md` |
| 1.1d-s7 Event trigger | 🔲 Ready | `docs/specs/1.1d-s7-event-trigger.md` |
| 1.1d-s8 Trend analysis task type | 🔲 Blocked on 1.1d-s2, 4.2 | `docs/specs/1.1d-s8-trend-analysis.md` |
| 2.1 Multi-user auth | ✅ Complete | `docs/specs/2.1-multi-user-auth.md` |
| 2.2 Liv's dashboard | 🚫 Superseded by Phase 3 | `docs/specs/2.2-livs-dashboard.md` |
| 2.3 Instacart export | 🔲 Standalone | `docs/specs/2.3-instacart-export.md` |
| **Phase 3: Unified app** | | |
| 3.0-s1 App shell + auth | 🔲 Ready | `docs/specs/3.0-s1-app-shell-auth.md` |
| 3.0-s2 Shared components | 🔲 Blocked on 3.0-s1 | `docs/specs/3.0-s2-shared-components.md` |
| 3.0-s3 Actions screen | 🔲 Blocked on 3.0-s2 | `docs/specs/3.0-s3-actions-screen.md` |
| 3.0-s4 Household screen | 🔲 Blocked on 3.0-s2 | `docs/specs/3.0-s4-household-screen.md` |
| 3.0-s5 Meals screen | 🔲 Blocked on 3.0-s2 | `docs/specs/3.0-s5-meals-screen.md` |
| 3.0-s6 Morning briefing | 🔲 Blocked on 3.0-s3, s4, s5 | `docs/specs/3.0-s6-morning-briefing.md` |
| 3.0-s7 Agent feed | 🔲 Blocked on 3.0-s2 | `docs/specs/3.0-s7-agent-feed.md` |
| 3.0-s8 Polish + Vercel deploy | 🔲 Blocked on 3.0-s7 | `docs/specs/3.0-s8-polish-deploy.md` |
| 4.1 Thought graph | 🔲 Phase 4 | `docs/specs/4.1-thought-graph.md` |
| 4.3 Capture sources | 🔲 Modular | `docs/specs/4.3-capture-sources.md` |
| **Phase 5: Agent pipeline** | | |
| 5.1 Triage agent | 🔲 Blocked on 1.1a | `docs/specs/5.1-triage-agent.md` |
| 5.2 Routing agent | 🔲 Blocked on 5.1 | `docs/specs/5.2-routing-agent.md` |
| 5.3 Verification loop | 🔲 Blocked on 5.2 | `docs/specs/5.3-verification-loop.md` |
| 5.4 Research agent (first exec agent) | 🔲 Blocked on 5.2, 5.3 | `docs/specs/5.4-research-agent.md` |
---

## Build order

This sequence maximizes compounding. Each item = one Claude Code session.

### Phase 1: Foundation + dashboard
```
1.1a  UUID exposure              ← patch, everything downstream needs it
1.1b  Recurring actions          ← schema migration + MCP update
1.2a  Command center scaffold    ← skeleton app, layout, supabase client, nav
1.2b  Today view                 ← action cards, overdue/upcoming, stats header
1.2c  Upcoming view              ← calendar grid, day detail, multi-table
1.2d  Thoughts view              ← thought feed, search, "→ Action" conversion
3.2   Stale loop detector (MCP)  ← quick win, no dependencies
4.2   Weekly trends (MCP)        ← quick win, improves weekly review
```

### Task engine (build before or after agent pipeline — your call)
```
1.1d-s1 Task engine schema       ← schema + runner with manual trigger
1.1d-s2 Cron triggers            ← cron evaluation in runner
1.1d-s3 LLM prompt task type     ← morning briefing / weekly review
1.1d-s4 Alert digest task type   ← daily due-date notifications
1.1d-s5 Stale loop scan          ← scheduled mode of 3.2
1.1d-s6 Deck builder             ← UNBLOCKED once 5.2 exists (routing agent replaces template)
1.1d-s7 Event trigger            ← Google Calendar integration
1.1d-s8 Trend analysis           ← scheduled mode of 4.2
```

### Phase 5: Agent pipeline
```
5.1   Triage agent               ← thought → action auto-creation
5.2   Routing agent              ← classify actions, dispatch to agents or human
5.3   Verification loop          ← agent output review + approve/reject/retry
5.4   Research agent             ← first execution agent, proves the pipeline end-to-end
```

### Phase 2: Multi-user
```
2.1   Multi-user auth            ← required before Liv access
2.2   Liv's dashboard            ← requires 2.1
2.3   Instacart export           ← standalone, anytime
```
### Phase 3: Unified app (replaces legacy dashboards)
```
3.0-s1  App shell + auth          ← Next.js skeleton, Supabase auth, role-aware nav
3.0-s2  Shared components         ← Card, DetailView, EditForm, FAB, badges
3.0-s3  Actions screen            ← first CRUD screen, proves the pattern
3.0-s4  Household screen          ← maintenance, items, vendors (3 sub-tabs)
3.0-s5  Meals screen              ← meal plans, recipes, shopping lists
3.0-s6  Morning briefing          ← composite home view, pulls from s3–s5
3.0-s7  Agent feed                ← Lee-only pipeline oversight
3.0-s8  Polish + Vercel deploy    ← responsive QA, PWA, env config

### Phase 4: Intelligence
```
4.1   Thought graph              ← route in command center
4.3   Capture sources            ← modular, whenever
```

> **Note on 1.1d-s6 (deck builder):** Originally blocked on a template definition. Now unblocked by the agent pipeline — the routing agent (5.2) handles the "what to prepare" decision, and the deck builder becomes an execution agent capability rather than a hardcoded task type.

---

## Completed features (reference only)

### Feature 1.1: Actions table ✅
Deployed. Schema at `schemas/actions/`. MCP tools: `create_action`, `update_action`, `complete_action`, `list_actions`, `search_actions`.

### Feature 1.1c: Due dates on recurring actions ✅
Design note — satisfied by Feature 1.1b's `calculateNextDue` logic. Due dates anchor to the schedule, not completion date.

### Feature 1.2-legacy: Thought explorer ✅
Deployed at `dashboards/thought-explorer/`. Timeline, heatmap, topic clusters, calendar views.

### Feature 1.3-legacy: Calendar view ✅
Deployed as tab in thought-explorer. Monthly grid, week view, day detail, multi-table aggregation.