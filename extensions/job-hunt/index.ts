#!/usr/bin/env node

/**
 * Extension 6: Job Hunt Pipeline MCP Server
 *
 * Provides tools for managing a complete job search:
 * - Company tracking
 * - Job posting management
 * - Application pipeline
 * - Interview scheduling and logging
 * - Job contact management with CRM integration
 * - Pipeline analytics and upcoming events
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
interface Company {
  id: string;
  user_id: string;
  name: string;
  industry: string | null;
  website: string | null;
  size: string | null;
  location: string | null;
  remote_policy: string | null;
  notes: string | null;
  glassdoor_rating: number | null;
  created_at: string;
  updated_at: string;
}

interface JobPosting {
  id: string;
  company_id: string;
  user_id: string;
  title: string;
  url: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  requirements: string[];
  nice_to_haves: string[];
  notes: string | null;
  source: string | null;
  posted_date: string | null;
  closing_date: string | null;
  created_at: string;
}

interface Application {
  id: string;
  job_posting_id: string;
  user_id: string;
  status: string;
  applied_date: string | null;
  response_date: string | null;
  resume_version: string | null;
  cover_letter_notes: string | null;
  referral_contact: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface Interview {
  id: string;
  application_id: string;
  user_id: string;
  interview_type: string;
  scheduled_at: string | null;
  duration_minutes: number | null;
  interviewer_name: string | null;
  interviewer_title: string | null;
  status: string;
  notes: string | null;
  feedback: string | null;
  rating: number | null;
  created_at: string;
}

interface JobContact {
  id: string;
  user_id: string;
  company_id: string | null;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  role_in_process: string | null;
  professional_crm_contact_id: string | null;
  notes: string | null;
  last_contacted: string | null;
  created_at: string;
}

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: "add_company",
    description: "Add a company to track in your job search",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "User ID (UUID)" },
        name: { type: "string", description: "Company name" },
        industry: { type: "string", description: "Industry" },
        website: { type: "string", description: "Company website" },
        size: {
          type: "string",
          enum: ["startup", "mid-market", "enterprise"],
          description: "Company size",
        },
        location: { type: "string", description: "Location" },
        remote_policy: {
          type: "string",
          enum: ["remote", "hybrid", "onsite"],
          description: "Remote work policy",
        },
        notes: { type: "string", description: "Additional notes" },
        glassdoor_rating: {
          type: "number",
          minimum: 1.0,
          maximum: 5.0,
          description: "Glassdoor rating (1.0-5.0)",
        },
      },
      required: ["user_id", "name"],
    },
  },
  {
    name: "add_job_posting",
    description: "Add a job posting at a company",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "User ID (UUID)" },
        company_id: { type: "string", description: "Company ID (UUID)" },
        title: { type: "string", description: "Job title" },
        url: { type: "string", description: "Job posting URL" },
        salary_min: { type: "number", description: "Minimum salary" },
        salary_max: { type: "number", description: "Maximum salary" },
        salary_currency: { type: "string", description: "Currency (default: USD)" },
        requirements: {
          type: "array",
          items: { type: "string" },
          description: "Required qualifications",
        },
        nice_to_haves: {
          type: "array",
          items: { type: "string" },
          description: "Nice-to-have qualifications",
        },
        notes: { type: "string", description: "Notes about the role" },
        source: {
          type: "string",
          enum: ["linkedin", "company-site", "referral", "recruiter", "other"],
          description: "Where you found this posting",
        },
        posted_date: { type: "string", description: "Date posted (YYYY-MM-DD)" },
        closing_date: { type: "string", description: "Application deadline (YYYY-MM-DD)" },
      },
      required: ["user_id", "company_id", "title"],
    },
  },
  {
    name: "submit_application",
    description: "Record a submitted application",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "User ID (UUID)" },
        job_posting_id: { type: "string", description: "Job posting ID (UUID)" },
        status: {
          type: "string",
          enum: ["draft", "applied", "screening", "interviewing", "offer", "accepted", "rejected", "withdrawn"],
          description: "Application status (default: applied)",
        },
        applied_date: { type: "string", description: "Date applied (YYYY-MM-DD)" },
        resume_version: { type: "string", description: "Resume version used" },
        cover_letter_notes: { type: "string", description: "Notes about cover letter" },
        referral_contact: { type: "string", description: "Referral contact name" },
        notes: { type: "string", description: "Additional notes" },
      },
      required: ["user_id", "job_posting_id"],
    },
  },
  {
    name: "schedule_interview",
    description: "Schedule an interview for an application",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "User ID (UUID)" },
        application_id: { type: "string", description: "Application ID (UUID)" },
        interview_type: {
          type: "string",
          enum: ["phone_screen", "technical", "behavioral", "system_design", "hiring_manager", "team", "final"],
          description: "Type of interview",
        },
        scheduled_at: { type: "string", description: "Interview date/time (ISO 8601)" },
        duration_minutes: { type: "number", description: "Expected duration in minutes" },
        interviewer_name: { type: "string", description: "Interviewer name" },
        interviewer_title: { type: "string", description: "Interviewer title" },
        notes: { type: "string", description: "Pre-interview prep notes" },
      },
      required: ["user_id", "application_id", "interview_type"],
    },
  },
  {
    name: "log_interview_notes",
    description: "Add feedback/notes after an interview and mark it as completed",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "User ID (UUID)" },
        interview_id: { type: "string", description: "Interview ID (UUID)" },
        feedback: { type: "string", description: "Post-interview reflection" },
        rating: {
          type: "number",
          minimum: 1,
          maximum: 5,
          description: "Your assessment of how it went (1-5)",
        },
      },
      required: ["user_id", "interview_id"],
    },
  },
  {
    name: "get_pipeline_overview",
    description: "Get a dashboard summary: application counts by status, upcoming interviews, recent activity",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "User ID (UUID)" },
        days_ahead: {
          type: "number",
          description: "Number of days to look ahead for interviews (default: 7)",
        },
      },
      required: ["user_id"],
    },
  },
  {
    name: "get_upcoming_interviews",
    description: "List interviews in the next N days with full company/role context",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "User ID (UUID)" },
        days_ahead: {
          type: "number",
          description: "Number of days to look ahead (default: 14)",
        },
      },
      required: ["user_id"],
    },
  },
  {
    name: "link_contact_to_professional_crm",
    description: "CROSS-EXTENSION: Link a job contact to Extension 5 Professional CRM, creating a professional_contacts record",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "User ID (UUID)" },
        job_contact_id: { type: "string", description: "Job contact ID (UUID)" },
      },
      required: ["user_id", "job_contact_id"],
    },
  },
];

// Tool handlers
async function handleAddCompany(args: any): Promise<string> {
  const { user_id, name, industry, website, size, location, remote_policy, notes, glassdoor_rating } = args;

  const { data, error } = await supabase
    .from("companies")
    .insert({
      user_id,
      name,
      industry: industry || null,
      website: website || null,
      size: size || null,
      location: location || null,
      remote_policy: remote_policy || null,
      notes: notes || null,
      glassdoor_rating: glassdoor_rating || null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to add company: ${error.message}`);
  }

  return JSON.stringify({
    success: true,
    message: `Added company: ${name}`,
    company: data,
  }, null, 2);
}

async function handleAddJobPosting(args: any): Promise<string> {
  const {
    user_id, company_id, title, url, salary_min, salary_max, salary_currency,
    requirements, nice_to_haves, notes, source, posted_date, closing_date
  } = args;

  const { data, error } = await supabase
    .from("job_postings")
    .insert({
      user_id,
      company_id,
      title,
      url: url || null,
      salary_min: salary_min || null,
      salary_max: salary_max || null,
      salary_currency: salary_currency || "USD",
      requirements: requirements || [],
      nice_to_haves: nice_to_haves || [],
      notes: notes || null,
      source: source || null,
      posted_date: posted_date || null,
      closing_date: closing_date || null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to add job posting: ${error.message}`);
  }

  return JSON.stringify({
    success: true,
    message: `Added job posting: ${title}`,
    job_posting: data,
  }, null, 2);
}

async function handleSubmitApplication(args: any): Promise<string> {
  const {
    user_id, job_posting_id, status, applied_date, resume_version,
    cover_letter_notes, referral_contact, notes
  } = args;

  const { data, error } = await supabase
    .from("applications")
    .insert({
      user_id,
      job_posting_id,
      status: status || "applied",
      applied_date: applied_date || null,
      resume_version: resume_version || null,
      cover_letter_notes: cover_letter_notes || null,
      referral_contact: referral_contact || null,
      notes: notes || null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to submit application: ${error.message}`);
  }

  return JSON.stringify({
    success: true,
    message: "Application recorded successfully",
    application: data,
  }, null, 2);
}

async function handleScheduleInterview(args: any): Promise<string> {
  const {
    user_id, application_id, interview_type, scheduled_at, duration_minutes,
    interviewer_name, interviewer_title, notes
  } = args;

  const { data, error } = await supabase
    .from("interviews")
    .insert({
      user_id,
      application_id,
      interview_type,
      scheduled_at: scheduled_at || null,
      duration_minutes: duration_minutes || null,
      interviewer_name: interviewer_name || null,
      interviewer_title: interviewer_title || null,
      status: "scheduled",
      notes: notes || null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to schedule interview: ${error.message}`);
  }

  return JSON.stringify({
    success: true,
    message: "Interview scheduled successfully",
    interview: data,
  }, null, 2);
}

async function handleLogInterviewNotes(args: any): Promise<string> {
  const { user_id, interview_id, feedback, rating } = args;

  const { data, error } = await supabase
    .from("interviews")
    .update({
      feedback: feedback || null,
      rating: rating || null,
      status: "completed",
    })
    .eq("id", interview_id)
    .eq("user_id", user_id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to log interview notes: ${error.message}`);
  }

  return JSON.stringify({
    success: true,
    message: "Interview notes logged and status updated to completed",
    interview: data,
  }, null, 2);
}

async function handleGetPipelineOverview(args: any): Promise<string> {
  const { user_id, days_ahead } = args;
  const daysToCheck = days_ahead || 7;

  // Get application counts by status
  const { data: applications, error: appError } = await supabase
    .from("applications")
    .select("status")
    .eq("user_id", user_id);

  if (appError) {
    throw new Error(`Failed to get applications: ${appError.message}`);
  }

  const statusCounts = applications.reduce((acc: any, app: any) => {
    acc[app.status] = (acc[app.status] || 0) + 1;
    return acc;
  }, {});

  // Get upcoming interviews
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysToCheck);

  const { data: upcomingInterviews, error: interviewError } = await supabase
    .from("interviews")
    .select(`
      *,
      applications!inner(
        *,
        job_postings!inner(
          *,
          companies!inner(*)
        )
      )
    `)
    .eq("user_id", user_id)
    .eq("status", "scheduled")
    .gte("scheduled_at", new Date().toISOString())
    .lte("scheduled_at", futureDate.toISOString())
    .order("scheduled_at", { ascending: true });

  if (interviewError) {
    throw new Error(`Failed to get upcoming interviews: ${interviewError.message}`);
  }

  return JSON.stringify({
    success: true,
    total_applications: applications.length,
    status_breakdown: statusCounts,
    upcoming_interviews_count: upcomingInterviews.length,
    upcoming_interviews: upcomingInterviews,
  }, null, 2);
}

async function handleGetUpcomingInterviews(args: any): Promise<string> {
  const { user_id, days_ahead } = args;
  const daysToCheck = days_ahead || 14;

  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysToCheck);

  const { data, error } = await supabase
    .from("interviews")
    .select(`
      *,
      applications!inner(
        *,
        job_postings!inner(
          *,
          companies!inner(*)
        )
      )
    `)
    .eq("user_id", user_id)
    .eq("status", "scheduled")
    .gte("scheduled_at", new Date().toISOString())
    .lte("scheduled_at", futureDate.toISOString())
    .order("scheduled_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to get upcoming interviews: ${error.message}`);
  }

  return JSON.stringify({
    success: true,
    count: data.length,
    interviews: data,
  }, null, 2);
}

async function handleLinkContactToProfessionalCRM(args: any): Promise<string> {
  const { user_id, job_contact_id } = args;

  // Get the job contact
  const { data: jobContact, error: contactError } = await supabase
    .from("job_contacts")
    .select("*")
    .eq("id", job_contact_id)
    .eq("user_id", user_id)
    .single();

  if (contactError) {
    throw new Error(`Failed to retrieve job contact: ${contactError.message}`);
  }

  if (!jobContact) {
    throw new Error("Job contact not found or access denied");
  }

  // Check if already linked
  if (jobContact.professional_crm_contact_id) {
    return JSON.stringify({
      success: true,
      message: "Contact already linked to Professional CRM",
      job_contact: jobContact,
      already_linked: true,
    }, null, 2);
  }

  // Get company name if linked
  let companyName = null;
  if (jobContact.company_id) {
    const { data: company } = await supabase
      .from("companies")
      .select("name")
      .eq("id", jobContact.company_id)
      .single();
    companyName = company?.name;
  }

  // Create professional contact in Extension 5
  const { data: professionalContact, error: crmError } = await supabase
    .from("professional_contacts")
    .insert({
      user_id,
      name: jobContact.name,
      company: companyName,
      title: jobContact.title,
      email: jobContact.email,
      phone: jobContact.phone,
      linkedin_url: jobContact.linkedin_url,
      how_we_met: `Job search - ${jobContact.role_in_process || 'contact'}`,
      tags: ["job-hunt", jobContact.role_in_process || "contact"],
      notes: jobContact.notes,
      last_contacted: jobContact.last_contacted,
    })
    .select()
    .single();

  if (crmError) {
    throw new Error(`Failed to create professional contact: ${crmError.message}`);
  }

  // Update job contact with link
  const { data: updatedJobContact, error: updateError } = await supabase
    .from("job_contacts")
    .update({ professional_crm_contact_id: professionalContact.id })
    .eq("id", job_contact_id)
    .eq("user_id", user_id)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to link contact: ${updateError.message}`);
  }

  return JSON.stringify({
    success: true,
    message: `Linked ${jobContact.name} to Professional CRM`,
    job_contact: updatedJobContact,
    professional_contact: professionalContact,
  }, null, 2);
}

// Server setup
const server = new Server(
  {
    name: "job-hunt",
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
      case "add_company":
        return { content: [{ type: "text", text: await handleAddCompany(args) }] };
      case "add_job_posting":
        return { content: [{ type: "text", text: await handleAddJobPosting(args) }] };
      case "submit_application":
        return { content: [{ type: "text", text: await handleSubmitApplication(args) }] };
      case "schedule_interview":
        return { content: [{ type: "text", text: await handleScheduleInterview(args) }] };
      case "log_interview_notes":
        return { content: [{ type: "text", text: await handleLogInterviewNotes(args) }] };
      case "get_pipeline_overview":
        return { content: [{ type: "text", text: await handleGetPipelineOverview(args) }] };
      case "get_upcoming_interviews":
        return { content: [{ type: "text", text: await handleGetUpcomingInterviews(args) }] };
      case "link_contact_to_professional_crm":
        return { content: [{ type: "text", text: await handleLinkContactToProfessionalCRM(args) }] };
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
  console.error("Job Hunt Pipeline MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
