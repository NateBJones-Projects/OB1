/**
 * Schema-Aware Routing Pattern for Open Brain (OB1)
 *
 * This module demonstrates a pattern where an LLM extracts structured metadata
 * from unstructured text, then routes that data to the correct database tables
 * based on the extracted schema fields.
 *
 * Flow:
 *   Raw text → LLM metadata extraction → Schema-aware routing → Multi-table writes
 *
 * Tables written to:
 *   - thoughts      (always — the raw capture)
 *   - people        (if people are mentioned — with fuzzy match / create / link)
 *   - interactions  (one per person found — links person ↔ thought)
 *   - action_items  (only if the speaker commits to first-person action)
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExtractedMetadata {
  people: PersonMention[];
  action_items: string[];
  dates_mentioned: string[];
  topics: string[];
  type: "task" | "observation" | "idea" | "reference" | "person_note";
  domain: "work" | "family" | "personal" | "health" | "finance" | "home";
}

interface PersonMention {
  name: string;
  relationship_type: string | null;
  role: string | null;
}

interface PersonResult {
  name: string;
  id: string;
  action: "found" | "created" | "pending";
}

interface WriteResult {
  table: string;
  success: boolean;
  error?: string;
  details?: string;
}

interface RoutingOutcome {
  thoughtId: string | null;
  writes: WriteResult[];
  people: PersonResult[];
}

// ---------------------------------------------------------------------------
// 1. LLM Metadata Extraction
// ---------------------------------------------------------------------------
// The LLM prompt is the heart of the routing system. It defines the schema
// that downstream routing decisions depend on. Every field here maps to a
// table or a column somewhere in the database.

const EXTRACTION_SYSTEM_PROMPT = `Extract metadata from a captured thought. Return JSON with:
- "people": array of objects for each person mentioned, each with:
  - "name": the person's name
  - "relationship_type": broad category — one of "family", "friend", "colleague",
    "student", "manager", "professional_contact", "contractor", "service_provider", "other"
  - "role": specific title or role (e.g., "daughter", "principal", "accountant")
- "action_items": array of to-dos ONLY if the speaker is explicitly committing to
  do something themselves using first-person intent ("I need to", "I should",
  "I have to", "remind me to"). If someone ELSE wants something, leave this empty.
- "dates_mentioned": array of dates in YYYY-MM-DD format (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": use "task" ONLY for first-person commitments. Everything else is
  "observation", "idea", "reference", or "person_note".
- "domain": one of "work", "family", "personal", "health", "finance", "home"

Only extract what is explicitly there.`;

/**
 * Call your LLM of choice to extract structured metadata from raw text.
 * Replace this with your own LLM integration (OpenAI, Anthropic, OpenRouter, etc.)
 */
async function extractMetadata(text: string): Promise<ExtractedMetadata> {
  // YOUR LLM CALL HERE — send EXTRACTION_SYSTEM_PROMPT as system message,
  // text as user message, request JSON response format.
  //
  // Example with OpenAI-compatible API:
  //
  //   const response = await fetch("https://api.openai.com/v1/chat/completions", {
  //     method: "POST",
  //     headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  //     body: JSON.stringify({
  //       model: "gpt-4o-mini",
  //       response_format: { type: "json_object" },
  //       messages: [
  //         { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
  //         { role: "user", content: text },
  //       ],
  //     }),
  //   });
  //   return JSON.parse((await response.json()).choices[0].message.content);

  throw new Error("Replace this with your LLM call");
}

/**
 * Generate an embedding vector for the input text.
 * Used for semantic search across thoughts and interactions.
 */
async function getEmbedding(text: string): Promise<number[]> {
  // YOUR EMBEDDING CALL HERE — e.g. OpenAI text-embedding-3-small
  throw new Error("Replace this with your embedding call");
}

// ---------------------------------------------------------------------------
// 2. People Routing — Find, Fuzzy-Match, or Create
// ---------------------------------------------------------------------------

/**
 * Fuzzy name matching — only triggers on first-name similarity.
 * Same last name alone is NOT considered a match.
 */
function namesAreSimilar(name1: string, name2: string): boolean {
  const n1 = name1.toLowerCase().trim();
  const n2 = name2.toLowerCase().trim();

  if (n1 === n2) return true;

  const first1 = n1.split(/\s+/)[0];
  const first2 = n2.split(/\s+/)[0];

  // First names identical and at least 3 chars
  if (first1 === first2 && first1.length >= 3) return true;

  // One first name contains the other (e.g. "Rob" ↔ "Robert")
  if (first1.length >= 3 && first2.length >= 3) {
    if (first1.includes(first2) || first2.includes(first1)) return true;
  }

  return false;
}

/**
 * Three-pass person resolution:
 *   Pass 1 — Exact match on name or aliases → link to existing person
 *   Pass 2 — Fuzzy match on first name → flag for human confirmation
 *   Pass 3 — First-name collision detection → flag for human confirmation
 *   Default — No match → create new person
 */
