import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const app = new Hono();

// Zod schemas for tool inputs
const addCompanySchema = z.object({
  user_id: z.string().describe("User ID (UUID)"),
  name: z.string().describe("Company name"),
  industry: z.string().optional().describe("Industry"),
  website: z.string().optional().describe("Company website"),
  size: z.enum(["startup", "mid-market", "enterprise"]).optional().describe("Company size"),
  location: z.string().optional().describe("Location"),
  remote_policy: z.enum(["remote", "hybrid", "onsite"]).optional().describe("Remote work policy"),
  notes: z.string().optional().describe("Additional notes"),
  glassdoor_rating: z.number().min(1.0).max(5.0).optional().describe("Glassdoor rating (1.0-5.0)"),
});

const addJobPostingSchema = z.object({
  user_id: z.string().describe("User ID (UUID)"),
  company_id: z.string().describe("Company ID (UUID)"),
  title: z.string().describe("Job title"),
  url: z.string().optional().describe("Job posting URL"),
  salary_min: z.number().optional().describe("Minimum salary"),
  salary_max: z.number().optional().describe("Maximum salary"),
  salary_currency: z.string().optional().describe("Currency (default: USD)"),
  requirements: z.array(z.string()).optional().describe("Required qualifications"),
  nice_to_haves: z.array(z.string()).optional().describe("Nice-to-have qualifications"),
  notes: z.string().optional().describe("Notes about the role"),
  source: z.enum(["linkedin", "company-site", "referral", "recruiter", "other"]).optional().describe("Where you found this posting"),
  posted_date: z.string().optional().describe("Date posted (YYYY-MM-DD)"),
  closing_date: z.string().optional().describe("Application deadline (YYYY-MM-DD)"),
});

const submitApplicationSchema = z.object({
  user_id: z.string().describe("User ID (UUID)"),
  job_posting_id: z.string().describe("Job posting ID (UUID)"),
  status: z.enum(["draft", "applied", "screening", "interviewing", "offer", "accepted", "rejected", "withdrawn"]).optional().describe("Application status (default: applied)"),
  applied_date: z.string().optional().describe("Date applied (YYYY-MM-DD)"),
  resume_version: z.string().optional().describe("Resume version used"),
  cover_letter_notes: z.string().optional().describe("Notes about cover letter"),
  referral_contact: z.string().optional().describe("Referral contact name"),
  notes: z.string().optional().describe("Additional notes"),
});

const scheduleInterviewSchema = z.object({
  user_id: z.string().describe("User ID (UUID)"),
  application_id: z.string().describe("Application ID (UUID)"),
  interview_type: z.enum(["phone_screen", "technical", "behavioral", "system_design", "hiring_manager", "team", "final"]).describe("Type of interview"),
  scheduled_at: z.string().optional().describe("Interview date/time (ISO 8601)"),
  duration_minutes: z.number().optional().describe("Expected duration in minutes"),
  interviewer_name: z.string().optional().describe("Interviewer name"),
  interviewer_title: z.string().optional().describe("Interviewer title"),
  notes: z.string().optional().describe("Pre-interview prep notes"),
});

const logInterviewNotesSchema = z.object({
  user_id: z.string().describe("User ID (UUID)"),
  interview_id: z.string().describe("Interview ID (UUID)"),
  feedback: z.string().optional().describe("Post-interview reflection"),
  rating: z.number().min(1).max(5).optional().describe("Your assessment of how it went (1-5)"),
});

const getPipelineOverviewSchema = z.object({
  user_id: z.string().describe("User ID (UUID)"),
  days_ahead: z.number().optional().describe("Number of days to look ahead for interviews (default: 7)"),
});

const getUpcomingInterviewsSchema = z.object({
  user_id: z.string().describe("User ID (UUID)"),
  days_ahead: z.number().optional().describe("Number of days to look ahead (default: 14)"),
});

const linkContactToProfessionalCRMSchema = z.object({
  user_id: z.string().describe("User ID (UUID)"),
  job_contact_id: z.string().describe("Job contact ID (UUID)"),
});
// Tool handlers
async function handleAddCompany(supabase: any, args: z.infer<typeof addCompanySchema>): Promise<string> {
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

async function handleAddJobPosting(supabase: any, args: z.infer<typeof addJobPostingSchema>): Promise<string> {
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

async function handleSubmitApplication(supabase: any, args: z.infer<typeof submitApplicationSchema>): Promise<string> {
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

async function handleScheduleInterview(supabase: any, args: z.infer<typeof scheduleInterviewSchema>): Promise<string> {
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

async function handleLogInterviewNotes(supabase: any, args: z.infer<typeof logInterviewNotesSchema>): Promise<string> {
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

async function handleGetPipelineOverview(supabase: any, args: z.infer<typeof getPipelineOverviewSchema>): Promise<string> {
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

async function handleGetUpcomingInterviews(supabase: any, args: z.infer<typeof getUpcomingInterviewsSchema>): Promise<string> {
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

async function handleLinkContactToProfessionalCRM(supabase: any, args: z.infer<typeof linkContactToProfessionalCRMSchema>): Promise<string> {
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

// MCP server endpoint
app.post("*", async (c) => {
  // Validate access key
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
    }
  );

  // Create MCP server
  const server = new McpServer({ name: "job-hunt", version: "1.0.0" });

  // Register tools
  const wrap = async (fn: () => Promise<string>) => {
    try {
      const text = await fn();
      return { content: [{ type: "text" as const, text }] };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: msg }) }], isError: true };
    }
  };

  server.tool(
    "add_company",
    "Add a company to track in your job search",
    addCompanySchema.shape,
    async (args) => wrap(() => handleAddCompany(supabase, args))
  );

  server.tool(
    "add_job_posting",
    "Add a job posting at a company",
    addJobPostingSchema.shape,
    async (args) => wrap(() => handleAddJobPosting(supabase, args))
  );

  server.tool(
    "submit_application",
    "Record a submitted application",
    submitApplicationSchema.shape,
    async (args) => wrap(() => handleSubmitApplication(supabase, args))
  );

  server.tool(
    "schedule_interview",
    "Schedule an interview for an application",
    scheduleInterviewSchema.shape,
    async (args) => wrap(() => handleScheduleInterview(supabase, args))
  );

  server.tool(
    "log_interview_notes",
    "Add feedback/notes after an interview and mark it as completed",
    logInterviewNotesSchema.shape,
    async (args) => wrap(() => handleLogInterviewNotes(supabase, args))
  );

  server.tool(
    "get_pipeline_overview",
    "Get a dashboard summary: application counts by status, upcoming interviews, recent activity",
    getPipelineOverviewSchema.shape,
    async (args) => wrap(() => handleGetPipelineOverview(supabase, args))
  );

  server.tool(
    "get_upcoming_interviews",
    "List interviews in the next N days with full company/role context",
    getUpcomingInterviewsSchema.shape,
    async (args) => wrap(() => handleGetUpcomingInterviews(supabase, args))
  );

  server.tool(
    "link_contact_to_professional_crm",
    "CROSS-EXTENSION: Link a job contact to Extension 5 Professional CRM, creating a professional_contacts record",
    linkContactToProfessionalCRMSchema.shape,
    async (args) => wrap(() => handleLinkContactToProfessionalCRM(supabase, args))
  );

  // Connect transport and handle request
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

// Health check endpoint
app.get("*", (c) => c.json({
  status: "ok",
  service: "Job Hunt Pipeline",
  version: "1.0.0"
}));

// Start server
Deno.serve(app.fetch);
