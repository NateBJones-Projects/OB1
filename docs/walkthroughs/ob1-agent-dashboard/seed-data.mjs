const SOURCE_DATE = "2026-05-04T00:00:00.000Z";

function iso(hoursAgo) {
  const base = new Date(SOURCE_DATE).getTime();
  return new Date(base - hoursAgo * 60 * 60 * 1000).toISOString();
}

function thought({
  id,
  content,
  type,
  source_type,
  importance,
  quality_score,
  topics,
  people = ["Nate B. Jones", "Jonathan Edwards"],
  status = null,
  hoursAgo = 0,
  sensitivity_tier = "standard",
}) {
  const created_at = iso(hoursAgo);
  return {
    id,
    content,
    type,
    source_type,
    importance,
    quality_score,
    sensitivity_tier,
    metadata: {
      source: source_type,
      topics,
      people,
      demo_pack: "ob1-agent-dashboard-walkthrough",
      nbj_context: true,
    },
    created_at,
    updated_at: created_at,
    status,
    status_updated_at: status ? created_at : null,
  };
}

export const demoThoughts = [
  thought({
    id: "demo-1001",
    type: "decision",
    source_type: "nate_proposal_import",
    importance: 95,
    quality_score: 96,
    topics: ["agent memory", "runtime neutrality", "OpenClaw launch"],
    hoursAgo: 3,
    content:
      "OB1 Agent Memory is the runtime-neutral continuity layer for agent work. OpenClaw is the flagship launch runtime, not the boundary of the product.",
  }),
  thought({
    id: "demo-1002",
    type: "lesson",
    source_type: "dashboard_design_review",
    importance: 88,
    quality_score: 92,
    topics: ["dashboard design", "density", "NBJ OB1"],
    hoursAgo: 4,
    content:
      "Dashboard copy should be dense and operational: avoid repeated helper text, move counts into table labels, and let sidebar context do its job.",
  }),
  thought({
    id: "demo-1003",
    type: "reference",
    source_type: "openclaw_registry_research",
    importance: 86,
    quality_score: 90,
    topics: ["OpenClaw", "ClawHub", "plugin publishing"],
    hoursAgo: 5,
    content:
      "OpenClaw launch should ship both paths: a native plugin for tools and a ClawHub skill for memory hygiene, pre-task recall, and post-task write-back behavior.",
  }),
  thought({
    id: "demo-1004",
    type: "task",
    source_type: "launch_checklist",
    importance: 84,
    quality_score: 89,
    topics: ["ClawHub", "release", "publishing"],
    status: "new",
    hoursAgo: 6,
    content:
      "Create the ClawHub publishing dry-run checklist with package shape, skill metadata, screenshots, README links, and failure cases.",
  }),
  thought({
    id: "demo-1005",
    type: "task",
    source_type: "personal_openclaw_setup",
    importance: 83,
    quality_score: 88,
    topics: ["OpenClaw", "GPT-5.5", "OAuth", "DGX Spark"],
    status: "planning",
    hoursAgo: 7,
    content:
      "Map the personal OpenClaw agent setup on DGX Spark to GPT-5.5 through OAuth, keeping it Jonathan's agent while still usable for Nate testing.",
  }),
  thought({
    id: "demo-1006",
    type: "task",
    source_type: "visual_docs_workflow",
    importance: 82,
    quality_score: 91,
    topics: ["screenshots", "visual documentation", "tutorial"],
    status: "active",
    hoursAgo: 8,
    content:
      "Capture dashboard screenshots for each operational page after the NBJ OB1 micro-branding and demo data are in place.",
  }),
  thought({
    id: "demo-1007",
    type: "task",
    source_type: "agent_memory_smoke",
    importance: 80,
    quality_score: 90,
    topics: ["recall trace", "smoke harness", "trust model"],
    status: "review",
    hoursAgo: 9,
    content:
      "Validate that recall trace screenshots show what the agent asked for, what OB1 returned, and which memories were used or ignored.",
  }),
  thought({
    id: "demo-1008",
    type: "task",
    source_type: "continuity_seed_run",
    importance: 76,
    quality_score: 87,
    topics: ["seed data", "Nate continuity", "starter knowledge"],
    status: "done",
    hoursAgo: 10,
    content:
      "Seeded the Nate continuity demo pack with repo map, public reference context, OpenClaw launch rules, stale assumptions, and rejected false positives.",
  }),
  thought({
    id: "demo-1009",
    type: "idea",
    source_type: "starter_knowledge_design",
    importance: 78,
    quality_score: 85,
    topics: ["starter knowledge", "agent onboarding", "OB1 docs"],
    status: "planning",
    hoursAgo: 11,
    content:
      "New OB1 databases should be able to start with a curated starter knowledge pack: repo map, memory rules, Nate public context, and agent safety constraints.",
  }),
  thought({
    id: "demo-1010",
    type: "idea",
    source_type: "migration_assistant_note",
    importance: 62,
    quality_score: 82,
    topics: ["SQLite", "migration assistant", "personal workflows"],
    status: "new",
    hoursAgo: 12,
    content:
      "A SQLite migration assistant is a useful personal workflow feature, but it should stay separate from the v1 OpenClaw launch critical path.",
  }),
  thought({
    id: "demo-1011",
    type: "meeting",
    source_type: "nate_proposal_review",
    importance: 90,
    quality_score: 94,
    topics: ["Nate proposal", "implementation plan", "Linear"],
    hoursAgo: 13,
    content:
      "Proposal review confirmed the north star: make agent memory trustworthy enough that durable workflows can depend on it.",
  }),
  thought({
    id: "demo-1012",
    type: "person_note",
    source_type: "editorial_preference",
    importance: 72,
    quality_score: 86,
    topics: ["Nate B. Jones", "editorial voice", "documentation"],
    people: ["Nate B. Jones"],
    hoursAgo: 14,
    content:
      "Nate's audience responds to practical implementation framing: show the loop, show the contract, show why the trust labels matter, then give the setup path.",
  }),
  thought({
    id: "demo-1013",
    type: "reference",
    source_type: "repo_map",
    importance: 74,
    quality_score: 88,
    topics: ["OB1 repo", "schemas", "integrations"],
    hoursAgo: 15,
    content:
      "OB1 Agent Memory sidecars live in schemas/agent-memory; runtime integration work lives in integrations/agent-memory-api and integrations/openclaw-agent-memory.",
  }),
  thought({
    id: "demo-1014",
    type: "lesson",
    source_type: "trust_model",
    importance: 91,
    quality_score: 95,
    topics: ["trust ladder", "provenance", "review queue"],
    hoursAgo: 16,
    content:
      "Generated or inferred memory is evidence-only until a human confirms it or it is imported from a trusted source.",
  }),
  thought({
    id: "demo-1015",
    type: "decision",
    source_type: "scope_policy",
    importance: 87,
    quality_score: 93,
    topics: ["scope", "policy controls", "team safety"],
    hoursAgo: 17,
    content:
      "Project scope is the default for launch demos; personal and channel memories never promote to workspace-wide instruction automatically.",
  }),
  thought({
    id: "demo-1016",
    type: "task",
    source_type: "dashboard_walkthrough",
    importance: 77,
    quality_score: 84,
    topics: ["PDF guide", "Remotion", "ElevenLabs"],
    status: "active",
    hoursAgo: 18,
    content:
      "Build a visual walkthrough package: screenshot-first PDF guide, Remotion explainer video, and voiceover that explains each dashboard tab.",
  }),
  thought({
    id: "demo-1017",
    type: "task",
    source_type: "documentation_system",
    importance: 68,
    quality_score: 83,
    topics: ["documentation", "visual assets", "YouTube"],
    status: "review",
    hoursAgo: 19,
    content:
      "Update the docs asset README so screenshots are treated as source assets for tutorials, Linear updates, and Nate's YouTube walkthroughs.",
  }),
  thought({
    id: "demo-1018",
    type: "reference",
    source_type: "clawhub_checklist_duplicate",
    importance: 64,
    quality_score: 78,
    topics: ["ClawHub", "publishing", "checklist"],
    hoursAgo: 20,
    content:
      "ClawHub publishing checklist should verify skill metadata, installation path, README links, tool instructions, screenshots, and dry-run output.",
  }),
  thought({
    id: "demo-1019",
    type: "reference",
    source_type: "clawhub_checklist_duplicate",
    importance: 59,
    quality_score: 62,
    topics: ["ClawHub", "publishing", "checklist"],
    hoursAgo: 21,
    content:
      "Before publishing to ClawHub, verify the skill manifest, docs links, install path, screenshots, tool guidance, and dry-run logs.",
  }),
  thought({
    id: "demo-1020",
    type: "lesson",
    source_type: "screenshot_plan_duplicate",
    importance: 70,
    quality_score: 81,
    topics: ["screenshots", "recall trace", "visual docs"],
    hoursAgo: 22,
    content:
      "Screenshot coverage should include Pending, Evidence, Confirmed, Rejected, Stale, Recall Trace, Workflow, Duplicates, and Audit views.",
  }),
  thought({
    id: "demo-1021",
    type: "lesson",
    source_type: "screenshot_plan_duplicate",
    importance: 65,
    quality_score: 66,
    topics: ["screenshots", "recall trace", "visual docs"],
    hoursAgo: 23,
    content:
      "The screenshot pack needs Pending, Evidence, Confirmed, Rejected, Stale, recall trace, workflow, duplicates, audit, and dashboard overview screens.",
  }),
  thought({
    id: "demo-1022",
    type: "lesson",
    source_type: "taskflow_handoff_duplicate",
    importance: 79,
    quality_score: 89,
    topics: ["TaskFlow", "handoff", "work log"],
    hoursAgo: 24,
    content:
      "TaskFlow Work Log memory should let a second agent continue by reading compact attempts, blockers, changed files, next steps, and review needs.",
  }),
  thought({
    id: "demo-1023",
    type: "lesson",
    source_type: "taskflow_handoff_duplicate",
    importance: 58,
    quality_score: 64,
    topics: ["TaskFlow", "handoff", "work log"],
    hoursAgo: 25,
    content:
      "A TaskFlow handoff should summarize attempts, blockers, files touched, remaining review, and next steps so another agent can continue.",
  }),
  thought({
    id: "demo-1024",
    type: "lesson",
    source_type: "code_review_memory_duplicate",
    importance: 81,
    quality_score: 90,
    topics: ["Code Review Memory", "repo lessons", "OpenClaw"],
    hoursAgo: 26,
    content:
      "Code Review Memory compounds when recurring repo lessons, risky subsystems, test expectations, and maintainer corrections are saved with provenance.",
  }),
  thought({
    id: "demo-1025",
    type: "lesson",
    source_type: "code_review_memory_duplicate",
    importance: 67,
    quality_score: 68,
    topics: ["Code Review Memory", "repo lessons", "OpenClaw"],
    hoursAgo: 27,
    content:
      "OpenClaw code review gets better when repo lessons, test expectations, risky files, and maintainer corrections are stored as provenance-labeled memory.",
  }),
  thought({
    id: "demo-1026",
    type: "task",
    source_type: "evaluation_plan",
    importance: 73,
    quality_score: 86,
    topics: ["evals", "memory quality", "launch readiness"],
    status: "active",
    hoursAgo: 28,
    content:
      "Build the evaluation suite around recall precision, write-back quality, handoff success, safety and trust, and longitudinal value.",
  }),
  thought({
    id: "demo-1027",
    type: "idea",
    source_type: "youtube_asset_pack",
    importance: 69,
    quality_score: 84,
    topics: ["YouTube", "tutorial assets", "visual storytelling"],
    status: "planning",
    hoursAgo: 29,
    content:
      "Nate's YouTube tutorial should open with OB1 as the continuity layer, then animate the agent memory loop before showing the dashboard.",
  }),
  thought({
    id: "demo-1028",
    type: "task",
    source_type: "plugin_distribution",
    importance: 71,
    quality_score: 85,
    topics: ["OpenClaw plugin", "distribution", "registry"],
    status: "new",
    hoursAgo: 30,
    content:
      "Package OpenClaw plugin tools for recall, write-back, usage reporting, memory inspection, review actions, and recall trace lookup.",
  }),
  thought({
    id: "demo-1029",
    type: "decision",
    source_type: "raw_transcript_policy",
    importance: 92,
    quality_score: 97,
    topics: ["memory hygiene", "raw transcripts", "safety"],
    hoursAgo: 31,
    content:
      "Raw transcripts, model reasoning traces, secret-like strings, and large code blocks are blocked or flagged by default; OB1 stores compact memory plus source pointers.",
  }),
  thought({
    id: "demo-1030",
    type: "journal",
    source_type: "jonathan_personal_ob1",
    importance: 56,
    quality_score: 79,
    topics: ["personal OB1", "local workflows", "testing"],
    people: ["Jonathan Edwards"],
    hoursAgo: 32,
    content:
      "This database is Jonathan's personal OB1 for testing and daily use; Nate demos can run here, but the framing should not make it feel like a Nate-only workspace.",
  }),
  thought({
    id: "demo-1101",
    type: "idea",
    source_type: "audit_low_quality",
    importance: 18,
    quality_score: 12,
    topics: ["audit", "bad assumption"],
    hoursAgo: 33,
    content:
      "Maybe store every full meeting transcript directly inside memory rows so agents never need to follow source links.",
  }),
  thought({
    id: "demo-1102",
    type: "decision",
    source_type: "audit_low_quality",
    importance: 12,
    quality_score: 16,
    topics: ["audit", "bad assumption", "OpenClaw"],
    hoursAgo: 34,
    content:
      "OpenClaw should become the only thing OB1 does because it is the launch runtime.",
  }),
  thought({
    id: "demo-1103",
    type: "lesson",
    source_type: "audit_low_quality",
    importance: 22,
    quality_score: 18,
    topics: ["audit", "hidden instruction"],
    hoursAgo: 35,
    content:
      "Any model-generated lesson should be safe to inject as instruction for future agents without human review.",
  }),
  thought({
    id: "demo-1104",
    type: "reference",
    source_type: "audit_low_quality",
    importance: 20,
    quality_score: 20,
    topics: ["audit", "stale"],
    hoursAgo: 36,
    content:
      "SQLite adapter support must ship in v1 even if it slows down the OpenClaw launch path.",
  }),
  thought({
    id: "demo-1105",
    type: "task",
    source_type: "audit_low_quality",
    importance: 24,
    quality_score: 21,
    topics: ["audit", "scope"],
    status: "planning",
    hoursAgo: 37,
    content:
      "Promote all channel memories to workspace-wide scope after a successful write-back.",
  }),
  thought({
    id: "demo-1106",
    type: "journal",
    source_type: "audit_low_quality",
    importance: 15,
    quality_score: 23,
    topics: ["audit", "messy note"],
    hoursAgo: 38,
    content:
      "Dashboard thing maybe later, all pages need data, some screenshots, probably just make it look cool.",
  }),
  thought({
    id: "demo-1107",
    type: "reference",
    source_type: "audit_low_quality",
    importance: 19,
    quality_score: 24,
    topics: ["audit", "secrets"],
    hoursAgo: 39,
    content:
      "Smoke harness logs can print all access keys when debugging because the walkthrough is local.",
  }),
  thought({
    id: "demo-1108",
    type: "idea",
    source_type: "audit_low_quality",
    importance: 21,
    quality_score: 26,
    topics: ["audit", "vector store"],
    hoursAgo: 40,
    content:
      "Frame OB1 as a generic vector database with a nicer dashboard and skip provenance language.",
  }),
];

export const demoDuplicatePairs = [
  { thought_id_a: "demo-1018", thought_id_b: "demo-1019", similarity: 0.936 },
  { thought_id_a: "demo-1020", thought_id_b: "demo-1021", similarity: 0.918 },
  { thought_id_a: "demo-1022", thought_id_b: "demo-1023", similarity: 0.902 },
  { thought_id_a: "demo-1024", thought_id_b: "demo-1025", similarity: 0.897 },
];

export function buildDemoState() {
  return {
    thoughts: demoThoughts.map((item) => ({ ...structuredClone(item), id: String(item.id) })),
    duplicatePairs: demoDuplicatePairs.map((item) => ({
      ...item,
      thought_id_a: String(item.thought_id_a),
      thought_id_b: String(item.thought_id_b),
    })),
    nextThoughtId: 1200,
  };
}
