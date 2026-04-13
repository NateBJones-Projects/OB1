/**
 * Extension 5: Professional CRM MCP Server (Remote Edge Function)
 *
 * Provides tools for managing professional contacts, interactions, and opportunities:
 * - Contact management with rich metadata (add, update, search)
 * - Interaction logging with auto-updating last_contacted
 * - Opportunity/pipeline tracking
 * - Follow-up reminders
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
  // Force JSON-only responses. SSE causes a reconnect loop on stateless edge functions:
  // the client sends Accept: text/event-stream (per MCP spec), the transport opens an SSE
  // stream, the function terminates, client reconnects in ~1-2s -- ~43k idle invocations/day.
  // Stripping text/event-stream forces plain JSON responses and breaks the loop.
  {
    const headers = new Headers(c.req.raw.headers);
    headers.set("Accept", "application/json");
    const patched = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: c.req.raw.body,
      // @ts-ignore -- duplex required for streaming body in Deno
      duplex: "half",
    });
    Object.defineProperty(c.req, "raw", { value: patched, writable: true });
  }


  // Auth check
  const key = c.req.query("key") || c.req.header("x-access-key");
  const expected = Deno.env.get("MCP_ACCESS_KEY");
  if (!key || key !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Initialize Supabase client
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

  const server = new McpServer({ name: "professional-crm", version: "1.0.0" });

  // Tool 1: add_professional_contact
  server.tool(
    "add_professional_contact",
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
        throw new Error(`Failed to add professional contact: ${error.message}`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Added professional contact: ${name}`,
              contact: data,
            }, null, 2),
          },
        ],
      };
    },
  );

  // Tool 2: search_contacts
  server.tool(
    "search_contacts",
    "Search professional contacts by name, company, or tags",
    {
      query: z.string().optional().describe("Search term (searches name, company, title, notes)"),
      tags: z.array(z.string()).optional().describe("Filter by specific tags"),
    },
    async ({ query, tags }) => {
      let queryBuilder = supabase
        .from("professional_contacts")
        .select("*")
        .eq("user_id", userId);

      if (query) {
        queryBuilder = queryBuilder.or(
          `name.ilike.%${query}%,company.ilike.%${query}%,title.ilike.%${query}%,notes.ilike.%${query}%`
        );
      }

      if (tags && tags.length > 0) {
        queryBuilder = queryBuilder.contains("tags", tags);
      }

      const { data, error } = await queryBuilder.order("name", { ascending: true });

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

  // Tool 3: log_interaction
  server.tool(
    "log_interaction",
    "Log an interaction with a contact (automatically updates last_contacted)",
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

      // Note: last_contacted is automatically updated by database trigger

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

  // Tool 4: get_contact_history
  server.tool(
    "get_contact_history",
    "Get a contact's full profile and all interactions, ordered by date",
    {
      contact_id: z.string().describe("Contact ID (UUID)"),
    },
    async ({ contact_id }) => {
      // Get contact details
      const { data: contact, error: contactError } = await supabase
        .from("professional_contacts")
        .select("*")
        .eq("id", contact_id)
        .eq("user_id", userId)
        .single();

      if (contactError) {
        throw new Error(`Failed to get contact: ${contactError.message}`);
      }

      // Get all interactions
      const { data: interactions, error: interactionsError } = await supabase
        .from("contact_interactions")
        .select("*")
        .eq("contact_id", contact_id)
        .eq("user_id", userId)
        .order("occurred_at", { ascending: false });

      if (interactionsError) {
        throw new Error(`Failed to get interactions: ${interactionsError.message}`);
      }

      // Get related opportunities
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

  // Tool 5: create_opportunity
  server.tool(
    "create_opportunity",
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

  // Tool 6: get_follow_ups_due
  server.tool(
    "get_follow_ups_due",
    "List contacts with follow-ups due in the past or next N days",
    {
      days_ahead: z.number().optional().describe("Number of days to look ahead (default: 7)"),
    },
    async ({ days_ahead }) => {
      const daysToCheck = days_ahead || 7;

      const today = new Date().toISOString().split('T')[0];
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + daysToCheck);
      const futureDateStr = futureDate.toISOString().split('T')[0];

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

      // Separate overdue and upcoming
      const overdue = data.filter(c => c.follow_up_date! < today);
      const upcoming = data.filter(c => c.follow_up_date! >= today);

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

  // Tool 7: update_professional_contact
  server.tool(
    "update_professional_contact",
    "Update an existing professional contact's details (name, title, company, email, etc.)",
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
      follow_up_date: z.string().nullable().optional().describe("Set or update follow-up date (YYYY-MM-DD), or null/empty string to clear"),
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

  // Tool 8: link_thought_to_contact (CROSS-EXTENSION BRIDGE)
  server.tool(
    "link_thought_to_contact",
    "CROSS-EXTENSION: Link a thought from your core Open Brain to a professional contact",
    {
      thought_id: z.string().describe("Thought ID (UUID) from core Open Brain thoughts table"),
      contact_id: z.string().describe("Contact ID (UUID)"),
    },
    async ({ thought_id, contact_id }) => {
      // Retrieve the thought from core Open Brain
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

      // Get the contact
      const { data: contact, error: contactError } = await supabase
        .from("professional_contacts")
        .select("*")
        .eq("id", contact_id)
        .eq("user_id", userId)
        .single();

      if (contactError) {
        throw new Error(`Failed to retrieve contact: ${contactError.message}`);
      }

      // Append the thought to the contact's notes
      const linkNote = `\n\n[Linked Thought ${new Date().toISOString().split('T')[0]}]: ${thought.content}`;
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

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

// GET / - Health check
app.get("*", (c) => c.json({ status: "ok", service: "Professional CRM", version: "1.0.0" }));

Deno.serve(app.fetch);
