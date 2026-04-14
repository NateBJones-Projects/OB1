import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { z } from "zod";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY");
const DEFAULT_USER_ID = Deno.env.get("DEFAULT_USER_ID");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MCP_ACCESS_KEY || !DEFAULT_USER_ID) {
  throw new Error(
    "Missing one or more required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MCP_ACCESS_KEY, DEFAULT_USER_ID"
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const app = new Hono();

const LAYERS = [
  "operating_rhythms",
  "recurring_decisions",
  "dependencies",
  "institutional_knowledge",
  "friction",
] as const;

const ARTIFACTS = [
  "operating-model.json",
  "USER.md",
  "SOUL.md",
  "HEARTBEAT.md",
  "schedule-recommendations.json",
] as const;

type Layer = (typeof LAYERS)[number];

type OperatingModelEntry = {
  title: string;
  summary: string;
  cadence?: string | null;
  trigger?: string | null;
  inputs: string[];
  stakeholders: string[];
  constraints: string[];
  details: Record<string, unknown>;
  source_confidence: "confirmed" | "synthesized";
  status: "active" | "unresolved" | "superseded";
  last_validated_at?: string | null;
};

type SessionRecord = {
  id: string;
  profile_id: string;
  profile_version: number;
  session_name: string | null;
  status: string;
  current_layer: string;
  completed_layers: string[] | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ProfileRecord = {
  id: string;
  current_version: number;
  status: string;
};

type CheckpointRecord = {
  id: string;
  layer: Layer;
  checkpoint_summary: string;
  normalized_payload: Record<string, unknown>;
  profile_version: number;
  last_validated_at: string;
};

type EntryRow = {
  id: string;
  layer: Layer;
  title: string;
  summary: string;
  cadence: string | null;
  trigger: string | null;
  inputs: string[] | null;
  stakeholders: string[] | null;
  constraints: string[] | null;
  details: Record<string, unknown> | null;
  source_confidence: "confirmed" | "synthesized";
  status: "active" | "unresolved" | "superseded";
  last_validated_at: string;
  entry_order: number;
};

const baseEntrySchema = z.object({
  title: z.string().min(3).describe("Short label for this operating-model entry."),
  summary: z.string().min(10).describe("Self-contained explanation of the pattern, decision, dependency, knowledge area, or friction."),
  cadence: z.string().optional().nullable().describe("When this recurs, such as daily, weekly, monthly, quarter-end, or ad hoc."),
  trigger: z.string().optional().nullable().describe("What event, time, or condition causes this to matter."),
  inputs: z.array(z.string()).default([]).describe("Inputs needed to execute or reason about this entry."),
  stakeholders: z.array(z.string()).default([]).describe("People, teams, or systems involved in this entry."),
  constraints: z.array(z.string()).default([]).describe("Constraints, guardrails, or realities that shape this entry."),
  details: z.record(z.string(), z.any()).default({}).describe("Layer-specific detail payload."),
  source_confidence: z.enum(["confirmed", "synthesized"]).default("confirmed").describe("Use confirmed for explicit user statements and synthesized for patterns inferred from multiple examples."),
  status: z.enum(["active", "unresolved", "superseded"]).default("active").describe("Use unresolved when the user flagged uncertainty or contradiction that still needs clarification."),
  last_validated_at: z.string().optional().nullable().describe("ISO timestamp for the last user confirmation. Omit to default to now."),
});

const timeWindowSchema = z.object({
  label: z.string().optional(),
  days: z.array(z.string()).optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  notes: z.string().optional(),
});

const layerDetailValidators: Record<Layer, z.ZodTypeAny> = {
  operating_rhythms: z.object({
    time_windows: z.array(z.union([z.string(), timeWindowSchema])).min(1),
    energy_pattern: z.string().min(3),
    interruptions: z.array(z.string()).default([]),
    non_calendar_reality: z.string().min(3),
  }),
  recurring_decisions: z.object({
    decision_name: z.string().min(3),
    decision_inputs: z.array(z.string()).min(1),
    thresholds: z.array(z.string()).default([]),
    escalation_rule: z.string().min(3),
    reversible: z.union([z.boolean(), z.string()]),
  }),
  dependencies: z.object({
    dependency_owner: z.string().min(2),
    deliverable: z.string().min(3),
    needed_by: z.string().min(2),
    failure_impact: z.string().min(3),
    fallback: z.string().min(3),
  }),
  institutional_knowledge: z.object({
    knowledge_area: z.string().min(3),
    why_it_matters: z.string().min(3),
    where_it_lives: z.string().min(3),
    who_else_knows: z.array(z.string()).default([]),
    risk_if_missing: z.string().min(3),
  }),
  friction: z.object({
    frequency: z.string().min(2),
    time_cost: z.string().min(2),
    current_workaround: z.string().min(3),
    systems_involved: z.array(z.string()).default([]),
    automation_candidate: z.union([z.boolean(), z.string()]),
    priority: z.enum(["low", "medium", "high"]).optional(),
  }),
};

const server = new McpServer({
  name: "work-operating-model-activation",
  version: "1.0.0",
});

function jsonText(payload: unknown) {
  return JSON.stringify(payload, null, 2);
}

function normalizeStringList(values: string[] | null | undefined): string[] {
  return Array.from(
    new Set((values ?? []).map((value) => value.trim()).filter(Boolean))
  );
}

function normalizeEntry(layer: Layer, entry: z.infer<typeof baseEntrySchema>): OperatingModelEntry {
  layerDetailValidators[layer].parse(entry.details);

  return {
    title: entry.title.trim(),
    summary: entry.summary.trim(),
    cadence: entry.cadence?.trim() || null,
    trigger: entry.trigger?.trim() || null,
    inputs: normalizeStringList(entry.inputs),
    stakeholders: normalizeStringList(entry.stakeholders),
    constraints: normalizeStringList(entry.constraints),
    details: entry.details,
    source_confidence: entry.source_confidence,
    status: entry.status,
    last_validated_at: entry.last_validated_at ?? null,
  };
}

function renderSectionHeading(title: string): string {
  return `## ${title}\n`;
}

function renderEntries(entries: EntryRow[]): string {
  if (entries.length === 0) {
    return "- None captured yet.\n";
  }

  return entries
    .map((entry) => {
      const lines = [`- ${entry.title}: ${entry.summary}`];
      if (entry.cadence) lines.push(`  Cadence: ${entry.cadence}`);
      if (entry.trigger) lines.push(`  Trigger: ${entry.trigger}`);
      if (entry.stakeholders?.length) lines.push(`  Stakeholders: ${entry.stakeholders.join(", ")}`);
      if (entry.constraints?.length) lines.push(`  Constraints: ${entry.constraints.join(", ")}`);
      return lines.join("\n");
    })
    .join("\n");
}

function groupEntries(entries: EntryRow[]): Record<Layer, EntryRow[]> {
  const grouped = {
    operating_rhythms: [],
    recurring_decisions: [],
    dependencies: [],
    institutional_knowledge: [],
    friction: [],
  } as Record<Layer, EntryRow[]>;
  for (const entry of entries) {
    grouped[entry.layer].push(entry);
  }
  for (const layer of LAYERS) {
    grouped[layer].sort((a, b) => a.entry_order - b.entry_order);
  }
  return grouped;
}

function cadenceBucket(cadence: string | null | undefined): "daily" | "weekly" | "monthly" | "event_driven" {
  const value = (cadence ?? "").toLowerCase();
  if (value.includes("month") || value.includes("quarter")) return "monthly";
  if (value.includes("week")) return "weekly";
  if (value.includes("day") || value.includes("morning") || value.includes("afternoon") || value.includes("evening")) {
    return "daily";
  }
  return "event_driven";
}

function buildScheduleRecommendations(grouped: Record<Layer, EntryRow[]>, version: number, sessionId: string) {
  const recommendations = {
    generated_at: new Date().toISOString(),
    profile_version: version,
    session_id: sessionId,
    daily: [] as Array<Record<string, unknown>>,
    weekly: [] as Array<Record<string, unknown>>,
    monthly: [] as Array<Record<string, unknown>>,
    event_driven: [] as Array<Record<string, unknown>>,
  };

  for (const entry of grouped.operating_rhythms) {
    const bucket = cadenceBucket(entry.cadence);
    recommendations[bucket].push({
      name: entry.title,
      cadence: entry.cadence ?? "event-driven",
      trigger: entry.trigger ?? "Use the recorded operating rhythm as the trigger.",
      rationale: entry.summary,
      source_layers: ["operating_rhythms"],
    });
  }

  for (const entry of grouped.dependencies) {
    const details = entry.details ?? {};
    recommendations.event_driven.push({
      name: `Check dependency: ${entry.title}`,
      cadence: entry.cadence ?? "event-driven",
      trigger: entry.trigger ?? String(details.needed_by ?? "Before the dependent work starts"),
      rationale: String(details.failure_impact ?? entry.summary),
      source_layers: ["dependencies"],
    });
  }

  return recommendations;
}

function buildOperatingModelJson(
  profile: ProfileRecord,
  session: SessionRecord,
  checkpoints: CheckpointRecord[],
  grouped: Record<Layer, EntryRow[]>
) {
  return {
    generated_at: new Date().toISOString(),
    profile_id: profile.id,
    profile_status: profile.status,
    profile_version: session.profile_version,
    session_id: session.id,
    session_status: session.status,
    layers: Object.fromEntries(
      LAYERS.map((layer) => [
        layer,
        {
          checkpoint_summary:
            checkpoints.find((checkpoint) => checkpoint.layer === layer)?.checkpoint_summary ?? "",
          entries: grouped[layer].map((entry) => ({
            title: entry.title,
            summary: entry.summary,
            cadence: entry.cadence,
            trigger: entry.trigger,
            inputs: entry.inputs ?? [],
            stakeholders: entry.stakeholders ?? [],
            constraints: entry.constraints ?? [],
            details: entry.details ?? {},
            source_confidence: entry.source_confidence,
            status: entry.status,
            last_validated_at: entry.last_validated_at,
          })),
        },
      ])
    ),
  };
}

function buildUserMarkdown(
  session: SessionRecord,
  checkpoints: CheckpointRecord[],
  grouped: Record<Layer, EntryRow[]>
): string {
  const lines = [
    "# USER",
    "",
    `Profile version: ${session.profile_version}`,
    `Generated from session: ${session.id}`,
    "",
    renderSectionHeading("Operating Rhythms"),
    checkpoints.find((item) => item.layer === "operating_rhythms")?.checkpoint_summary ?? "",
    "",
    renderEntries(grouped.operating_rhythms),
    "",
    renderSectionHeading("Recurring Decisions"),
    checkpoints.find((item) => item.layer === "recurring_decisions")?.checkpoint_summary ?? "",
    "",
    renderEntries(grouped.recurring_decisions),
    "",
    renderSectionHeading("Dependencies"),
    checkpoints.find((item) => item.layer === "dependencies")?.checkpoint_summary ?? "",
    "",
    renderEntries(grouped.dependencies),
    "",
    renderSectionHeading("Institutional Knowledge"),
    checkpoints.find((item) => item.layer === "institutional_knowledge")?.checkpoint_summary ?? "",
    "",
    renderEntries(grouped.institutional_knowledge),
    "",
    renderSectionHeading("Friction"),
    checkpoints.find((item) => item.layer === "friction")?.checkpoint_summary ?? "",
    "",
    renderEntries(grouped.friction),
    "",
  ];

  return lines.join("\n");
}

function buildSoulMarkdown(checkpoints: CheckpointRecord[], grouped: Record<Layer, EntryRow[]>): string {
  const decisionHeuristics = grouped.recurring_decisions
    .map((entry) => {
      const details = entry.details ?? {};
      return `- ${details.decision_name ?? entry.title}: use ${Array.isArray(details.decision_inputs) ? details.decision_inputs.join(", ") : "the recorded inputs"} before acting. Escalate when ${details.escalation_rule ?? entry.status}.`;
    })
    .join("\n");

  const boundaries = [
    ...grouped.dependencies.map((entry) => `- Respect dependency timing for ${entry.title}.`),
    ...grouped.friction
      .filter((entry) => entry.status === "unresolved")
      .map((entry) => `- Treat ${entry.title} as unresolved. Ask before automating around it.`),
  ].join("\n");

  const knowledge = grouped.institutional_knowledge
    .map((entry) => `- ${entry.title}: ${entry.summary}`)
    .join("\n");

  return [
    "# SOUL",
    "",
    "## Mandate",
    checkpoints.find((item) => item.layer === "recurring_decisions")?.checkpoint_summary ??
      "Help the operator work in line with their actual patterns, not their idealized calendar.",
    "",
    "## Boundaries",
    boundaries || "- Default to asking for confirmation when an item is unresolved or time-sensitive.",
    "",
    "## Decision Heuristics",
    decisionHeuristics || "- No recurring decision heuristics captured yet.",
    "",
    "## Knowledge To Respect",
    knowledge || "- No unique institutional knowledge captured yet.",
    "",
    "## Quality Bar",
    "Prefer concrete, triggerable help. Use the user's real rhythms, explicit dependencies, and known friction before proposing action.",
    "",
  ].join("\n");
}

function buildHeartbeatMarkdown(grouped: Record<Layer, EntryRow[]>, scheduleRecommendations: ReturnType<typeof buildScheduleRecommendations>): string {
  const buildRecommendationList = (items: Array<Record<string, unknown>>) =>
    items.length === 0
      ? "- None captured.\n"
      : items
          .map(
            (item) =>
              `- ${String(item.name)}\n  Trigger: ${String(item.trigger)}\n  Why: ${String(item.rationale)}`
          )
          .join("\n");

  const dependencyChecks = grouped.dependencies
    .map((entry) => {
      const details = entry.details ?? {};
      return `- ${entry.title}: need ${String(details.deliverable ?? "the recorded dependency")} from ${String(details.dependency_owner ?? "the dependency owner")} by ${String(details.needed_by ?? entry.trigger ?? "the required time")}.`;
    })
    .join("\n");

  return [
    "# HEARTBEAT",
    "",
    "## Daily Checks",
    buildRecommendationList(scheduleRecommendations.daily),
    "",
    "## Weekly Checks",
    buildRecommendationList(scheduleRecommendations.weekly),
    "",
    "## Monthly Checks",
    buildRecommendationList(scheduleRecommendations.monthly),
    "",
    "## Event-Driven Checks",
    buildRecommendationList(scheduleRecommendations.event_driven),
    "",
    "## Dependency Watch",
    dependencyChecks || "- No dependency watches captured yet.",
    "",
  ].join("\n");
}

async function getProfile(userId: string): Promise<ProfileRecord | null> {
  const { data, error } = await supabase
    .from("operating_model_profiles")
    .select("id, current_version, status")
    .eq("user_id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Failed to load profile: ${error.message}`);
  }

  return data as ProfileRecord;
}

async function getLatestSession(userId: string): Promise<SessionRecord | null> {
  const { data, error } = await supabase
    .from("operating_model_sessions")
    .select("id, profile_id, profile_version, session_name, status, current_layer, completed_layers, created_at, updated_at, completed_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load latest session: ${error.message}`);
  }

  return (data as SessionRecord | null) ?? null;
}

async function getSessionById(sessionId: string): Promise<SessionRecord> {
  const { data, error } = await supabase
    .from("operating_model_sessions")
    .select("id, profile_id, profile_version, session_name, status, current_layer, completed_layers, created_at, updated_at, completed_at")
    .eq("id", sessionId)
    .single();

  if (error) {
    throw new Error(`Failed to load session: ${error.message}`);
  }

  return data as SessionRecord;
}

async function getSessionForVersion(userId: string, version: number): Promise<SessionRecord | null> {
  const { data, error } = await supabase
    .from("operating_model_sessions")
    .select("id, profile_id, profile_version, session_name, status, current_layer, completed_layers, created_at, updated_at, completed_at")
    .eq("user_id", userId)
    .eq("profile_version", version)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load session for version ${version}: ${error.message}`);
  }

  return (data as SessionRecord | null) ?? null;
}

async function getCheckpoints(sessionId: string): Promise<CheckpointRecord[]> {
  const { data, error } = await supabase
    .from("operating_model_layer_checkpoints")
    .select("id, layer, checkpoint_summary, normalized_payload, profile_version, last_validated_at")
    .eq("session_id", sessionId)
    .eq("status", "approved")
    .order("updated_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load checkpoints: ${error.message}`);
  }

  return (data as CheckpointRecord[]) ?? [];
}

async function getEntries(sessionId: string): Promise<EntryRow[]> {
  const { data, error } = await supabase
    .from("operating_model_entries")
    .select("id, layer, title, summary, cadence, trigger, inputs, stakeholders, constraints, details, source_confidence, status, last_validated_at, entry_order")
    .eq("session_id", sessionId)
    .order("entry_order", { ascending: true });

  if (error) {
    throw new Error(`Failed to load entries: ${error.message}`);
  }

  return (data as EntryRow[]) ?? [];
}

async function resolveVersion(userId: string, requestedVersion?: number): Promise<{
  profile: ProfileRecord | null;
  session: SessionRecord | null;
  version: number | null;
}> {
  const profile = await getProfile(userId);

  if (requestedVersion) {
    const session = await getSessionForVersion(userId, requestedVersion);
    return { profile, session, version: session?.profile_version ?? requestedVersion };
  }

  const latestSession = await getLatestSession(userId);
  if (latestSession && (!profile || latestSession.profile_version >= profile.current_version)) {
    return { profile, session: latestSession, version: latestSession.profile_version };
  }

  if (profile && profile.current_version > 0) {
    const session = await getSessionForVersion(userId, profile.current_version);
    return { profile, session, version: profile.current_version };
  }

  return { profile, session: latestSession, version: latestSession?.profile_version ?? null };
}

server.tool(
  "start_operating_model_session",
  "Start the work operating model interview or resume the latest in-progress session. Use this before asking layer questions so the agent knows whether it is resuming or beginning fresh.",
  {
    session_name: z.string().optional().describe("Optional label for this run, such as 'April 2026 operating model refresh'."),
  },
  async ({ session_name }) => {
    try {
      const { data, error } = await supabase.rpc("operating_model_start_session", {
        p_user_id: DEFAULT_USER_ID,
        p_session_name: session_name ?? null,
      });

      if (error) {
        throw new Error(`Failed to start or resume session: ${error.message}`);
      }

      return {
        content: [{ type: "text", text: jsonText(data) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: jsonText({ error: message }) }],
        isError: true,
      };
    }
  }
);

server.tool(
  "save_operating_model_layer",
  "Persist an approved layer checkpoint after the user confirms it. Use this only after you have shown a checkpoint summary, received explicit confirmation, and normalized the layer into canonical entries.",
  {
    session_id: z.string().uuid().describe("The active operating-model session ID returned by start_operating_model_session."),
    layer: z.enum(LAYERS).describe("Which of the five layers you are saving."),
    checkpoint_summary: z.string().min(20).describe("Approved layer summary shown to the user before saving."),
    entries: z.array(baseEntrySchema).min(1).describe("Canonical structured entries for this layer."),
  },
  async ({ session_id, layer, checkpoint_summary, entries }) => {
    try {
      const normalizedEntries = entries.map((entry) => normalizeEntry(layer, entry));

      const { data, error } = await supabase.rpc("operating_model_save_layer", {
        p_session_id: session_id,
        p_layer: layer,
        p_checkpoint_summary: checkpoint_summary.trim(),
        p_entries: normalizedEntries,
      });

      if (error) {
        throw new Error(`Failed to save layer: ${error.message}`);
      }

      return {
        content: [{ type: "text", text: jsonText(data) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: jsonText({ error: message }) }],
        isError: true,
      };
    }
  }
);

server.tool(
  "query_operating_model",
  "Read the current operating model or a filtered slice of it. Use this during contradiction checks, resume flows, or when you need the latest structured profile by layer, keyword, cadence, stakeholder, unresolved status, or friction priority.",
  {
    layer: z.enum(LAYERS).optional().describe("Restrict results to one layer."),
    keyword: z.string().optional().describe("Keyword to match against title, summary, trigger, arrays, and detail text."),
    cadence: z.string().optional().describe("Filter to entries whose cadence mentions this text."),
    stakeholder: z.string().optional().describe("Filter to entries that involve this stakeholder."),
    unresolved_only: z.boolean().optional().describe("Only return unresolved entries."),
    friction_priority: z.enum(["low", "medium", "high"]).optional().describe("Only meaningful for the friction layer. Filters on details.priority."),
    profile_version: z.number().int().positive().optional().describe("Read a specific version instead of the latest available version."),
  },
  async ({ layer, keyword, cadence, stakeholder, unresolved_only, friction_priority, profile_version }) => {
    try {
      const resolved = await resolveVersion(DEFAULT_USER_ID, profile_version);

      if (!resolved.session || !resolved.version) {
        return {
          content: [{ type: "text", text: jsonText({ message: "No operating model profile has been started yet." }) }],
        };
      }

      const checkpoints = await getCheckpoints(resolved.session.id);
      const entries = await getEntries(resolved.session.id);

      let filtered = entries;

      if (layer) {
        filtered = filtered.filter((entry) => entry.layer === layer);
      }

      if (cadence) {
        const needle = cadence.toLowerCase();
        filtered = filtered.filter((entry) => (entry.cadence ?? "").toLowerCase().includes(needle));
      }

      if (stakeholder) {
        const needle = stakeholder.toLowerCase();
        filtered = filtered.filter((entry) =>
          (entry.stakeholders ?? []).some((item) => item.toLowerCase().includes(needle))
        );
      }

      if (unresolved_only) {
        filtered = filtered.filter((entry) => entry.status === "unresolved");
      }

      if (friction_priority) {
        filtered = filtered.filter(
          (entry) =>
            entry.layer === "friction" &&
            String((entry.details ?? {}).priority ?? "").toLowerCase() === friction_priority
        );
      }

      if (keyword) {
        const needle = keyword.toLowerCase();
        filtered = filtered.filter((entry) => {
          const haystack = [
            entry.title,
            entry.summary,
            entry.cadence ?? "",
            entry.trigger ?? "",
            ...(entry.inputs ?? []),
            ...(entry.stakeholders ?? []),
            ...(entry.constraints ?? []),
            JSON.stringify(entry.details ?? {}),
          ]
            .join(" ")
            .toLowerCase();

          return haystack.includes(needle);
        });
      }

      const response = {
        profile_status: resolved.profile?.status ?? "draft",
        profile_version: resolved.version,
        session_id: resolved.session.id,
        session_status: resolved.session.status,
        completed_layers: resolved.session.completed_layers ?? [],
        pending_layer: resolved.session.current_layer,
        checkpoint_count: checkpoints.length,
        entry_count: filtered.length,
        checkpoints,
        entries: filtered,
      };

      return {
        content: [{ type: "text", text: jsonText(response) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: jsonText({ error: message }) }],
        isError: true,
      };
    }
  }
);

server.tool(
  "generate_operating_model_exports",
  "Render and store the canonical operating-model exports after all five layers are approved and contradictions are resolved. Use this at the end of the workflow to return JSON and markdown artifacts.",
  {
    session_id: z.string().uuid().optional().describe("Optional session ID to export. Defaults to the latest active or completed session."),
    final_review_notes: z.string().optional().describe("Optional notes from the final contradiction pass to store with the export metadata."),
  },
  async ({ session_id, final_review_notes }) => {
    try {
      const session = session_id
        ? await getSessionById(session_id)
        : (await resolveVersion(DEFAULT_USER_ID)).session;

      if (!session) {
        throw new Error("No operating-model session is available to export.");
      }

      const profile = await getProfile(DEFAULT_USER_ID);
      if (!profile) {
        throw new Error("No operating-model profile found.");
      }

      const checkpoints = await getCheckpoints(session.id);
      const completedLayerSet = new Set(checkpoints.map((item) => item.layer));
      const missingLayers = LAYERS.filter((layer) => !completedLayerSet.has(layer));
      if (missingLayers.length > 0) {
        throw new Error(`Cannot generate exports yet. Missing approved layers: ${missingLayers.join(", ")}`);
      }

      const entries = await getEntries(session.id);
      const grouped = groupEntries(entries);
      const scheduleRecommendations = buildScheduleRecommendations(grouped, session.profile_version, session.id);
      const operatingModelJson = buildOperatingModelJson(profile, session, checkpoints, grouped);
      const exportsMap: Record<(typeof ARTIFACTS)[number], string> = {
        "operating-model.json": jsonText(operatingModelJson),
        "USER.md": buildUserMarkdown(session, checkpoints, grouped),
        "SOUL.md": buildSoulMarkdown(checkpoints, grouped),
        "HEARTBEAT.md": buildHeartbeatMarkdown(grouped, scheduleRecommendations),
        "schedule-recommendations.json": jsonText(scheduleRecommendations),
      };

      const upsertRows = ARTIFACTS.map((artifactName) => ({
        profile_id: session.profile_id,
        session_id: session.id,
        user_id: DEFAULT_USER_ID,
        profile_version: session.profile_version,
        artifact_name: artifactName,
        content: exportsMap[artifactName],
        content_type: artifactName.endsWith(".json") ? "application/json" : "text/markdown",
        metadata: {
          generated_at: new Date().toISOString(),
          final_review_notes: final_review_notes ?? null,
        },
      }));

      const { error: exportError } = await supabase
        .from("operating_model_exports")
        .upsert(upsertRows, { onConflict: "session_id,artifact_name" });

      if (exportError) {
        throw new Error(`Failed to store exports: ${exportError.message}`);
      }

      const { error: sessionError } = await supabase
        .from("operating_model_sessions")
        .update({
          status: "completed",
          current_layer: "complete",
          completed_at: new Date().toISOString(),
        })
        .eq("id", session.id);

      if (sessionError) {
        throw new Error(`Failed to finalize session: ${sessionError.message}`);
      }

      const { error: profileError } = await supabase
        .from("operating_model_profiles")
        .update({
          current_version: session.profile_version,
          status: "active",
        })
        .eq("id", profile.id);

      if (profileError) {
        throw new Error(`Failed to update profile version: ${profileError.message}`);
      }

      return {
        content: [
          {
            type: "text",
            text: jsonText({
              session_id: session.id,
              profile_version: session.profile_version,
              exports: exportsMap,
            }),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: jsonText({ error: message }) }],
        isError: true,
      };
    }
  }
);

app.get("/health", (c) =>
  c.json({ status: "ok", service: "Work Operating Model Activation MCP", version: "1.0.0" })
);

app.all("*", async (c) => {
  if (!c.req.header("accept")?.includes("text/event-stream")) {
    const headers = new Headers(c.req.raw.headers);
    headers.set("Accept", "application/json, text/event-stream");
    const patched = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: c.req.raw.body,
      // @ts-ignore Deno stream request compatibility
      duplex: "half",
    });
    Object.defineProperty(c.req, "raw", { value: patched, writable: true });
  }

  const key =
    c.req.query("key") ||
    c.req.header("x-brain-key") ||
    c.req.header("x-access-key");

  if (!key || key !== MCP_ACCESS_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
