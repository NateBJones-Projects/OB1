import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import {
  extractText as docExtractText,
  getFileType,
  MIME_TYPES,
  chunkText,
  countWords,
  slugify,
} from "./document-extraction.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;
const DEFAULT_USER_ID = Deno.env.get("DEFAULT_USER_ID") || "";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Shared Helpers ─────────────────────────────────────────────────────────

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text.slice(0, 8000),
    }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of full names of people mentioned, e.g. "Ross Shepstone" not "Ross" (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 SHORT lowercase topic tags, e.g. "legal", "drafting", "arbitration" (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there. Topics must be lowercase. People must be full names.`,
        },
        { role: "user", content: text.slice(0, 4000) },
      ],
    }),
  });
  const d = await r.json();
  try {
    const raw = JSON.parse(d.choices[0].message.content);
    // Normalize: lowercase topics and deduplicate, use full names for people
    if (Array.isArray(raw.topics)) raw.topics = [...new Set(raw.topics.map((t: string) => t.toLowerCase()))];
    if (Array.isArray(raw.people)) raw.people = [...new Set(raw.people.map((p: string) => p.trim()))];
    if (Array.isArray(raw.action_items)) raw.action_items = raw.action_items.map((a: string) => a.trim());
    if (raw.type) raw.type = raw.type.toLowerCase();
    return raw;
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

// ─── Document extraction, chunking, file type detection, slugify ────────────
// All imported from ../supabase/functions/_shared/document-extraction.ts

// ═══════════════════════════════════════════════════════════════════════════
// MCP SERVER — Amicus Superbrain (unified)
// ═══════════════════════════════════════════════════════════════════════════

const server = new McpServer({
  name: "amicus-superbrain",
  version: "2.0.0",
});

// ─── THOUGHTS ───────────────────────────────────────────────────────────────

server.registerTool(
  "search_thoughts",
  {
    title: "Search Thoughts",
    description: "Search captured thoughts by meaning. Use this when the user asks about a topic, person, or idea they've previously captured.",
    inputSchema: {
      query: z.string().describe("What to search for"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.5),
    },
  },
  async ({ query, limit, threshold }) => {
    try {
      const qEmb = await getEmbedding(query);
      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: qEmb,
        match_threshold: threshold,
        match_count: limit,
        filter: {},
      });
      if (error) return { content: [{ type: "text" as const, text: `Search error: ${error.message}` }], isError: true };
      if (!data || data.length === 0) return { content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }] };

      const results = data.map(
        (t: { content: string; metadata: Record<string, unknown>; similarity: number; created_at: string }, i: number) => {
          const m = t.metadata || {};
          const parts = [
            `--- Result ${i + 1} (${(t.similarity * 100).toFixed(1)}% match) ---`,
            `Captured: ${new Date(t.created_at).toLocaleDateString()}`,
            `Type: ${m.type || "unknown"}`,
          ];
          if (Array.isArray(m.topics) && m.topics.length) parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
          if (Array.isArray(m.people) && m.people.length) parts.push(`People: ${(m.people as string[]).join(", ")}`);
          if (Array.isArray(m.action_items) && m.action_items.length) parts.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
          parts.push(`\n${t.content}`);
          return parts.join("\n");
        }
      );
      return { content: [{ type: "text" as const, text: `Found ${data.length} thought(s):\n\n${results.join("\n\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "list_thoughts",
  {
    title: "List Recent Thoughts",
    description: "List recently captured thoughts with optional filters by type, topic, person, or time range.",
    inputSchema: {
      limit: z.number().optional().default(10),
      type: z.string().optional().describe("Filter by type: observation, task, idea, reference, person_note"),
      topic: z.string().optional().describe("Filter by topic tag"),
      person: z.string().optional().describe("Filter by person mentioned"),
      days: z.number().optional().describe("Only thoughts from the last N days"),
    },
  },
  async ({ limit, type, topic, person, days }) => {
    try {
      let q = supabase.from("thoughts").select("content, metadata, created_at").order("created_at", { ascending: false }).limit(limit);
      if (type) q = q.contains("metadata", { type });
      if (topic) q = q.contains("metadata", { topics: [topic] });
      if (person) q = q.contains("metadata", { people: [person] });
      if (days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        q = q.gte("created_at", since.toISOString());
      }
      const { data, error } = await q;
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!data || !data.length) return { content: [{ type: "text" as const, text: "No thoughts found." }] };

      const results = data.map(
        (t: { content: string; metadata: Record<string, unknown>; created_at: string }, i: number) => {
          const m = t.metadata || {};
          const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
          return `${i + 1}. [${new Date(t.created_at).toLocaleDateString()}] (${m.type || "??"}${tags ? " - " + tags : ""})\n   ${t.content}`;
        }
      );
      return { content: [{ type: "text" as const, text: `${data.length} recent thought(s):\n\n${results.join("\n\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "capture_thought",
  {
    title: "Capture Thought",
    description: "Save a new thought to the Open Brain. Generates an embedding and extracts metadata automatically.",
    inputSchema: {
      content: z.string().describe("The thought to capture"),
    },
  },
  async ({ content }) => {
    try {
      const [embedding, metadata] = await Promise.all([getEmbedding(content), extractMetadata(content)]);
      const { error } = await supabase.from("thoughts").insert({ content, embedding, metadata: { ...metadata, source: "mcp" } });
      if (error) return { content: [{ type: "text" as const, text: `Failed to capture: ${error.message}` }], isError: true };

      const meta = metadata as Record<string, unknown>;
      let confirmation = `Captured as ${meta.type || "thought"}`;
      if (Array.isArray(meta.topics) && meta.topics.length) confirmation += ` — ${(meta.topics as string[]).join(", ")}`;
      if (Array.isArray(meta.people) && meta.people.length) confirmation += ` | People: ${(meta.people as string[]).join(", ")}`;
      if (Array.isArray(meta.action_items) && meta.action_items.length) confirmation += ` | Actions: ${(meta.action_items as string[]).join("; ")}`;
      return { content: [{ type: "text" as const, text: confirmation }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "thought_stats",
  {
    title: "Thought Statistics",
    description: "Get a summary of all captured thoughts: totals, types, top topics, and people.",
    inputSchema: {},
  },
  async () => {
    try {
      const { count } = await supabase.from("thoughts").select("*", { count: "exact", head: true });
      const { data } = await supabase.from("thoughts").select("metadata, created_at").order("created_at", { ascending: false });
      const types: Record<string, number> = {};
      const topics: Record<string, number> = {};
      const people: Record<string, number> = {};
      for (const r of data || []) {
        const m = (r.metadata || {}) as Record<string, unknown>;
        if (m.type) types[m.type as string] = (types[m.type as string] || 0) + 1;
        if (Array.isArray(m.topics)) for (const t of m.topics) topics[t as string] = (topics[t as string] || 0) + 1;
        if (Array.isArray(m.people)) for (const p of m.people) people[p as string] = (people[p as string] || 0) + 1;
      }
      const sort = (o: Record<string, number>): [string, number][] => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const lines: string[] = [
        `Total thoughts: ${count}`,
        `Date range: ${data?.length ? new Date(data[data.length - 1].created_at).toLocaleDateString() + " → " + new Date(data[0].created_at).toLocaleDateString() : "N/A"}`,
        "", "Types:", ...sort(types).map(([k, v]) => `  ${k}: ${v}`),
      ];
      if (Object.keys(topics).length) { lines.push("", "Top topics:"); for (const [k, v] of sort(topics)) lines.push(`  ${k}: ${v}`); }
      if (Object.keys(people).length) { lines.push("", "People mentioned:"); for (const [k, v] of sort(people)) lines.push(`  ${k}: ${v}`); }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── DOCUMENTS ──────────────────────────────────────────────────────────────

server.registerTool(
  "upload_document",
  {
    title: "Upload Document",
    description: "Upload a PDF, DOCX, XLSX, or PPTX document. Extracts text with structure-aware parsing (headings, tables, slides), creates searchable thoughts with embeddings, and stores the file. Optionally links to a matter and/or contact.",
    inputSchema: {
      file_base64: z.string().describe("Base64-encoded file content"),
      filename: z.string().describe("Original filename with extension (e.g., 'plea.pdf')"),
      matter_name: z.string().optional().describe("Legal matter name to link to"),
      contact_name: z.string().optional().describe("Contact or attorney name to link to"),
      description: z.string().optional().describe("Brief description of the document"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
    },
  },
  async ({ file_base64, filename, matter_name, contact_name, description, tags }) => {
    try {
      const binaryStr = atob(file_base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const fileType = getFileType(filename);

      const extraction = await docExtractText(bytes, fileType, filename);
      const { text: fullText, pages, quality: extractionQuality } = extraction;
      if (!fullText || fullText.trim().length < 10) {
        return { content: [{ type: "text" as const, text: `Warning: Very little text extracted from ${filename}. File may be scanned/image-based. Stored but not searchable.` }] };
      }
      const wc = countWords(fullText);

      let matterId: string | null = null;
      if (matter_name) {
        const { data } = await supabase.from("matters").select("id").ilike("name", `%${matter_name}%`).limit(1);
        if (data?.length) matterId = data[0].id;
      }

      let contactId: string | null = null;
      if (contact_name) {
        const { data } = await supabase.from("professional_contacts").select("id").or(`name.ilike.%${contact_name}%,company.ilike.%${contact_name}%`).limit(1);
        if (data?.length) contactId = data[0].id;
      }

      const folder = matter_name ? `matters/${slugify(matter_name)}` : "unsorted";
      const storagePath = `${folder}/${Date.now()}_${filename}`;
      const mimeType = MIME_TYPES[fileType] || "application/octet-stream";
      const { error: uploadError } = await supabase.storage.from("documents").upload(storagePath, bytes, { contentType: mimeType });
      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

      const prefix = `[Document: ${filename}${description ? " — " + description : ""}]\n\n`;
      const chunks = chunkText(fullText);
      const thoughtIds: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunkContent = i === 0 ? prefix + chunks[i] : `[Document: ${filename} — chunk ${i + 1}/${chunks.length}]\n\n${chunks[i]}`;
        const [embedding, metadata] = await Promise.all([
          getEmbedding(chunkContent),
          i === 0 ? extractMetadata(chunkContent) : Promise.resolve({ topics: ["document"], type: "reference" }),
        ]);
        const thoughtMeta = { ...metadata, source: "document", document_filename: filename, ...(matter_name && { matter_name }), ...(chunks.length > 1 && { chunk_index: i, total_chunks: chunks.length }) };
        const { data: td, error: te } = await supabase.from("thoughts").insert({ content: chunkContent, embedding, metadata: thoughtMeta }).select("id").single();
        if (te) throw new Error(`Thought insert failed: ${te.message}`);
        thoughtIds.push(td.id);
        if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 200));
      }

      const { error: docError } = await supabase.from("documents").insert({
        filename, file_type: fileType, file_size_bytes: bytes.length, storage_path: storagePath,
        full_text: fullText, page_count: pages, word_count: wc,
        matter_id: matterId, matter_name: matter_name || null, contact_id: contactId,
        thought_id: thoughtIds[0], chunk_thought_ids: thoughtIds.slice(1),
        description: description || null, tags: tags || [],
        extraction_quality: extractionQuality,
      });
      if (docError) throw new Error(`Document record failed: ${docError.message}`);

      const parts = [`Uploaded: ${filename}`, `Type: ${fileType.toUpperCase()} | ${pages} page(s) | ${wc.toLocaleString()} words | Converter: ${extractionQuality.converter}`, `Thoughts: ${thoughtIds.length}${chunks.length > 1 ? ` (${chunks.length} chunks)` : ""}`];
      if (matter_name) parts.push(`Matter: ${matter_name}${matterId ? " (linked)" : " (name stored)"}`);
      if (contact_name) parts.push(`Contact: ${contact_name}${contactId ? " (linked)" : " (no match)"}`);
      if (extractionQuality.quality_flags.length > 0) {
        parts.push(`Quality warnings: ${extractionQuality.quality_flags.join(", ")} — ${extractionQuality.recommended_next_step}`);
      }
      parts.push("Searchable via search_thoughts.");
      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Upload failed: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "search_documents",
  {
    title: "Search Documents",
    description: "Search uploaded documents by matter, contact, filename, or file type. For semantic content search, use search_thoughts.",
    inputSchema: {
      matter_name: z.string().optional().describe("Filter by matter name (partial match)"),
      contact_name: z.string().optional().describe("Filter by linked contact"),
      filename: z.string().optional().describe("Filter by filename (partial match)"),
      file_type: z.enum(["pdf", "docx", "xlsx", "pptx", "md", "txt"]).optional().describe("Filter by file type"),
      limit: z.number().optional().default(20),
    },
  },
  async ({ matter_name, contact_name, filename, file_type, limit }) => {
    try {
      let q = supabase.from("documents").select("id, filename, file_type, page_count, word_count, matter_name, description, created_at, contact_id, extraction_quality").order("created_at", { ascending: false }).limit(limit);
      if (matter_name) q = q.ilike("matter_name", `%${matter_name}%`);
      if (filename) q = q.ilike("filename", `%${filename}%`);
      if (file_type) q = q.eq("file_type", file_type);
      if (contact_name) {
        const { data: contacts } = await supabase.from("professional_contacts").select("id").or(`name.ilike.%${contact_name}%,company.ilike.%${contact_name}%`);
        if (contacts?.length) q = q.in("contact_id", contacts.map(c => c.id));
      }
      const { data, error } = await q;
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!data?.length) return { content: [{ type: "text" as const, text: "No documents found." }] };

      const results = data.map((d: { filename: string; file_type: string; page_count: number; word_count: number; matter_name: string; description: string; created_at: string; extraction_quality?: { quality_flags?: string[]; converter?: string } }, i: number) => {
        const eq = d.extraction_quality;
        const qualityNote = eq?.quality_flags?.length ? ` ⚠ ${eq.quality_flags.join(", ")}` : "";
        return `${i + 1}. ${d.filename} (${d.file_type.toUpperCase()}, ${d.page_count || "?"} pg, ${(d.word_count || 0).toLocaleString()} words${eq?.converter ? ", " + eq.converter : ""}${qualityNote})\n   Matter: ${d.matter_name || "—"} | ${new Date(d.created_at).toLocaleDateString()}${d.description ? "\n   " + d.description : ""}`;
      });
      return { content: [{ type: "text" as const, text: `${data.length} document(s):\n\n${results.join("\n\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "list_documents",
  {
    title: "List Documents",
    description: "List all documents, optionally filtered by matter name.",
    inputSchema: {
      matter_name: z.string().optional().describe("Matter name to filter by"),
      limit: z.number().optional().default(50),
    },
  },
  async ({ matter_name, limit }) => {
    try {
      let q = supabase.from("documents").select("filename, file_type, page_count, word_count, matter_name, created_at").order("matter_name").order("created_at", { ascending: false }).limit(limit);
      if (matter_name) q = q.ilike("matter_name", `%${matter_name}%`);
      const { data, error } = await q;
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!data?.length) return { content: [{ type: "text" as const, text: "No documents found." }] };

      const grouped = new Map<string, typeof data>();
      for (const d of data) { const key = d.matter_name || "Unsorted"; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key)!.push(d); }
      const lines: string[] = [];
      for (const [matter, docs] of grouped) {
        lines.push(`\n${matter}:`);
        for (const d of docs) lines.push(`  • ${d.filename} (${d.file_type.toUpperCase()}, ${d.page_count || "?"} pg, ${(d.word_count || 0).toLocaleString()} words) — ${new Date(d.created_at).toLocaleDateString()}`);
      }
      return { content: [{ type: "text" as const, text: `${data.length} document(s):${lines.join("\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── CRM: CONTACTS ─────────────────────────────────────────────────────────

server.registerTool(
  "add_professional_contact",
  {
    title: "Add Professional Contact",
    description: "Add a new professional contact to your network.",
    inputSchema: {
      name: z.string().describe("Contact's full name"),
      company: z.string().optional().describe("Company name"),
      title: z.string().optional().describe("Job title"),
      email: z.string().optional().describe("Email address"),
      phone: z.string().optional().describe("Phone number"),
      linkedin_url: z.string().optional().describe("LinkedIn profile URL"),
      how_we_met: z.string().optional().describe("How you met this person"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      notes: z.string().optional().describe("Additional notes"),
    },
  },
  async ({ name, company, title, email, phone, linkedin_url, how_we_met, tags, notes }) => {
    try {
      const { data, error } = await supabase.from("professional_contacts").insert({
        user_id: DEFAULT_USER_ID, name, company: company || null, title: title || null,
        email: email || null, phone: phone || null, linkedin_url: linkedin_url || null,
        how_we_met: how_we_met || null, tags: tags || [], notes: notes || null,
      }).select().single();
      if (error) throw new Error(error.message);
      return { content: [{ type: "text" as const, text: `Added contact: ${name}${company ? " (" + company + ")" : ""}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "search_contacts",
  {
    title: "Search Contacts",
    description: "Search professional contacts by name, company, or tags.",
    inputSchema: {
      query: z.string().optional().describe("Search term (name, company, title, notes)"),
      tags: z.array(z.string()).optional().describe("Filter by tags"),
    },
  },
  async ({ query, tags }) => {
    try {
      let q = supabase.from("professional_contacts").select("*").eq("user_id", DEFAULT_USER_ID);
      if (query) q = q.or(`name.ilike.%${query}%,company.ilike.%${query}%,title.ilike.%${query}%,notes.ilike.%${query}%`);
      if (tags && tags.length) q = q.contains("tags", tags);
      const { data, error } = await q.order("name");
      if (error) throw new Error(error.message);
      if (!data?.length) return { content: [{ type: "text" as const, text: "No contacts found." }] };

      const results = data.map((c: { name: string; company: string; email: string; last_contacted: string }, i: number) =>
        `${i + 1}. ${c.name}${c.company ? " — " + c.company : ""}${c.email ? " (" + c.email + ")" : ""}${c.last_contacted ? " | Last contact: " + new Date(c.last_contacted).toLocaleDateString() : ""}`
      );
      return { content: [{ type: "text" as const, text: `${data.length} contact(s):\n\n${results.join("\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "log_interaction",
  {
    title: "Log Interaction",
    description: "Log an interaction with a contact (auto-updates last_contacted).",
    inputSchema: {
      contact_id: z.string().describe("Contact ID (UUID)"),
      interaction_type: z.enum(["meeting", "email", "call", "coffee", "event", "linkedin", "other"]).describe("Type of interaction"),
      summary: z.string().describe("Summary of the interaction"),
      occurred_at: z.string().optional().describe("When it occurred (ISO 8601, defaults to now)"),
      follow_up_needed: z.boolean().optional().describe("Whether a follow-up is needed"),
      follow_up_notes: z.string().optional().describe("Follow-up notes"),
    },
  },
  async ({ contact_id, interaction_type, summary, occurred_at, follow_up_needed, follow_up_notes }) => {
    try {
      const { error } = await supabase.from("contact_interactions").insert({
        user_id: DEFAULT_USER_ID, contact_id, interaction_type,
        occurred_at: occurred_at || new Date().toISOString(),
        summary, follow_up_needed: follow_up_needed || false, follow_up_notes: follow_up_notes || null,
      });
      if (error) throw new Error(error.message);
      return { content: [{ type: "text" as const, text: `Interaction logged: ${interaction_type} — ${summary}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "get_contact_history",
  {
    title: "Contact History",
    description: "Get a contact's full profile, interactions, and opportunities.",
    inputSchema: {
      contact_id: z.string().describe("Contact ID (UUID)"),
    },
  },
  async ({ contact_id }) => {
    try {
      const { data: contact, error: ce } = await supabase.from("professional_contacts").select("*").eq("id", contact_id).single();
      if (ce) throw new Error(ce.message);
      const { data: interactions } = await supabase.from("contact_interactions").select("*").eq("contact_id", contact_id).order("occurred_at", { ascending: false });
      const { data: opportunities } = await supabase.from("opportunities").select("*").eq("contact_id", contact_id).order("created_at", { ascending: false });

      const lines = [`Contact: ${contact.name}${contact.company ? " — " + contact.company : ""}`, `Email: ${contact.email || "—"} | Phone: ${contact.phone || "—"}`, `Last contacted: ${contact.last_contacted ? new Date(contact.last_contacted).toLocaleDateString() : "Never"}`];
      if (contact.notes) lines.push(`Notes: ${contact.notes}`);
      if (interactions?.length) {
        lines.push(`\nInteractions (${interactions.length}):`);
        for (const i of interactions.slice(0, 20)) lines.push(`  ${new Date(i.occurred_at).toLocaleDateString()} [${i.interaction_type}] ${i.summary}`);
      }
      if (opportunities?.length) {
        lines.push(`\nOpportunities (${opportunities.length}):`);
        for (const o of opportunities) lines.push(`  ${o.title} — ${o.stage}${o.value ? " (R " + o.value.toLocaleString() + ")" : ""}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "create_opportunity",
  {
    title: "Create Opportunity",
    description: "Create a new opportunity/deal, optionally linked to a contact.",
    inputSchema: {
      title: z.string().describe("Opportunity title"),
      contact_id: z.string().optional().describe("Contact ID (UUID)"),
      description: z.string().optional().describe("Detailed description"),
      stage: z.enum(["identified", "in_conversation", "proposal", "negotiation", "won", "lost"]).optional().describe("Current stage"),
      value: z.number().optional().describe("Estimated value"),
      expected_close_date: z.string().optional().describe("Expected close date (YYYY-MM-DD)"),
      notes: z.string().optional().describe("Additional notes"),
    },
  },
  async ({ title, contact_id, description, stage, value, expected_close_date, notes }) => {
    try {
      const { error } = await supabase.from("opportunities").insert({
        user_id: DEFAULT_USER_ID, contact_id: contact_id || null, title,
        description: description || null, stage: stage || "identified",
        value: value || null, expected_close_date: expected_close_date || null, notes: notes || null,
      });
      if (error) throw new Error(error.message);
      return { content: [{ type: "text" as const, text: `Created opportunity: ${title}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "get_follow_ups_due",
  {
    title: "Follow-ups Due",
    description: "List contacts with follow-ups due in the past or next N days.",
    inputSchema: {
      days_ahead: z.number().optional().describe("Days to look ahead (default: 7)"),
    },
  },
  async ({ days_ahead }) => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const future = new Date();
      future.setDate(future.getDate() + (days_ahead || 7));
      const futureStr = future.toISOString().split("T")[0];

      const { data, error } = await supabase.from("professional_contacts").select("name, company, follow_up_date").eq("user_id", DEFAULT_USER_ID).not("follow_up_date", "is", null).lte("follow_up_date", futureStr).order("follow_up_date");
      if (error) throw new Error(error.message);
      if (!data?.length) return { content: [{ type: "text" as const, text: "No follow-ups due." }] };

      const overdue = data.filter(c => c.follow_up_date! < today);
      const upcoming = data.filter(c => c.follow_up_date! >= today);
      const lines: string[] = [];
      if (overdue.length) { lines.push(`OVERDUE (${overdue.length}):`); for (const c of overdue) lines.push(`  ${c.follow_up_date} — ${c.name}${c.company ? " (" + c.company + ")" : ""}`); }
      if (upcoming.length) { lines.push(`\nUpcoming (${upcoming.length}):`); for (const c of upcoming) lines.push(`  ${c.follow_up_date} — ${c.name}${c.company ? " (" + c.company + ")" : ""}`); }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "link_thought_to_contact",
  {
    title: "Link Thought to Contact",
    description: "Link a thought from Open Brain to a professional contact.",
    inputSchema: {
      thought_id: z.string().describe("Thought ID (UUID)"),
      contact_id: z.string().describe("Contact ID (UUID)"),
    },
  },
  async ({ thought_id, contact_id }) => {
    try {
      const { data: thought, error: te } = await supabase.from("thoughts").select("content").eq("id", thought_id).single();
      if (te) throw new Error(te.message);
      const { data: contact, error: ce } = await supabase.from("professional_contacts").select("name, notes").eq("id", contact_id).single();
      if (ce) throw new Error(ce.message);

      const linkNote = `\n\n[Linked Thought ${new Date().toISOString().split("T")[0]}]: ${thought.content}`;
      const { error } = await supabase.from("professional_contacts").update({ notes: (contact.notes || "") + linkNote }).eq("id", contact_id);
      if (error) throw new Error(error.message);
      return { content: [{ type: "text" as const, text: `Linked thought to ${contact.name}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── TIME TRACKING ──────────────────────────────────────────────────────────

server.registerTool(
  "log_time",
  {
    title: "Log Time",
    description: "Log a time entry for a matter. Looks up the matter and task type by name.",
    inputSchema: {
      date: z.string().describe("Date (YYYY-MM-DD)"),
      matter_name: z.string().describe("Matter/project name (partial match OK)"),
      task_name: z.string().describe("Task type name (e.g., 'Drafting', 'Consultation')"),
      hours: z.number().describe("Hours worked"),
      comment: z.string().optional().describe("Description of work done"),
    },
  },
  async ({ date, matter_name, task_name, hours, comment }) => {
    try {
      const { data: matterData } = await supabase.from("matters").select("id, name").ilike("name", `%${matter_name}%`).limit(1);
      const matterId = matterData?.[0]?.id || null;
      const matterMatch = matterData?.[0]?.name || matter_name;

      const { data: taskData } = await supabase.from("task_types").select("id, name, rate_cents, rate_type").ilike("name", `%${task_name}%`).limit(1);
      const taskId = taskData?.[0]?.id || null;
      const taskMatch = taskData?.[0]?.name || task_name;
      const rate = taskData?.[0]?.rate_cents || 0;
      const rateType = taskData?.[0]?.rate_type || "hourly";

      const { error } = await supabase.from("time_entries").insert({
        user_id: DEFAULT_USER_ID, date, matter_id: matterId, task_type_id: taskId, hours, comment: comment || null,
      });
      if (error) throw new Error(error.message);

      const value = rateType === "hourly" ? (rate / 100) * hours : rate / 100;
      const lines = [`Logged: ${hours}h on ${date}`, `Matter: ${matterMatch}${matterId ? "" : " (no DB match)"}`, `Task: ${taskMatch}${taskId ? "" : " (no DB match)"}`, `Value: R ${value.toLocaleString()}`];
      if (comment) lines.push(`Comment: ${comment}`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "list_time_entries",
  {
    title: "List Time Entries",
    description: "List time entries, optionally filtered by matter, date range, or recent days.",
    inputSchema: {
      matter_name: z.string().optional().describe("Filter by matter name"),
      days: z.number().optional().describe("Only entries from the last N days"),
      date_from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      date_to: z.string().optional().describe("End date (YYYY-MM-DD)"),
      limit: z.number().optional().default(50),
    },
  },
  async ({ matter_name, days, date_from, date_to, limit }) => {
    try {
      let q = supabase.from("time_entries").select("date, hours, comment, matter_id, task_type_id").eq("user_id", DEFAULT_USER_ID).order("date", { ascending: false }).limit(limit);
      if (days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        q = q.gte("date", since.toISOString().split("T")[0]);
      }
      if (date_from) q = q.gte("date", date_from);
      if (date_to) q = q.lte("date", date_to);

      if (matter_name) {
        const { data: matters } = await supabase.from("matters").select("id").ilike("name", `%${matter_name}%`);
        if (matters?.length) q = q.in("matter_id", matters.map(m => m.id));
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      if (!data?.length) return { content: [{ type: "text" as const, text: "No time entries found." }] };

      // Load matter and task names for display
      const matterIds = [...new Set(data.map(d => d.matter_id).filter(Boolean))];
      const taskIds = [...new Set(data.map(d => d.task_type_id).filter(Boolean))];
      const { data: mattersData } = await supabase.from("matters").select("id, name").in("id", matterIds);
      const { data: tasksData } = await supabase.from("task_types").select("id, name").in("id", taskIds);
      const mMap = new Map((mattersData || []).map(m => [m.id, m.name]));
      const tMap = new Map((tasksData || []).map(t => [t.id, t.name]));

      let totalHours = 0;
      const results = data.map((e: { date: string; hours: number; comment: string; matter_id: string; task_type_id: string }, i: number) => {
        totalHours += e.hours;
        return `${e.date} | ${e.hours}h | ${mMap.get(e.matter_id) || "—"} | ${tMap.get(e.task_type_id) || "—"}${e.comment ? " — " + e.comment : ""}`;
      });
      return { content: [{ type: "text" as const, text: `${data.length} entries (${totalHours}h total):\n\n${results.join("\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "list_matters",
  {
    title: "List Matters",
    description: "List active legal matters, optionally filtered by attorney/customer name.",
    inputSchema: {
      customer_name: z.string().optional().describe("Filter by attorney/firm name"),
      status: z.enum(["active", "closed", "on_hold"]).optional().describe("Filter by status (default: active)"),
      limit: z.number().optional().default(50),
    },
  },
  async ({ customer_name, status, limit }) => {
    try {
      let q = supabase.from("matters").select("name, customer_name, status, notes").eq("user_id", DEFAULT_USER_ID).order("customer_name").limit(limit);
      if (status) q = q.eq("status", status); else q = q.eq("status", "active");
      if (customer_name) q = q.ilike("customer_name", `%${customer_name}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      if (!data?.length) return { content: [{ type: "text" as const, text: "No matters found." }] };

      const grouped = new Map<string, string[]>();
      for (const m of data) {
        const key = m.customer_name || "Unknown";
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(m.name);
      }
      const lines: string[] = [];
      for (const [attorney, matters] of grouped) {
        lines.push(`\n${attorney} (${matters.length}):`);
        for (const m of matters) lines.push(`  • ${m}`);
      }
      return { content: [{ type: "text" as const, text: `${data.length} active matter(s):${lines.join("\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── OUTLOOK INTEGRATION ────────────────────────────────────────────────────

server.registerTool(
  "connect_outlook",
  {
    title: "Connect Outlook",
    description: "Connect your Outlook email for automatic sync. Initiates Microsoft sign-in. After calling this, the user must visit the URL and enter the code, then call complete_outlook_connection.",
    inputSchema: {},
  },
  async () => {
    try {
      const authUrl = `${SUPABASE_URL}/functions/v1/outlook-auth?key=${Deno.env.get("MCP_ACCESS_KEY")}`;
      const res = await fetch(authUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", user_id: DEFAULT_USER_ID }),
      });
      const data = await res.json();
      if (data.error) return { content: [{ type: "text" as const, text: `Error: ${data.error}` }], isError: true };

      return {
        content: [{
          type: "text" as const,
          text: `To connect your Outlook:\n\n1. Go to: ${data.verification_uri}\n2. Enter code: ${data.user_code}\n3. Sign in with your Microsoft account\n4. Then tell me "I've signed in" and I'll complete the connection.\n\nDevice code: ${data.device_code}`,
        }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "complete_outlook_connection",
  {
    title: "Complete Outlook Connection",
    description: "Complete the Outlook connection after the user has signed in. Pass the device_code from connect_outlook.",
    inputSchema: {
      device_code: z.string().describe("Device code from connect_outlook"),
    },
  },
  async ({ device_code }) => {
    try {
      const authUrl = `${SUPABASE_URL}/functions/v1/outlook-auth?key=${Deno.env.get("MCP_ACCESS_KEY")}`;
      const res = await fetch(authUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", user_id: DEFAULT_USER_ID, device_code }),
      });
      const data = await res.json();

      if (data.status === "pending") return { content: [{ type: "text" as const, text: "Still waiting for sign-in. Please complete the Microsoft sign-in and try again." }] };
      if (data.error) return { content: [{ type: "text" as const, text: `Error: ${data.error}` }], isError: true };

      const lines = [`Outlook connected successfully!`, `Webhook: ${data.webhook}`];
      if (data.webhook_expiration) lines.push(`Webhook expires: ${new Date(data.webhook_expiration).toLocaleDateString()}`);
      lines.push("\nYour emails from CRM contacts will now sync automatically.");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "sync_outlook",
  {
    title: "Sync Outlook Now",
    description: "Manually trigger an Outlook email sync. Imports recent emails from CRM contacts.",
    inputSchema: {
      hours_back: z.number().optional().default(4).describe("Hours to look back (default: 4)"),
    },
  },
  async ({ hours_back }) => {
    try {
      const syncUrl = `${SUPABASE_URL}/functions/v1/outlook-sync?key=${Deno.env.get("MCP_ACCESS_KEY")}`;
      const res = await fetch(syncUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync-user", user_id: DEFAULT_USER_ID, hours_back }),
      });
      const data = await res.json();

      if (data.error) return { content: [{ type: "text" as const, text: `Sync failed: ${data.error}` }], isError: true };

      return {
        content: [{
          type: "text" as const,
          text: `Email sync complete:\n  Ingested: ${data.ingested}\n  Skipped: ${data.skipped}\n  Errors: ${data.errors}`,
        }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "outlook_status",
  {
    title: "Outlook Connection Status",
    description: "Check if Outlook email sync is connected and active.",
    inputSchema: {},
  },
  async () => {
    try {
      const statusUrl = `${SUPABASE_URL}/functions/v1/outlook-auth?key=${Deno.env.get("MCP_ACCESS_KEY")}`;
      const res = await fetch(statusUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", user_id: DEFAULT_USER_ID }),
      });
      const data = await res.json();

      if (!data.connected) {
        return { content: [{ type: "text" as const, text: "Outlook is not connected. Use connect_outlook to set it up." }] };
      }

      const lines = [
        "Outlook: Connected",
        `Token expires: ${new Date(data.token_expires).toLocaleString()}`,
        `Last refreshed: ${new Date(data.token_last_refreshed).toLocaleString()}`,
        `Active webhooks: ${data.active_webhooks}`,
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// Hono App with Auth + CORS
// ═══════════════════════════════════════════════════════════════════════════

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

const app = new Hono();

app.options("*", (c) => {
  return c.text("ok", 200, corsHeaders);
});

// Handle DELETE for session termination (Claude sends this)
app.delete("*", (c) => {
  return c.text("ok", 200, corsHeaders);
});

// Handle GET — route SSE requests through MCP transport, serve health check otherwise
app.get("*", async (c) => {
  if (c.req.header("accept")?.includes("text/event-stream")) {
    return transport.handleRequest(c);
  }
  return c.json({ status: "ok", service: "amicus-superbrain", version: "2.0.0" }, 200, corsHeaders);
});

app.post("*", async (c) => {
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401, corsHeaders);
  }

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

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
