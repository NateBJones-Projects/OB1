/**
 * crm-mcp — Standalone MCP Edge Function exposing the CRM truth-layer tools.
 *
 * Adds nine tools for the editable-contacts + field-proposal CRM introduced by
 * the `schemas/crm-core` and `schemas/crm-engagement` schemas. The headline is
 * the truth layer: machine/agent writes PROPOSE; a human ACCEPTS. An agent can
 * never silently overwrite a human-curated contact field.
 *
 *   crm_search_contacts   — search the editable contact book (read).
 *   crm_get_contact       — full contact profile: record, methods, aliases,
 *                           relationship items, interactions, health (read).
 *   crm_next_actions      — keep-in-touch suggestion queue (read).
 *   crm_prepare_briefing   — a concise relationship briefing before reaching out
 *                           (read; composed from the read RPCs above).
 *   crm_add_note          — attach a relationship note to a contact (write).
 *   crm_add_task          — add a follow-up task / reminder (write).
 *   crm_log_interaction   — log a real call / meeting / message (write).
 *   crm_resolve_proposal  — accept or reject a pending field proposal (the
 *                           human decision point of the truth layer).
 *   crm_set_field         — patch contact fields. Because the caller is a
 *                           machine (origin='extraction'), a write over a
 *                           human-set field is DIVERTED to a proposal, not
 *                           applied. This is the propose/resolve flow.
 *
 * Why a separate Edge Function?
 *   The core `open-brain` MCP server (server/index.ts) is curated and does not
 *   expose the CRM surface. This integration adds it without modifying the core
 *   server. Deploy it alongside your main connector and register it as a
 *   separate custom connector in Claude Desktop (Settings → Connectors → Add
 *   custom connector → paste URL).
 *
 * Depends on: the `schemas/crm-core` schema (editable contacts + field
 *   proposals) and the `schemas/crm-engagement` schema (notes, tasks, dates,
 *   interactions, keep-in-touch). Apply BOTH before deploying this function.
 *
 * The truth layer (why writes can "propose"):
 *   crm_set_field always patches with p_origin='extraction' — agents are
 *   machines, never the canonical authority. If the target field is human-set
 *   (origin='manual'), the DB RPC (crm_patch_contact_record) does NOT overwrite
 *   it; it diverts the value into a field proposal and reports it under
 *   "proposed". A locked field is reported under "conflicts" and is not
 *   touched. A human later accepts/rejects via crm_resolve_proposal. This tool
 *   surfaces applied / proposed / conflicts verbatim — and must NOT retry a
 *   proposed write.
 *
 * ID contract:
 *   Open Brain ids are UUIDs. Every contact_id / proposal_id / thought_id is
 *   validated as a UUID string and passed through untouched — never parsed as a
 *   number.
 *
 * Auth: x-brain-key header OR ?key=... URL query parameter (same pattern as the
 *   core server — see server/index.ts).
 *
 * Env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   MCP_ACCESS_KEY
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// The actor recorded against every write through these tools. Shows up in the
// crm_contact_change_log audit trail so CRM edits made by an agent are
// attributable.
const CRM_ACTOR = "crm-mcp";

// Scalar contact fields the patch RPC accepts. Mirrors the c_known_keys set in
// crm_patch_contact_record (schemas/crm-core); a key outside this list is
// rejected by the RPC with "unknown contact field".
const CRM_PATCH_FIELDS = [
  "display_name",
  "preferred_name",
  "given_name",
  "family_name",
  "pronouns",
  "job_title",
  "organization_name",
  "location",
  "relationship_note",
  "lifecycle_status",
  "privacy_tier",
  "owner_label",
] as const;

type ContactRow = {
  id: string;
  display_name: string;
  canonical_email: string | null;
  organization_name: string | null;
  job_title: string | null;
  location: string | null;
  lifecycle_status: string;
  privacy_tier: string;
  updated_at: string;
};

function toErr(label: string, message: string) {
  return {
    content: [{ type: "text" as const, text: `${label}: ${message}` }],
    isError: true,
  };
}

// --- MCP Server Setup (built per request — see #261) ---

function buildServer(): McpServer {
  const server = new McpServer({
    name: "open-brain-crm",
    version: "1.0.0",
  });

  // Tool 1: crm_search_contacts — search the editable contact book.
  server.registerTool(
    "crm_search_contacts",
    {
      title: "Search CRM Contacts",
      description:
        "Search the editable CRM contact book by name, email, organization, job title, or location. Returns the contact_id (a UUID) you need for the other CRM tools. Restricted-tier contacts are excluded by default. Read-only.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z
          .string()
          .max(200)
          .optional()
          .describe("Optional text to match against name, email, org, title, or location"),
        lifecycle_status: z
          .enum(["active", "archived"])
          .optional()
          .describe("Filter by lifecycle status (default: active only when omitted)"),
        include_restricted: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include restricted-privacy-tier contacts (default false)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe("Max rows to return (default 10, max 50)"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe("Pagination offset (default 0)"),
      },
    },
    async ({ query, lifecycle_status, include_restricted, limit, offset }) => {
      try {
        const lim = limit ?? 10;
        const off = offset ?? 0;

        let q = supabase
          .from("crm_contacts")
          .select(
            "id, display_name, canonical_email, organization_name, job_title, location, lifecycle_status, privacy_tier, updated_at",
          )
          .order("updated_at", { ascending: false })
          .range(off, off + lim - 1);

        if (lifecycle_status) {
          q = q.eq("lifecycle_status", lifecycle_status);
        } else {
          q = q.eq("lifecycle_status", "active");
        }

        if (!include_restricted) {
          q = q.neq("privacy_tier", "restricted");
        }

        const term = query?.trim();
        if (term) {
          // Escape PostgREST `or` reserved chars (commas / parens) so a search
          // string can't break out of the filter expression.
          const safe = term.replace(/[,()*]/g, " ").trim();
          if (safe) {
            const pat = `%${safe}%`;
            q = q.or(
              [
                `display_name.ilike.${pat}`,
                `canonical_email.ilike.${pat}`,
                `organization_name.ilike.${pat}`,
                `job_title.ilike.${pat}`,
                `location.ilike.${pat}`,
              ].join(","),
            );
          }
        }

        const { data, error } = await q;
        if (error) return toErr("crm_search_contacts error", error.message);

        const rows = (data ?? []) as ContactRow[];
        const text =
          rows.length === 0
            ? "No CRM contacts found."
            : rows
                .map((c, i) => {
                  const org = c.organization_name ? ` — ${c.organization_name}` : "";
                  const title = c.job_title ? ` (${c.job_title})` : "";
                  return `${off + i + 1}. ${c.display_name}${title}${org} [${c.privacy_tier}, id=${c.id}]`;
                })
                .join("\n");

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: { results: rows, count: rows.length, offset: off, limit: lim },
        };
      } catch (err: unknown) {
        return toErr("Error", (err as Error).message);
      }
    },
  );

  // Tool 2: crm_get_contact — full profile for one contact.
  server.registerTool(
    "crm_get_contact",
    {
      title: "Get CRM Contact",
      description:
        "Fetch a CRM contact's full profile by contact_id (a UUID): the canonical record, contact methods, aliases, relationship items (notes / tasks / important dates), recent logged interactions, and a derived relationship-health summary. Read-only.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        contact_id: z
          .string()
          .uuid()
          .describe("CRM contact UUID (from crm_search_contacts)"),
        interaction_limit: z
          .number()
          .int()
          .min(0)
          .max(50)
          .optional()
          .default(10)
          .describe("How many recent interactions to include (default 10)"),
        include_restricted: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include restricted-tier relationship items (default false)"),
      },
    },
    async ({ contact_id, interaction_limit, include_restricted }) => {
      try {
        const contactId = contact_id.trim();
        const excludeRestricted = !include_restricted;
        const intLimit = interaction_limit ?? 10;

        const { data: contactData, error: contactErr } = await supabase.rpc(
          "crm_get_contact",
          { p_contact_id: contactId },
        );
        if (contactErr) return toErr("crm_get_contact error", contactErr.message);

        const contactRows = (contactData ?? []) as Array<{
          record: Record<string, unknown> | null;
          methods: unknown;
          aliases: unknown;
        }>;
        const contact = contactRows[0];
        if (!contact || !contact.record) {
          return toErr("crm_get_contact", `contact ${contactId} not found`);
        }

        const { data: itemsData, error: itemsErr } = await supabase.rpc(
          "crm_contact_relationship_items",
          { p_contact_id: contactId, p_exclude_restricted: excludeRestricted },
        );
        if (itemsErr) return toErr("crm_contact_relationship_items error", itemsErr.message);
        const items = ((itemsData ?? []) as Array<Record<string, unknown>>)[0] ?? {
          notes: [],
          tasks: [],
          important_dates: [],
        };

        const { data: healthData, error: healthErr } = await supabase.rpc(
          "crm_contact_relationship_health",
          { p_contact_id: contactId, p_exclude_restricted: excludeRestricted },
        );
        if (healthErr) return toErr("crm_contact_relationship_health error", healthErr.message);

        let interactions: Array<Record<string, unknown>> = [];
        if (intLimit > 0) {
          const { data: intData, error: intErr } = await supabase.rpc(
            "crm_contact_interactions",
            {
              p_contact_id: contactId,
              p_limit: intLimit,
              p_offset: 0,
              p_exclude_restricted: excludeRestricted,
            },
          );
          if (intErr) return toErr("crm_contact_interactions error", intErr.message);
          interactions = (intData ?? []) as Array<Record<string, unknown>>;
        }

        const rec = contact.record as Record<string, unknown>;
        const health = (healthData ?? {}) as Record<string, unknown>;
        const noteCount = Array.isArray(items.notes) ? items.notes.length : 0;
        const taskCount = Array.isArray(items.tasks) ? items.tasks.length : 0;
        const dateCount = Array.isArray(items.important_dates)
          ? items.important_dates.length
          : 0;

        const text = [
          `${rec.display_name} [${rec.privacy_tier}, ${rec.lifecycle_status}, id=${rec.id}]`,
          rec.organization_name || rec.job_title
            ? `  ${[rec.job_title, rec.organization_name].filter(Boolean).join(" @ ")}`
            : null,
          `  Health: ${health.status ?? "unknown"} (score ${health.score ?? 0}) — next: ${health.next_action_label ?? "n/a"}`,
          `  Notes: ${noteCount} · Tasks: ${taskCount} · Important dates: ${dateCount} · Recent interactions: ${interactions.length}`,
        ]
          .filter(Boolean)
          .join("\n");

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            record: contact.record,
            methods: contact.methods,
            aliases: contact.aliases,
            notes: items.notes,
            tasks: items.tasks,
            important_dates: items.important_dates,
            interactions,
            relationship_health: health,
          },
        };
      } catch (err: unknown) {
        return toErr("Error", (err as Error).message);
      }
    },
  );

  // Tool 3: crm_next_actions — keep-in-touch suggestion queue.
  server.registerTool(
    "crm_next_actions",
    {
      title: "CRM Next Actions",
      description:
        "List keep-in-touch suggestions: contacts with overdue/due-soon follow-up tasks, upcoming important dates, or relationships that have gone quiet. Use to decide who to reach out to next. Restricted-tier contacts are excluded by default. Read-only.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        status: z
          .enum(["open", "snoozed", "dismissed", "converted", "all"])
          .optional()
          .default("open")
          .describe("Which suggestions to return (default open)"),
        contact_id: z
          .string()
          .uuid()
          .optional()
          .describe("Restrict to a single contact UUID"),
        include_restricted: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include restricted-tier contacts (default false)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe("Max rows to return (default 10, max 50)"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe("Pagination offset (default 0)"),
      },
    },
    async ({ status, contact_id, include_restricted, limit, offset }) => {
      try {
        const lim = limit ?? 10;
        const off = offset ?? 0;

        const { data, error } = await supabase.rpc("crm_keep_in_touch_suggestions", {
          p_limit: lim,
          p_offset: off,
          p_status: status ?? "open",
          p_contact_id: contact_id?.trim() ?? null,
          p_exclude_restricted: !include_restricted,
        });
        if (error) return toErr("crm_keep_in_touch_suggestions error", error.message);

        const rows = (data ?? []) as Array<Record<string, unknown>>;
        const total = rows.length > 0 ? Number(rows[0].total_count ?? rows.length) : 0;
        const text =
          rows.length === 0
            ? "No CRM next actions found."
            : rows
                .map((s, i) => {
                  return `${off + i + 1}. [${s.priority}] ${s.display_name}: ${s.summary} (key=${s.suggestion_key})`;
                })
                .join("\n");

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            results: rows,
            count: rows.length,
            total,
            offset: off,
            limit: lim,
            has_more: off + rows.length < total,
          },
        };
      } catch (err: unknown) {
        return toErr("Error", (err as Error).message);
      }
    },
  );

  // Tool 4: crm_prepare_briefing — a concise relationship briefing.
  server.registerTool(
    "crm_prepare_briefing",
    {
      title: "Prepare CRM Briefing",
      description:
        "Prepare a concise relationship briefing for one contact before reaching out: who they are, relationship health, open tasks, upcoming dates, recent interactions, and any keep-in-touch suggestion. Composed entirely from visible CRM data (restricted items excluded by default). Read-only.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        contact_id: z
          .string()
          .uuid()
          .describe("CRM contact UUID (from crm_search_contacts)"),
        focus: z
          .string()
          .max(160)
          .optional()
          .describe("Optional reason for the briefing, e.g. 'upcoming intro call'"),
        interaction_limit: z
          .number()
          .int()
          .min(0)
          .max(20)
          .optional()
          .default(5)
          .describe("How many recent interactions to summarize (default 5)"),
        include_restricted: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include restricted-tier items (default false)"),
      },
    },
    async ({ contact_id, focus, interaction_limit, include_restricted }) => {
      try {
        const contactId = contact_id.trim();
        const excludeRestricted = !include_restricted;
        const intLimit = interaction_limit ?? 5;

        const { data: contactData, error: contactErr } = await supabase.rpc(
          "crm_get_contact",
          { p_contact_id: contactId },
        );
        if (contactErr) return toErr("crm_get_contact error", contactErr.message);
        const contact = ((contactData ?? []) as Array<{ record: Record<string, unknown> | null }>)[0];
        if (!contact || !contact.record) {
          return toErr("crm_prepare_briefing", `contact ${contactId} not found`);
        }
        const rec = contact.record as Record<string, unknown>;

        const { data: itemsData, error: itemsErr } = await supabase.rpc(
          "crm_contact_relationship_items",
          { p_contact_id: contactId, p_exclude_restricted: excludeRestricted },
        );
        if (itemsErr) return toErr("crm_contact_relationship_items error", itemsErr.message);
        const items = ((itemsData ?? []) as Array<Record<string, unknown>>)[0] ?? {
          notes: [],
          tasks: [],
          important_dates: [],
        };

        const { data: healthData, error: healthErr } = await supabase.rpc(
          "crm_contact_relationship_health",
          { p_contact_id: contactId, p_exclude_restricted: excludeRestricted },
        );
        if (healthErr) return toErr("crm_contact_relationship_health error", healthErr.message);
        const health = (healthData ?? {}) as Record<string, unknown>;

        const { data: sugData, error: sugErr } = await supabase.rpc(
          "crm_keep_in_touch_suggestions",
          {
            p_limit: 1,
            p_offset: 0,
            p_status: "open",
            p_contact_id: contactId,
            p_exclude_restricted: excludeRestricted,
          },
        );
        if (sugErr) return toErr("crm_keep_in_touch_suggestions error", sugErr.message);
        const suggestion = ((sugData ?? []) as Array<Record<string, unknown>>)[0] ?? null;

        let interactions: Array<Record<string, unknown>> = [];
        if (intLimit > 0) {
          const { data: intData, error: intErr } = await supabase.rpc(
            "crm_contact_interactions",
            {
              p_contact_id: contactId,
              p_limit: intLimit,
              p_offset: 0,
              p_exclude_restricted: excludeRestricted,
            },
          );
          if (intErr) return toErr("crm_contact_interactions error", intErr.message);
          interactions = (intData ?? []) as Array<Record<string, unknown>>;
        }

        const notes = Array.isArray(items.notes) ? items.notes : [];
        const tasks = Array.isArray(items.tasks) ? items.tasks : [];
        const dates = Array.isArray(items.important_dates) ? items.important_dates : [];

        const lines: string[] = [];
        lines.push(`Briefing: ${rec.display_name}${focus ? ` — focus: ${focus.trim()}` : ""}`);
        const who = [rec.job_title, rec.organization_name].filter(Boolean).join(" @ ");
        if (who) lines.push(`Who: ${who}`);
        if (rec.location) lines.push(`Location: ${rec.location}`);
        lines.push(
          `Relationship health: ${health.status ?? "unknown"} (score ${health.score ?? 0}). Next: ${health.next_action_label ?? "n/a"}.`,
        );
        if (suggestion) lines.push(`Keep-in-touch: ${suggestion.summary}`);

        const openTasks = tasks.filter((t) => (t as Record<string, unknown>).status === "open");
        if (openTasks.length) {
          lines.push(`Open tasks (${openTasks.length}):`);
          for (const t of openTasks.slice(0, 5)) {
            const tr = t as Record<string, unknown>;
            lines.push(`  - ${tr.title}${tr.due_at ? ` (due ${tr.due_at})` : ""}`);
          }
        }
        if (dates.length) {
          lines.push(`Important dates (${dates.length}):`);
          for (const d of dates.slice(0, 5)) {
            const dr = d as Record<string, unknown>;
            lines.push(`  - ${dr.label}: ${dr.date_value} (${dr.date_kind})`);
          }
        }
        const pinnedNotes = notes.filter((n) => (n as Record<string, unknown>).pinned);
        const shownNotes = (pinnedNotes.length ? pinnedNotes : notes).slice(0, 3);
        if (shownNotes.length) {
          lines.push(`Notes:`);
          for (const n of shownNotes) {
            const nr = n as Record<string, unknown>;
            const body = String(nr.body ?? "");
            lines.push(`  - ${body.length > 200 ? body.slice(0, 200) + "…" : body}`);
          }
        }
        if (interactions.length) {
          lines.push(`Recent interactions (${interactions.length}):`);
          for (const it of interactions.slice(0, 5)) {
            const ir = it as Record<string, unknown>;
            lines.push(`  - ${ir.occurred_at} [${ir.kind}] ${ir.summary}`);
          }
        }

        const briefing = lines.join("\n");
        return {
          content: [{ type: "text" as const, text: briefing }],
          structuredContent: {
            briefing,
            contact: rec,
            relationship_health: health,
            keep_in_touch_suggestion: suggestion,
            open_tasks: openTasks,
            important_dates: dates,
            notes: shownNotes,
            recent_interactions: interactions,
          },
        };
      } catch (err: unknown) {
        return toErr("Error", (err as Error).message);
      }
    },
  );

  // Tool 5: crm_add_note — attach a relationship note (write).
  server.registerTool(
    "crm_add_note",
    {
      title: "CRM Add Note",
      description:
        "Add a relationship note to a CRM contact. Use to record a context-preserving observation. Notes are CRM-layer data (not thought evidence) and appear immediately in the contact's relationship items.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        contact_id: z.string().uuid().describe("CRM contact UUID"),
        body: z.string().min(1).max(5000).describe("Note text (plain prose, max 5000 chars)"),
        note_type: z
          .enum(["relationship_note", "private_note", "context"])
          .optional()
          .default("relationship_note")
          .describe("Note type (default relationship_note)"),
        pinned: z
          .boolean()
          .optional()
          .default(false)
          .describe("Pin this note to the top of the contact view"),
        privacy_tier: z
          .enum(["standard", "sensitive", "restricted"])
          .optional()
          .default("standard")
          .describe("Privacy tier for this note (default standard)"),
      },
    },
    async ({ contact_id, body, note_type, pinned, privacy_tier }) => {
      try {
        const { data, error } = await supabase.rpc("crm_add_contact_note", {
          p_contact_id: contact_id.trim(),
          p_body: body,
          p_note_type: note_type ?? "relationship_note",
          p_pinned: pinned ?? false,
          p_privacy_tier: privacy_tier ?? "standard",
          p_actor: CRM_ACTOR,
        });
        if (error) return toErr("crm_add_contact_note error", error.message);

        const note = (data ?? {}) as Record<string, unknown>;
        return {
          content: [
            {
              type: "text" as const,
              text: `Note added to contact ${contact_id.trim()} (pinned=${pinned ?? false}, id=${note.id ?? "?"}).`,
            },
          ],
          structuredContent: { note, contact_id: contact_id.trim() },
        };
      } catch (err: unknown) {
        return toErr("Error", (err as Error).message);
      }
    },
  );

  // Tool 6: crm_add_task — add a follow-up task (write).
  server.registerTool(
    "crm_add_task",
    {
      title: "CRM Add Task",
      description:
        "Add a follow-up task or reminder for a CRM contact. Use when you identify an action item (e.g. 'send intro email', 'schedule call'). The task appears in the contact's relationship items and feeds relationship health / keep-in-touch.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        contact_id: z.string().uuid().describe("CRM contact UUID"),
        title: z.string().min(1).max(300).describe("Task title (imperative: 'Send intro email')"),
        description: z.string().max(2000).optional().describe("Optional task details / context"),
        task_type: z
          .enum(["follow_up", "reminder", "todo"])
          .optional()
          .default("follow_up")
          .describe("Task type (default follow_up)"),
        due_at: z
          .string()
          .datetime({ offset: true })
          .optional()
          .describe("Optional ISO 8601 due date/time, e.g. 2026-07-01T17:00:00Z"),
        priority: z
          .enum(["low", "normal", "high"])
          .optional()
          .default("normal")
          .describe("Priority (default normal)"),
        privacy_tier: z
          .enum(["standard", "sensitive", "restricted"])
          .optional()
          .default("standard")
          .describe("Privacy tier (default standard)"),
      },
    },
    async ({ contact_id, title, description, task_type, due_at, priority, privacy_tier }) => {
      try {
        const { data, error } = await supabase.rpc("crm_add_contact_task", {
          p_contact_id: contact_id.trim(),
          p_title: title,
          p_description: description?.trim() || null,
          p_task_type: task_type ?? "follow_up",
          p_status: "open",
          p_due_at: due_at ?? null,
          p_snoozed_until: null,
          p_priority: priority ?? "normal",
          p_privacy_tier: privacy_tier ?? "standard",
          p_actor: CRM_ACTOR,
        });
        if (error) return toErr("crm_add_contact_task error", error.message);

        const task = (data ?? {}) as Record<string, unknown>;
        return {
          content: [
            {
              type: "text" as const,
              text: `Task "${title}" added for contact ${contact_id.trim()}${due_at ? ` (due ${due_at})` : ""} (id=${task.id ?? "?"}).`,
            },
          ],
          structuredContent: { task, contact_id: contact_id.trim() },
        };
      } catch (err: unknown) {
        return toErr("Error", (err as Error).message);
      }
    },
  );

  // Tool 7: crm_log_interaction — log a real interaction (write).
  server.registerTool(
    "crm_log_interaction",
    {
      title: "CRM Log Interaction",
      description:
        "Log a real-world interaction (call, meeting, in-person, message) involving one or more CRM contacts. Use only when an actual interaction occurred — not for tasks or notes. Unknown or archived participants are skipped (reported back), not fatal. Optionally link a supporting memory (thought_id).",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        contact_ids: z
          .array(z.string().uuid())
          .min(1)
          .describe("UUIDs of all participant contacts (min 1)"),
        kind: z
          .enum(["call", "meeting", "in_person", "message", "other"])
          .describe("Interaction kind"),
        summary: z.string().min(1).max(2000).describe("Short prose summary of what happened"),
        occurred_at: z
          .string()
          .datetime({ offset: true })
          .optional()
          .describe("ISO 8601 timestamp (defaults to now)"),
        duration_minutes: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Duration in minutes (optional)"),
        privacy_tier: z
          .enum(["standard", "sensitive", "restricted"])
          .optional()
          .default("standard")
          .describe("Privacy tier for this interaction (default standard)"),
        thought_id: z
          .string()
          .uuid()
          .optional()
          .describe("Optional UUID of a supporting memory row (public.thoughts)"),
      },
    },
    async ({ contact_ids, kind, summary, occurred_at, duration_minutes, privacy_tier, thought_id }) => {
      try {
        const ids = contact_ids.map((id) => id.trim());
        const { data, error } = await supabase.rpc("crm_log_interaction", {
          p_contact_ids: ids,
          p_kind: kind,
          p_occurred_at: occurred_at ?? new Date().toISOString(),
          p_summary: summary,
          p_duration_minutes: duration_minutes ?? null,
          p_privacy_tier: privacy_tier ?? "standard",
          p_thought_id: thought_id?.trim() ?? null,
          p_actor: CRM_ACTOR,
        });
        if (error) return toErr("crm_log_interaction error", error.message);

        const result = (data ?? {}) as Record<string, unknown>;
        const linked = Array.isArray(result.contact_ids) ? result.contact_ids.length : 0;
        const skipped = Array.isArray(result.skipped_contact_ids)
          ? (result.skipped_contact_ids as string[])
          : [];
        const text =
          `Interaction logged (${kind}) for ${linked} participant(s), id=${result.interaction_id ?? "?"}.` +
          (skipped.length ? ` Skipped (unknown/archived): ${skipped.join(", ")}.` : "");

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: { interaction: result },
        };
      } catch (err: unknown) {
        return toErr("Error", (err as Error).message);
      }
    },
  );

  // Tool 8: crm_resolve_proposal — accept / reject a field proposal (the human
  // decision point of the truth layer).
  server.registerTool(
    "crm_resolve_proposal",
    {
      title: "CRM Resolve Proposal",
      description:
        "Accept or reject a pending CRM field proposal. This is the human decision point of the truth layer: machine writes queue proposals; accepting applies the value to the canonical field (and stamps it as human-blessed), rejecting discards it permanently. Use only on explicit human instruction — do NOT auto-accept in bulk.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        proposal_id: z.string().uuid().describe("UUID of the proposal to resolve"),
        decision: z
          .enum(["accept", "reject"])
          .describe("accept applies the proposed value; reject discards it permanently"),
      },
    },
    async ({ proposal_id, decision }) => {
      try {
        const { data, error } = await supabase.rpc("crm_resolve_field_proposal", {
          p_proposal_id: proposal_id.trim(),
          p_decision: decision,
          p_actor: CRM_ACTOR,
        });
        if (error) return toErr("crm_resolve_field_proposal error", error.message);

        const result = (data ?? {}) as Record<string, unknown>;
        const changed = result.changed === true;
        const status = String(result.status ?? (decision === "accept" ? "accepted" : "rejected"));
        return {
          content: [
            {
              type: "text" as const,
              text: `Proposal ${proposal_id.trim()} ${status}${changed ? " — field updated" : " (no change; already decided)"}.`,
            },
          ],
          structuredContent: { result, proposal_id: proposal_id.trim(), decision, changed },
        };
      } catch (err: unknown) {
        return toErr("Error", (err as Error).message);
      }
    },
  );

  // Tool 9: crm_set_field — patch contact fields THROUGH the propose flow.
  server.registerTool(
    "crm_set_field",
    {
      title: "CRM Set Field",
      description:
        "Patch one or more scalar fields on a CRM contact. IMPORTANT: this tool writes as a machine (origin='extraction'). A write over a human-set ('manual') field is NOT applied — it is DIVERTED to a field proposal for a human to accept (crm_resolve_proposal). The response reports applied=[...] (field was empty/agent-owned and updated), proposed=[...] (queued for human review — do NOT retry), and conflicts=[...] (field is locked, not changed). Supported keys: display_name, preferred_name, given_name, family_name, pronouns, job_title, organization_name, location, relationship_note, lifecycle_status, privacy_tier, owner_label.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        contact_id: z.string().uuid().describe("CRM contact UUID"),
        patch: z
          .record(z.string(), z.string())
          .describe(
            "Key/value pairs to set. Keys must be from the supported field list; values are strings.",
          ),
        run_id: z
          .string()
          .max(120)
          .optional()
          .describe("Optional run/session id to group related proposals"),
      },
    },
    async ({ contact_id, patch, run_id }) => {
      try {
        // Keep only recognized fields. The RPC rejects unknown keys, but
        // filtering here gives a clearer error and avoids a round trip.
        const cleaned: Record<string, string> = {};
        for (const key of CRM_PATCH_FIELDS) {
          if (Object.prototype.hasOwnProperty.call(patch, key)) {
            cleaned[key] = patch[key];
          }
        }
        if (Object.keys(cleaned).length === 0) {
          return toErr(
            "crm_set_field",
            `patch must contain at least one supported field. Supported: ${CRM_PATCH_FIELDS.join(", ")}`,
          );
        }

        // Always origin='extraction' — agents are machines and must propose,
        // never directly overwrite a human-set field. This is enforced again
        // DB-side by crm_patch_contact_record; we never pass origin='manual'.
        const { data, error } = await supabase.rpc("crm_patch_contact_record", {
          p_contact_id: contact_id.trim(),
          p_patch: cleaned,
          p_actor: CRM_ACTOR,
          p_origin: "extraction",
          p_run_id: run_id?.trim() ?? null,
          p_expected_updated_at: null,
        });
        if (error) return toErr("crm_patch_contact_record error", error.message);

        const result = (data ?? {}) as Record<string, unknown>;
        const applied = Array.isArray(result.applied) ? (result.applied as string[]) : [];
        const proposed = Array.isArray(result.proposed)
          ? (result.proposed as Array<Record<string, unknown>>)
          : [];
        const conflicts = Array.isArray(result.conflicts) ? (result.conflicts as string[]) : [];

        const parts: string[] = [];
        if (applied.length) parts.push(`applied=[${applied.join(", ")}]`);
        if (proposed.length) {
          const fields = proposed.map((p) => p.field ?? "?").join(", ");
          parts.push(`proposed=[${fields}] (queued for human review — do NOT retry)`);
        }
        if (conflicts.length) {
          parts.push(`conflicts=[${conflicts.join(", ")}] (locked fields — cannot overwrite)`);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `crm_set_field contact ${contact_id.trim()}: ${parts.join("; ") || "no changes"}`,
            },
          ],
          structuredContent: {
            applied,
            proposed,
            conflicts,
            contact_id: contact_id.trim(),
            run_id: run_id?.trim() ?? null,
            origin: "extraction",
          },
        };
      } catch (err: unknown) {
        return toErr("Error", (err as Error).message);
      }
    },
  );

  return server;
}

// --- Hono app with auth + CORS ---

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

// JSON-RPC error code for unauthorized requests. Per the JSON-RPC 2.0 spec the
// -32099..-32000 range is reserved for implementation-defined server errors;
// -32001 is the conventional "Unauthorized" code used by MCP clients/servers.
//
// We return a JSON-RPC envelope (HTTP 200) instead of a bare HTTP 401 because
// strict MCP hosts (Codex CLI, Claude Code) treat bare HTTP 4xx responses as
// transport-level failures and tear the connection down rather than surfacing
// the error to the application. Wrapping the rejection keeps the connection
// alive so clients can recover (e.g. prompt for a new key).
const JSON_RPC_UNAUTHORIZED_CODE = -32001;
const UNAUTHORIZED_MESSAGE = "Unauthorized: missing or invalid authentication.";

async function readBodyText(req: Request): Promise<string | null> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") {
    return null;
  }
  try {
    return await req.text();
  } catch {
    return null;
  }
}

function extractJsonRpcId(bodyText: string | null): string | number | null {
  if (!bodyText) return null;
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed === "object" && "id" in parsed) {
      const id = (parsed as { id: unknown }).id;
      if (typeof id === "string" || typeof id === "number" || id === null) {
        return id;
      }
    }
  } catch {
    // fall through — malformed body
  }
  return null;
}

function unauthorizedResponse(id: string | number | null): Response {
  const body = {
    jsonrpc: "2.0",
    error: { code: JSON_RPC_UNAUTHORIZED_CODE, message: UNAUTHORIZED_MESSAGE },
    id,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

const app = new Hono();

// CORS preflight — required for browser/Electron-based clients (Claude Desktop).
app.options("*", (c) => c.text("ok", 200, corsHeaders));

app.all("*", async (c) => {
  // Accept the access key via header OR URL query parameter.
  const provided =
    c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    const bodyText = await readBodyText(c.req.raw);
    const id = extractJsonRpcId(bodyText);
    return unauthorizedResponse(id);
  }

  // Claude Desktop connectors don't send the Accept header that
  // StreamableHTTPTransport requires. Patch it in when missing.
  if (!c.req.header("accept")?.includes("text/event-stream")) {
    const headers = new Headers(c.req.raw.headers);
    headers.set("Accept", "application/json, text/event-stream");
    const patched = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: c.req.raw.body,
      // @ts-ignore -- duplex required for streaming body in Deno
      duplex: "half",
    });
    Object.defineProperty(c.req, "raw", { value: patched, writable: true });
  }

  // Build the MCP server per request (no shared singleton) — matches the core
  // server's per-request construction landed in #261.
  const server = buildServer();
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  const response = await transport.handleRequest(c);
  if (!response) {
    return c.json({ error: "No response from MCP transport" }, 500, corsHeaders);
  }
  response.headers.delete("mcp-session-id");
  for (const [k, v] of Object.entries(corsHeaders)) response.headers.set(k, v);
  return response;
});

Deno.serve(app.fetch);