async function findOrCreatePerson(
  supabase: SupabaseClient,
  person: PersonMention,
): Promise<PersonResult> {
  const { data: allPeople } = await supabase
    .from("people")
    .select("id, name, aliases, relationship_type, role")
    .eq("status", "active");

  const nameLower = person.name.toLowerCase().trim();

  // --- Pass 1: Exact match by name or alias ---
  for (const existing of allPeople || []) {
    const nameMatch = existing.name.toLowerCase().trim() === nameLower;
    const aliasMatch = (existing.aliases || []).some(
      (a: string) => a.toLowerCase().trim() === nameLower
    );

    if (nameMatch || aliasMatch) {
      // Backfill missing metadata on the existing record
      const updates: Record<string, unknown> = {};
      if (person.role && !existing.role) updates.role = person.role;
      if (person.relationship_type && !existing.relationship_type) {
        updates.relationship_type = person.relationship_type;
      }
      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();
        await supabase.from("people").update(updates).eq("id", existing.id);
      }

      return { name: person.name, id: existing.id, action: "found" };
    }
  }

  // --- Pass 2: Fuzzy match → needs human confirmation ---
  for (const existing of allPeople || []) {
    if (namesAreSimilar(person.name, existing.name)) {
      // In production, post a confirmation request to your inbox/queue
      // e.g. "New person 'Mike S.' looks like 'Mike Smith' — same person?"
      console.log(
        `⏳ Fuzzy match: "${person.name}" ≈ "${existing.name}" — needs confirmation`
      );
      return { name: person.name, id: "", action: "pending" };
    }
  }

  // --- Pass 3: First-name collision detection ---
  const newFirst = nameLower.split(/\s+/)[0];
  if (newFirst.length >= 3) {
    for (const existing of allPeople || []) {
      const existingFirst = existing.name.toLowerCase().trim().split(/\s+/)[0];
      if (newFirst === existingFirst && nameLower !== existing.name.toLowerCase().trim()) {
        console.log(
          `⚠️ First-name collision: "${person.name}" vs "${existing.name}" — needs confirmation`
        );
        return { name: person.name, id: "", action: "pending" };
      }
    }
  }

  // --- Default: Create new person ---
  const insertData: Record<string, unknown> = { name: person.name, status: "active" };
  if (person.relationship_type) insertData.relationship_type = person.relationship_type;
  if (person.role) insertData.role = person.role;

  const { data: newPerson, error } = await supabase
    .from("people")
    .insert(insertData)
    .select("id")
    .single();

  if (error) return { name: person.name, id: "", action: "created" };
  return { name: person.name, id: newPerson.id, action: "created" };
}

// ---------------------------------------------------------------------------
// 3. The Main Router — Schema-Aware Multi-Table Writes
// ---------------------------------------------------------------------------

/**
 * processThought() is the core routing function.
 *
 * It takes raw text, extracts structured metadata via LLM, then routes
 * each piece of data to the correct table based on the schema fields.
 *
 * Routing rules:
 *   1. ALWAYS write to `thoughts` (the raw capture — never lost)
 *   2. For each person in metadata.people → resolve via findOrCreatePerson,
 *      then write an `interactions` record linking person ↔ thought
 *   3. For each item in metadata.action_items → write to `action_items`
 *      (only populated when speaker uses first-person intent)
 */
async function processThought(
  supabase: SupabaseClient,
  text: string,
  source: string = "api",
): Promise<RoutingOutcome> {
  const writes: WriteResult[] = [];
  const people: PersonResult[] = [];

  // Step 1: Extract metadata and embedding in parallel
  const [embedding, metadata] = await Promise.all([
    getEmbedding(text),
    extractMetadata(text),
  ]);

  const domain = metadata.domain || "personal";

  // -----------------------------------------------------------------------
  // Route 1: THOUGHTS table (always written)
  // -----------------------------------------------------------------------
  const { data: thoughtData, error: thoughtError } = await supabase
    .from("thoughts")
    .insert({
      content: text,
      embedding,
      domain,
      status: "active",
      source,
      metadata: { ...metadata },
    })
    .select("id")
    .single();

  const thoughtId = thoughtData?.id || null;

  writes.push({
    table: "thoughts",
    success: !thoughtError,
    error: thoughtError?.message,
  });

  // -----------------------------------------------------------------------
  // Route 2: PEOPLE table (find/create) + INTERACTIONS table (link)
  // -----------------------------------------------------------------------
  for (const personMention of metadata.people) {
    const result = await findOrCreatePerson(supabase, personMention);
    people.push(result);

    if (result.action === "created") {
      writes.push({ table: "people", success: true, details: `Created: ${result.name}` });
    }

    // Write an interaction record for every resolved person
    if (result.id) {
      const { error: interactionError } = await supabase.from("interactions").insert({
        person_id: result.id,
        note: text,
        source,
        embedding,
      });

      writes.push({
        table: "interactions",
        success: !interactionError,
        error: interactionError?.message,
        details: `For: ${result.name}`,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Route 3: ACTION_ITEMS table (only first-person commitments)
  // -----------------------------------------------------------------------
  for (const actionItem of metadata.action_items) {
    const linkedPersonId = people.find((p) => p.id)?.id || null;

    const { error: actionError } = await supabase.from("action_items").insert({
      title: actionItem,
      domain,
      source,
      status: "open",
      linked_person_id: linkedPersonId,
    });

    writes.push({
      table: "action_items",
      success: !actionError,
      error: actionError?.message,
      details: actionItem.substring(0, 50),
    });
  }

  return { thoughtId, writes, people };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  processThought,
  findOrCreatePerson,
  extractMetadata,
  namesAreSimilar,
  EXTRACTION_SYSTEM_PROMPT,
};

export type {
  ExtractedMetadata,
  PersonMention,
  PersonResult,
  WriteResult,
  RoutingOutcome,
};
