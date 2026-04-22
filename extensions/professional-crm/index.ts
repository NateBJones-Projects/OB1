/**
 * Extension 5: Professional CRM MCP Server (Remote Edge Function)
 *
 * Provides tools for managing professional contacts, interactions, and opportunities:
 * - Contact management with rich metadata (add, update, search)
 * - Interaction logging with auto-updating last_contacted
 * - Opportunity/pipeline tracking
 * - Follow-up reminders
 * - Meeting prep context aggregation
 * - Stale relationship detection
 * - Cross-extension integration with core Open Brain thoughts
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const app = new Hono();

// POST /mcp - Main MCP endpoint
app.post("*", async (c) => {
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

  const key = c.req.query("key") || c.req.header("x-access-key");
  const expected = Deno.env.get("MCP_ACCESS_KEY");
  if (!key || key !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  const userId = Deno.env.get("DEFAULT_USER_ID");
  if (!userId) {
    return c.json({ error: "DEFAULT_USER_ID not configured" }, 500);
  }

  const server = new McpServer({ name: "professional-crm", version: "1.1.0" });

  server.tool(
    "crm_add_contact",
    "Add a new professional contact to your network",
    {
      name: z.string().describe("Contact's full name"),
      company: z.string().optional().describe("Company name"),
      title: z.string().optional().describe("Job title"),
      email: z.string().optional().describe("Email address"),
      phone: z.string().optional().describe("Phone number"),
      linkedin_url: z.string().optional().describe("LinkedIn profile URL"),
      how_we_met: z.string().optional().describe("How you met this person"),
      tags: z.array(z.string()).optional().describe("Tags for categorization (e.g., ['ai', 'consulting', 'conference'])"),
      notes: z.string().optional().describe("Additional notes about this contact"),
    },
    async ({ name, company, title, email, phone, linkedin_url, how_we_met, tags, notes }) => {
      const { data, error } = await supabase
        .from("professional_contacts")
        .insert({
          user_id: userId,
          name,
          company: company || null,
          title: title || null,
          email: email || null,
          phone: phone || null,
          linkedin_url: linkedin_url || null,
          how_we_met: how_we_met || null,
          tags: tags || [],
          notes: notes || null,
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to add contact: ${error.message}`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Added contact: ${name}`,
              contact: data,
            }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "crm_search_contacts",
    "Search professional contacts using full-text search across name, company, title, notes, and how_we_met. Also supports tag filtering",
    {
      query: z.string().optional().describe("Search term — uses PostgreSQL full-text search for ranked results"),
      tags: z.array(z.string()).optional().describe("Filter by specific tags"),
      limit: z.number().optional().describe("Max results to return (default: 20)"),
    },
    async ({ query, tags, limit }) => {
      const maxResults = limit || 20;

      if (query) {
        const tsQuery = query.trim().split(/\s+/).join(" & ");

        const { data, error } = await supabase
          .rpc("crm_search_contacts_fts", {
            search_query: tsQuery,
            search_user_id: userId,
            search_tags: tags || null,
            max_results: maxResults,
          });

        if (error) {
          let queryBuilder = supabase
            .from("professional_contacts")
            .select("*")
            .eq("user_id", userId);

          queryBuilder = queryBuilder.or(
            `name.ilike.%${query}%,company.ilike.%${query}%,title.ilike.%${query}%,notes.ilike.%${query}%`
          );

          if (tags && tags.length > 0) {
            queryBuilder = queryBuilder.contains("tags", tags);
          }

          const { data: fallbackData, error: fallbackError } = await queryBuilder
            .order("name", { ascending: true })
            .limit(maxResults);

          if (fallbackError) {
            throw new Error(`Failed to search contacts: ${fallbackError.message}`);
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  count: fallbackData.length,
                  search_mode: "ilike_fallback",
                  contacts: fallbackData,
                }, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                count: data.length,
                search_mode: "fts",
                contacts: data,
              }, null, 2),
            },
          ],
        };
      }

      let queryBuilder = supabase
        .from("professional_contacts")
        .select("*")
        .eq("user_id", userId);

      if (tags && tags.length > 0) {
        queryBuilder = queryBuilder.contains("tags", tags);
      }

      const { data, error } = await queryBuilder
        .order("name", { ascending: true })
        .limit(maxResults);

      if (error) {
        throw new Error(`Failed to search contacts: ${error.message}`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              count: data.length,
              contacts: data,
            }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "crm_log_interaction",
    "Log an interaction with a contact (automatically updates last_contacted via trigger)",
    {
      contact_id: z.string().describe("Contact ID (UUID)"),
      interaction_type: z.enum(["meeting", "email", "call", "coffee", "event", "linkedin", "other"]).describe("Type of interaction"),
      occurred_at: z.string().optional().describe("When the interaction occurred (ISO 8601 timestamp, defaults to now)"),
      summary: z.string().describe("Summary of the interaction"),
      follow_up_needed: z.boolean().optional().describe("Whether a follow-up is needed"),
      follow_up_notes: z.string().optional().describe("Notes about the follow-up"),
    },
    async ({ contact_id, interaction_type, occurred_at, summary, follow_up_needed, follow_up_notes }) => {
      const { data, error } = await supabase
        .from("contact_interactions")
        .insert({
          user_id: userId,
          contact_id,
          interaction_type,
          occurred_at: occurred_at || new Date().toISOString(),
          summary,
          follow_up_needed: follow_up_needed || false,
          follow_up_notes: follow_up_notes || null,
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to log interaction: ${error.message}`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Interaction logged successfully",
              interaction: data,
            }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "crm_get_contact_history",
    "Get a contact's full profile, all interactions, and linked opportunities",
    {
      contact_id: z.string().describe("Contact ID (UUID)"),
    },
    async ({ contact_id }) => {
      const { data: contact, error: contactError } = await supabase
        .from("professional_contacts")
        .select("*")
        .eq("id", contact_id)
        .eq("user_id", userId)
        .single();

      if (contactError) {
        throw new Error(`Failed to get contact: ${contactError.message}`);
      }

      const { data: interactions, error: interactionsError } = await supabase
        .from("contact_interactions")
        .select("*")
        .eq("contact_id", contact_id)
        .eq("user_id", userId)
        .order("occurred_at", { ascending: false });

      if (interactionsError) {
        throw new Error(`Failed to get interactions: ${interactionsError.message}`);
      }

      const { data: opportunities, error: opportunitiesError } = await supabase
        .from("opportunities")
        .select("*")
        .eq("contact_id", contact_id)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (opportunitiesError) {
        throw new Error(`Failed to get opportunities: ${opportunitiesError.message}`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              contact,
              interactions,
              opportunities,
              interaction_count: interactions.length,
            }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "crm_create_opportunity",
    "Create a new opportunity/deal, optionally linked to a contact",
    {
      contact_id: z.string().optional().describe("Contact ID (UUID) - optional"),
      title: z.string().describe("Opportunity title"),
      description: z.string().optional().describe("Detailed description"),
      stage: z.enum(["identified", "in_conversation", "proposal", "negotiation", "won", "lost"]).optional().describe("Current stage (defaults to 'identified')"),
      value: z.number().optional().describe("Estimated value in dollars"),
      expected_close_date: z.string().optional().describe("Expected close date (YYYY-MM-DD)"),
      notes: z.string().optional().describe("Additional notes"),
    },
    async ({ contact_id, title, description, stage, value, expected_close_date, notes }) => {
      const { data, error } = await supabase
        .from("opportunities")
        .insert({
          user_id: userId,
          contact_id: contact_id || null,
          title,
          description: description || null,
          stage: stage || "identified",
          value: value || null,
          expected_close_date: expected_close_date || null,
          notes: notes || null,
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create opportunity: ${error.message}`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Created opportunity: ${title}`,
              opportunity: data,
            }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "crm_get_follow_ups",
    "List contacts with follow-ups due (overdue or upcoming within N days)",
    {
      days_ahead: z.number().optional().describe("Number of days to look ahead (default: 7)"),
    },
    async ({ days_ahead }) => {
      const daysToCheck = days_ahead || 7;

      const today = new Date().toISOString().split("T")[0];
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + daysToCheck);
      const futureDateStr = futureDate.toISOString().split("T")[0];

      const { data, error } = await supabase
        .from("professional_contacts")
        .select("*")
        .eq("user_id", userId)
        .not("follow_up_date", "is", null)
        .lte("follow_up_date", futureDateStr)
        .order("follow_up_date", { ascending: true });

      if (error) {
        throw new Error(`Failed to get follow-ups: ${error.message}`);
      }

      const overdue = data.filter((c) => c.follow_up_date! < today);
      const upcoming = data.filter((c) => c.follow_up_date! >= today);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              overdue_count: overdue.length,
              upcoming_count: upcoming.length,
              overdue,
              upcoming,
            }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "crm_update_contact",
    "Update an existing contact's details — only the fields you provide are changed",
    {
      contact_id: z.string().describe("Contact ID (UUID)"),
      name: z.string().optional().describe("Updated full name"),
      company: z.string().optional().describe("Updated company name"),
      title: z.string().optional().describe("Updated job title"),
      email: z.string().optional().describe("Updated email address"),
      phone: z.string().optional().describe("Updated phone number"),
      linkedin_url: z.string().optional().describe("Updated LinkedIn profile URL"),
      how_we_met: z.string().optional().describe("Updated context for how you met"),
      tags: z.array(z.string()).optional().describe("Replace tags (e.g., ['ai', 'consulting'])"),
      notes: z.string().optional().describe("Replace notes with new content"),
      follow_up_date: z.string().nullable().optional().describe("Set follow-up date (YYYY-MM-DD), or null to clear"),
    },
    async ({ contact_id, ...fields }) => {
      const updates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (key === "follow_up_date" && (value === null || value === "")) {
          updates[key] = null;
        } else if (value !== undefined) {
          updates[key] = value;
        }
      }

      if (Object.keys(updates).length === 0) {
        throw new Error("No fields provided to update");
      }

      const { data, error } = await supabase
        .from("professional_contacts")
        .update(updates)
        .eq("id", contact_id)
        .eq("user_id", userId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update contact: ${error.message}`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Updated contact: ${data.name}`,
              contact: data,
            }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "crm_link_thought",
    "CROSS-EXTENSION: Link a thought from your core Open Brain to a professional contact",
    {
      thought_id: z.string().describe("Thought ID (UUID) from core Open Brain thoughts table"),
      contact_id: z.string().describe("Contact ID (UUID)"),
    },
    async ({ thought_id, contact_id }) => {
      const { data: thought, error: thoughtError } = await supabase
        .from("thoughts")
        .select("*")
        .eq("id", thought_id)
        .single();

      if (thoughtError) {
        throw new Error(`Failed to retrieve thought: ${thoughtError.message}`);
      }

      if (!thought) {
        throw new Error("Thought not found or access denied");
      }

      const { data: contact, error: contactError } = await supabase
        .from("professional_contacts")
        .select("*")
        .eq("id", contact_id)
        .eq("user_id", userId)
        .single();

      if (contactError) {
        throw new Error(`Failed to retrieve contact: ${contactError.message}`);
      }

      const linkNote = `\n\n[Linked Thought ${new Date().toISOString().split("T")[0]}]: ${thought.content}`;
      const updatedNotes = (contact.notes || "") + linkNote;

      const { data: updatedContact, error: updateError } = await supabase
        .from("professional_contacts")
        .update({ notes: updatedNotes })
        .eq("id", contact_id)
        .eq("user_id", userId)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Failed to link thought to contact: ${updateError.message}`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Linked thought to contact: ${contact.name}`,
              thought_content: thought.content,
              contact: updatedContact,
            }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "crm_prep_context",
    "Meeting prep: aggregates a contact's full profile, recent interactions, open opportunities, pending follow-ups, and linked thoughts into a single briefing",
    {
      contact_id: z.string().describe("Contact ID (UUID)"),
      interaction_limit: z.number().optional().describe("Max interactions to include (default: 10)"),
    },
    async ({ contact_id, interaction_limit }) => {
      const maxInteractions = interaction_limit || 10;

      const [contactRes, interactionsRes, opportunitiesRes] = await Promise.all([
        supabase
          .from("professional_contacts")
          .select("*")
          .eq("id", contact_id)
          .eq("user_id", userId)
          .single(),
        supabase
          .from("contact_interactions")
          .select("*")
          .eq("contact_id", contact_id)
          .eq("user_id", userId)
          .order("occurred_at", { ascending: false })
          .limit(maxInteractions),
        supabase
          .from("opportunities")
          .select("*")
          .eq("contact_id", contact_id)
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
      ]);

      if (contactRes.error) {
        throw new Error(`Contact not found: ${contactRes.error.message}`);
      }

      const contact = contactRes.data;
      const interactions = interactionsRes.data || [];
      const opportunities = opportunitiesRes.data || [];

      const pendingFollowUps = interactions.filter((i) => i.follow_up_needed && i.follow_up_notes);

      const daysSinceContact = contact.last_contacted
        ? Math.floor((Date.now() - new Date(contact.last_contacted).getTime()) / 86400000)
        : null;

      const activeOpportunities = opportunities.filter(
        (o) => !["won", "lost"].includes(o.stage)
      );

      const totalPipelineValue = activeOpportunities.reduce(
        (sum, o) => sum + (parseFloat(o.value) || 0),
        0
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              briefing: {
                contact: {
                  name: contact.name,
                  company: contact.company,
                  title: contact.title,
                  email: contact.email,
                  linkedin_url: contact.linkedin_url,
                  how_we_met: contact.how_we_met,
                  tags: contact.tags,
                  notes: contact.notes,
                },
                relationship: {
                  days_since_last_contact: daysSinceContact,
                  last_contacted: contact.last_contacted,
                  follow_up_date: contact.follow_up_date,
                  total_interactions: interactions.length,
                },
                recent_interactions: interactions.map((i) => ({
                  type: i.interaction_type,
                  date: i.occurred_at,
                  summary: i.summary,
                })),
                pending_follow_ups: pendingFollowUps.map((i) => ({
                  from_interaction: i.occurred_at,
                  notes: i.follow_up_notes,
                })),
                opportunities: {
                  active_count: activeOpportunities.length,
                  total_pipeline_value: totalPipelineValue,
                  items: opportunities.map((o) => ({
                    title: o.title,
                    stage: o.stage,
                    value: o.value,
                    expected_close: o.expected_close_date,
                  })),
                },
              },
            }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "crm_stale_contacts",
    "Find contacts going cold — no interaction logged in the past N days, ordered by staleness",
    {
      days_threshold: z.number().optional().describe("Days without contact to consider stale (default: 30)"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
    async ({ days_threshold, limit }) => {
      const threshold = days_threshold || 30;
      const maxResults = limit || 20;

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - threshold);
      const cutoffStr = cutoffDate.toISOString();

      const { data, error } = await supabase
        .from("professional_contacts")
        .select("id, name, company, title, tags, last_contacted, follow_up_date")
        .eq("user_id", userId)
        .or(`last_contacted.lt.${cutoffStr},last_contacted.is.null`)
        .order("last_contacted", { ascending: true, nullsFirst: true })
        .limit(maxResults);

      if (error) {
        throw new Error(`Failed to find stale contacts: ${error.message}`);
      }

      const contacts = (data || []).map((c) => ({
        ...c,
        days_since_contact: c.last_contacted
          ? Math.floor((Date.now() - new Date(c.last_contacted).getTime()) / 86400000)
          : null,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              threshold_days: threshold,
              count: contacts.length,
              stale_contacts: contacts,
            }, null, 2),
          },
        ],
      };
    },
  );

  const transport = new StreamableHTTPTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(c);
});

app.get("*", (c) => c.json({ status: "ok", service: "Professional CRM", version: "1.1.0" }));

Deno.serve(app.fetch);
