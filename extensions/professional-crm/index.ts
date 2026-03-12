#!/usr/bin/env node

/**
 * Extension 5: Professional CRM MCP Server
 *
 * Provides tools for managing professional contacts, interactions, and opportunities:
 * - Contact management with rich metadata
 * - Interaction logging with auto-updating last_contacted
 * - Opportunity/pipeline tracking
 * - Follow-up reminders
 * - Cross-extension integration with core Open Brain thoughts
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Environment validation
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}

// Initialize Supabase client
const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Type definitions
interface ProfessionalContact {
  id: string;
  user_id: string;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  how_we_met: string | null;
  tags: string[];
  notes: string | null;
  last_contacted: string | null;
  follow_up_date: string | null;
  created_at: string;
  updated_at: string;
}

interface ContactInteraction {
  id: string;
  contact_id: string;
  user_id: string;
  interaction_type: string;
  occurred_at: string;
  summary: string;
  follow_up_needed: boolean;
  follow_up_notes: string | null;
  created_at: string;
}

interface Opportunity {
  id: string;
  user_id: string;
  contact_id: string | null;
  title: string;
  description: string | null;
  stage: string;
  value: number | null;
  expected_close_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: "add_professional_contact",
    description: "Add a new professional contact to your network",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID (UUID)",
        },
        name: {
          type: "string",
          description: "Contact's full name",
        },
        company: {
          type: "string",
          description: "Company name",
        },
        title: {
          type: "string",
          description: "Job title",
        },
        email: {
          type: "string",
          description: "Email address",
        },
        phone: {
          type: "string",
          description: "Phone number",
        },
        linkedin_url: {
          type: "string",
          description: "LinkedIn profile URL",
        },
        how_we_met: {
          type: "string",
          description: "How you met this person",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization (e.g., ['ai', 'consulting', 'conference'])",
        },
        notes: {
          type: "string",
          description: "Additional notes about this contact",
        },
      },
      required: ["user_id", "name"],
    },
  },
  {
    name: "search_contacts",
    description: "Search professional contacts by name, company, or tags",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID (UUID)",
        },
        query: {
          type: "string",
          description: "Search term (searches name, company, title, notes)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter by specific tags",
        },
      },
      required: ["user_id"],
    },
  },
  {
    name: "log_interaction",
    description: "Log an interaction with a contact (automatically updates last_contacted)",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID (UUID)",
        },
        contact_id: {
          type: "string",
          description: "Contact ID (UUID)",
        },
        interaction_type: {
          type: "string",
          enum: ["meeting", "email", "call", "coffee", "event", "linkedin", "other"],
          description: "Type of interaction",
        },
        occurred_at: {
          type: "string",
          description: "When the interaction occurred (ISO 8601 timestamp, defaults to now)",
        },
        summary: {
          type: "string",
          description: "Summary of the interaction",
        },
        follow_up_needed: {
          type: "boolean",
          description: "Whether a follow-up is needed",
        },
        follow_up_notes: {
          type: "string",
          description: "Notes about the follow-up",
        },
      },
      required: ["user_id", "contact_id", "interaction_type", "summary"],
    },
  },
  {
    name: "get_contact_history",
    description: "Get a contact's full profile and all interactions, ordered by date",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID (UUID)",
        },
        contact_id: {
          type: "string",
          description: "Contact ID (UUID)",
        },
      },
      required: ["user_id", "contact_id"],
    },
  },
  {
    name: "create_opportunity",
    description: "Create a new opportunity/deal, optionally linked to a contact",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID (UUID)",
        },
        contact_id: {
          type: "string",
          description: "Contact ID (UUID) - optional",
        },
        title: {
          type: "string",
          description: "Opportunity title",
        },
        description: {
          type: "string",
          description: "Detailed description",
        },
        stage: {
          type: "string",
          enum: ["identified", "in_conversation", "proposal", "negotiation", "won", "lost"],
          description: "Current stage (defaults to 'identified')",
        },
        value: {
          type: "number",
          description: "Estimated value in dollars",
        },
        expected_close_date: {
          type: "string",
          description: "Expected close date (YYYY-MM-DD)",
        },
        notes: {
          type: "string",
          description: "Additional notes",
        },
      },
      required: ["user_id", "title"],
    },
  },
  {
    name: "get_follow_ups_due",
    description: "List contacts with follow-ups due in the past or next N days",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID (UUID)",
        },
        days_ahead: {
          type: "number",
          description: "Number of days to look ahead (default: 7)",
        },
      },
      required: ["user_id"],
    },
  },
  {
    name: "link_thought_to_contact",
    description: "CROSS-EXTENSION: Link a thought from your core Open Brain to a professional contact",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID (UUID)",
        },
        thought_id: {
          type: "string",
          description: "Thought ID (UUID) from core Open Brain thoughts table",
        },
        contact_id: {
          type: "string",
          description: "Contact ID (UUID)",
        },
      },
      required: ["user_id", "thought_id", "contact_id"],
    },
  },
];

// Tool handlers
async function handleAddProfessionalContact(args: any): Promise<string> {
  const { user_id, name, company, title, email, phone, linkedin_url, how_we_met, tags, notes } = args;

  const { data, error } = await supabase
    .from("professional_contacts")
    .insert({
      user_id,
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

  return JSON.stringify({
    success: true,
    message: `Added professional contact: ${name}`,
    contact: data,
  }, null, 2);
}

async function handleSearchContacts(args: any): Promise<string> {
  const { user_id, query, tags } = args;

  let queryBuilder = supabase
    .from("professional_contacts")
    .select("*")
    .eq("user_id", user_id);

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

  return JSON.stringify({
    success: true,
    count: data.length,
    contacts: data,
  }, null, 2);
}

async function handleLogInteraction(args: any): Promise<string> {
  const { user_id, contact_id, interaction_type, occurred_at, summary, follow_up_needed, follow_up_notes } = args;

  const { data, error } = await supabase
    .from("contact_interactions")
    .insert({
      user_id,
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

  return JSON.stringify({
    success: true,
    message: "Interaction logged successfully",
    interaction: data,
  }, null, 2);
}

async function handleGetContactHistory(args: any): Promise<string> {
  const { user_id, contact_id } = args;

  // Get contact details
  const { data: contact, error: contactError } = await supabase
    .from("professional_contacts")
    .select("*")
    .eq("id", contact_id)
    .eq("user_id", user_id)
    .single();

  if (contactError) {
    throw new Error(`Failed to get contact: ${contactError.message}`);
  }

  // Get all interactions
  const { data: interactions, error: interactionsError } = await supabase
    .from("contact_interactions")
    .select("*")
    .eq("contact_id", contact_id)
    .eq("user_id", user_id)
    .order("occurred_at", { ascending: false });

  if (interactionsError) {
    throw new Error(`Failed to get interactions: ${interactionsError.message}`);
  }

  // Get related opportunities
  const { data: opportunities, error: opportunitiesError } = await supabase
    .from("opportunities")
    .select("*")
    .eq("contact_id", contact_id)
    .eq("user_id", user_id)
    .order("created_at", { ascending: false });

  if (opportunitiesError) {
    throw new Error(`Failed to get opportunities: ${opportunitiesError.message}`);
  }

  return JSON.stringify({
    success: true,
    contact,
    interactions,
    opportunities,
    interaction_count: interactions.length,
  }, null, 2);
}

async function handleCreateOpportunity(args: any): Promise<string> {
  const { user_id, contact_id, title, description, stage, value, expected_close_date, notes } = args;

  const { data, error } = await supabase
    .from("opportunities")
    .insert({
      user_id,
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

  return JSON.stringify({
    success: true,
    message: `Created opportunity: ${title}`,
    opportunity: data,
  }, null, 2);
}

async function handleGetFollowUpsDue(args: any): Promise<string> {
  const { user_id, days_ahead } = args;
  const daysToCheck = days_ahead || 7;

  const today = new Date().toISOString().split('T')[0];
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysToCheck);
  const futureDateStr = futureDate.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from("professional_contacts")
    .select("*")
    .eq("user_id", user_id)
    .not("follow_up_date", "is", null)
    .lte("follow_up_date", futureDateStr)
    .order("follow_up_date", { ascending: true });

  if (error) {
    throw new Error(`Failed to get follow-ups: ${error.message}`);
  }

  // Separate overdue and upcoming
  const overdue = data.filter(c => c.follow_up_date! < today);
  const upcoming = data.filter(c => c.follow_up_date! >= today);

  return JSON.stringify({
    success: true,
    overdue_count: overdue.length,
    upcoming_count: upcoming.length,
    overdue,
    upcoming,
  }, null, 2);
}

async function handleLinkThoughtToContact(args: any): Promise<string> {
  const { user_id, thought_id, contact_id } = args;

  // Retrieve the thought from core Open Brain
  const { data: thought, error: thoughtError } = await supabase
    .from("thoughts")
    .select("*")
    .eq("id", thought_id)
    .eq("user_id", user_id)
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
    .eq("user_id", user_id)
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
    .eq("user_id", user_id)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to link thought to contact: ${updateError.message}`);
  }

  return JSON.stringify({
    success: true,
    message: `Linked thought to contact: ${contact.name}`,
    thought_content: thought.content,
    contact: updatedContact,
  }, null, 2);
}

// Server setup
const server = new Server(
  {
    name: "professional-crm",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "add_professional_contact":
        return { content: [{ type: "text", text: await handleAddProfessionalContact(args) }] };
      case "search_contacts":
        return { content: [{ type: "text", text: await handleSearchContacts(args) }] };
      case "log_interaction":
        return { content: [{ type: "text", text: await handleLogInteraction(args) }] };
      case "get_contact_history":
        return { content: [{ type: "text", text: await handleGetContactHistory(args) }] };
      case "create_opportunity":
        return { content: [{ type: "text", text: await handleCreateOpportunity(args) }] };
      case "get_follow_ups_due":
        return { content: [{ type: "text", text: await handleGetFollowUpsDue(args) }] };
      case "link_thought_to_contact":
        return { content: [{ type: "text", text: await handleLinkThoughtToContact(args) }] };
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }) }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Professional CRM MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
