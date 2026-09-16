export const screenshotDir = "docs/assets/agent-memory/screenshots/dashboard-walkthrough";

export const guideTitle = "OB1 Agent Dashboard Walkthrough";

export const walkthroughSections = [
  {
    slug: "dashboard-overview",
    path: "/",
    waitFor: "Total Thoughts",
    title: "Dashboard",
    eyebrow: "One operational scan",
    summary:
      "The dashboard answers the first operator question: what is in this OB1 and what needs attention now?",
    callouts: [
      "Total thoughts, type mix, and top topics show the current memory shape.",
      "Workflow counts reveal active execution state without opening the board.",
      "Recent activity confirms the newest continuity and launch notes are landing.",
    ],
  },
  {
    slug: "thoughts-table",
    path: "/thoughts",
    waitFor: "38 total thoughts",
    title: "Thoughts",
    eyebrow: "Canonical memory list",
    summary:
      "Thoughts is the raw operating table: browse, filter, and inspect the durable records that the rest of the system builds on.",
    callouts: [
      "Filters let a user slice by type, source, or importance.",
      "Nate proposal, OpenClaw registry, workflow, and audit seed data are visible together.",
      "This page is useful when a user wants the memory graph, not just agent-written memory.",
    ],
  },
  {
    slug: "workflow-board",
    path: "/kanban",
    waitFor: "Create the ClawHub publishing dry-run checklist",
    title: "Workflow",
    eyebrow: "Task and idea continuity",
    summary:
      "Workflow turns task and idea thoughts into a board so agents and humans can see what is new, active, in review, and done.",
    callouts: [
      "Cards preserve task context as memory instead of trapping it in a chat.",
      "Priority and status make handoffs faster for the next agent or human.",
      "OpenClaw launch work, screenshots, evals, and plugin distribution are represented as live work.",
    ],
  },
  {
    slug: "agent-memory-review",
    path: "/agent-memory?review_status=pending",
    waitFor: "Memories:",
    title: "Agent Memory",
    eyebrow: "Governed write-back",
    summary:
      "Agent Memory is where OB1 reviews what agents saved before those memories can influence future work.",
    callouts: [
      "Generated or inferred memories start as evidence, not instructions.",
      "Review actions confirm, downgrade, restrict, stale, or reject a memory.",
      "Nate continuity seed data shows how public context, repo map, and launch rules are kept auditable.",
    ],
  },
  {
    slug: "recall-trace",
    path:
      "/agent-memory/traces?request_id=d766f44e-5a11-4034-8ab5-3f497fa29492",
    waitFor: "Request Payload",
    title: "Recall Trace",
    eyebrow: "Debug retrieval",
    summary:
      "Recall Trace shows what an agent asked for, what OB1 returned, and which memories the agent used or ignored.",
    callouts: [
      "This is the trust surface for debugging bad agent behavior.",
      "Use policies travel with each recalled memory.",
      "The request payload keeps runtime, model, project, query, and scope visible.",
    ],
  },
  {
    slug: "duplicates-review",
    path: "/duplicates",
    waitFor: "4 pairs found",
    title: "Duplicates",
    eyebrow: "Memory graph hygiene",
    summary:
      "Duplicates keeps repeated ideas from turning OB1 into a noisy dumping ground.",
    callouts: [
      "Similarity pairs compare both versions side by side.",
      "Quality scores help decide which record should survive.",
      "The walkthrough data includes real launch-adjacent duplicate patterns.",
    ],
  },
  {
    slug: "audit-quality",
    path: "/audit",
    waitFor: "8 total",
    title: "Audit",
    eyebrow: "Quality and safety pass",
    summary:
      "Audit surfaces low-quality thoughts so bad assumptions, unsafe storage ideas, and stale scope notes do not become hidden system behavior.",
    callouts: [
      "Low scores are easy to scan and bulk-select.",
      "The seed rows intentionally include bad memory-policy ideas.",
      "This reinforces the proposal's point: remembering the wrong thing is worse than forgetting.",
    ],
  },
];

export const voiceoverScript = `
Welcome to the OB1 Agent Dashboard walkthrough.

This is Nate B. Jones continuity in product form: a personal Open Brain that can be used for real work, OpenClaw testing, and visual launch demos without turning into a wall of text.

Start on the Dashboard. This page is the operator view. It shows the size of the memory graph, the type mix, top topics, active workflow counts, and recent activity. You can see immediately that this OB1 is not just storing notes. It is tracking decisions, lessons, references, tasks, ideas, and audit candidates.

The Thoughts page is the canonical memory list. It is intentionally dense. You can filter by type, source, and importance, then open any record. This matters because OB1 is not trying to hide memory inside a chat transcript. The durable knowledge is inspectable.

Workflow turns task and idea thoughts into a board. This is where continuity becomes practical. OpenClaw launch items, screenshot work, evaluation work, plugin distribution, and personal agent setup all have status and priority. Another agent can pick up the work without reading a raw conversation.

Agent Memory is the governed write-back surface. Agent-written memories do not become instructions by default. Generated and inferred memories start as evidence. A human can confirm, downgrade, restrict, stale, or reject them.

Recall Trace is the debugging surface. It shows what the agent asked for, what OB1 returned, the use policy attached to each memory, and which memories were used or ignored. This is how we tell whether a bad output came from the prompt, the model, retrieval, stale memory, or a bad write-back.

Duplicates keeps the memory graph clean. Similar memories are compared side by side with quality scores so we can merge or dismiss repeated ideas before the graph gets noisy.

Audit is the safety pass. It catches low-quality thoughts, bad assumptions, and risky memory-policy ideas before they influence the system. That is the whole point of OB1 Agent Memory: not remembering everything, but remembering the right things in a way users can inspect and govern.

The launch story is simple. OpenClaw is the flagship runtime. OB1 is the continuity layer. The dashboard makes that continuity visible, editable, and trustworthy.
`.trim();
