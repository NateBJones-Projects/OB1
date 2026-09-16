/**
 * Adaptive Capture Classification — TypeScript reference implementation
 *
 * Wraps OB1's capture flow with confidence gating and a per-type learning loop.
 * Uses the Supabase JS client for database access and fetch() for LLM calls.
 *
 * Prerequisites:
 *   - schema.sql applied to your Supabase project
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY set in environment
 *   - `npm install @supabase/supabase-js`
 *
 * Adapt callLLM() to point at your preferred AI gateway (OpenRouter shown here).
 * Adapt writeToOB1() to call your OB1 capture MCP tool or REST endpoint.
 */

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;

const DEFAULT_MODEL = "openai/gpt-4o-mini"; // swap for any OpenRouter model
const DEFAULT_THRESHOLD = 0.75;
const THRESHOLD_MIN = 0.50;
const THRESHOLD_MAX = 0.95;
const THRESHOLD_NUDGE = 0.02;
const CONSISTENCY_CUTOFF = 9;   // re-run if confidence below this
const CONSISTENCY_FACTOR = 0.6; // penalty when two runs disagree on type

// OB1 canonical capture types — edit to match your thoughts table
const OB1_TYPES = [
  "idea", "task", "person_note", "reference",
  "decision", "lesson", "meeting", "journal",
] as const;

type CaptureType = typeof OB1_TYPES[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Classified {
  type: CaptureType;
  title: string;
  tags: string[];
  project: string | null;
  due_date: string | null;
  confidence: number; // 0–10
  model: string;
}

interface PipelineResult {
  classified: Classified;
  autoClassify: boolean;
  outcomeId: string;
  threshold: number;
}

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// LLM classification
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a capture classifier for a personal knowledge management system.
Analyse the given text and return a JSON object with classification metadata.
Return ONLY the JSON object — no markdown fences, no explanation, no extra text.`;

function buildUserPrompt(content: string, userContext: string, hintType?: CaptureType): string {
  const typeNote = hintType
    ? ` — you MUST use "${hintType}" for this field`
    : "";
  return `User context (use this to identify projects and domain):
${userContext || "(not provided)"}

---

Classify the following capture:
"${content}"

Return a JSON object with exactly these fields:
- "type": one of ${JSON.stringify(OB1_TYPES)}${typeNote}
- "title": short descriptive title, 3–7 words, sentence case
- "tags": array of 1–3 relevant lowercase keywords (not the type name, not the project name)
- "project": one of the user's active project names if clearly relevant, otherwise null
- "due_date": ISO 8601 date string if a specific deadline is stated, otherwise null
- "confidence": integer 0–10 — how confident you are in the type classification`;
}

async function callLLM(
  content: string,
  userContext: string,
  model: string,
  hintType?: CaptureType,
): Promise<Classified> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(content, userContext, hintType) },
      ],
    }),
  });

  const data = await response.json();
  const raw = data.choices[0].message.content as string;
  const parsed = JSON.parse(raw.replace(/```(?:json)?\s*|\s*```/g, "").trim());

  const type = OB1_TYPES.includes(parsed.type) ? parsed.type as CaptureType : "idea";
  const confidence = Math.max(0, Math.min(10, Math.round(Number(parsed.confidence ?? 7))));

  return {
    type: hintType ?? type,
    title: String(parsed.title || content.slice(0, 60)),
    tags: (parsed.tags ?? []).map((t: unknown) => String(t).toLowerCase()),
    project: parsed.project ?? null,
    due_date: parsed.due_date ?? null,
    confidence: hintType ? 10 : confidence,
    model,
  };
}

// ---------------------------------------------------------------------------
// Threshold management
// ---------------------------------------------------------------------------

async function getThreshold(itemType: string): Promise<number> {
  const { data } = await db
    .from("capture_thresholds")
    .select("threshold")
    .eq("item_type", itemType)
    .maybeSingle();
  return data ? Number(data.threshold) : DEFAULT_THRESHOLD;
}

async function adjustThreshold(itemType: string, accepted: boolean): Promise<void> {
  const current = await getThreshold(itemType);
  const { data: thresholdRow } = await db
    .from("capture_thresholds")
    .select("sample_count")
    .eq("item_type", itemType)
    .maybeSingle();
  const delta = accepted ? -THRESHOLD_NUDGE : +THRESHOLD_NUDGE;
  const newVal = Math.max(THRESHOLD_MIN, Math.min(THRESHOLD_MAX, current + delta));

  await db.from("capture_thresholds").upsert({
    item_type: itemType,
    threshold: newVal,
    sample_count: (thresholdRow?.sample_count ?? 0) + 1,
    updated_at: new Date().toISOString(),
  }, { onConflict: "item_type" });
}

// ---------------------------------------------------------------------------
// Outcome recording
// ---------------------------------------------------------------------------

async function recordOutcome(classified: Classified, autoClassify: boolean): Promise<string> {
  const id = crypto.randomUUID();
  await db.from("classification_outcomes").insert({
    id,
    model: classified.model,
    item_type: classified.type,
    confidence: classified.confidence,
    auto_classified: autoClassify,
    created_at: new Date().toISOString(),
  });
  return id;
}

async function resolveOutcome(
  outcomeId: string,
  accepted: boolean,
  userCorrection?: string,
): Promise<void> {
  await db.from("classification_outcomes").update({
    user_accepted: accepted,
    user_correction: userCorrection ?? null,
  }).eq("id", outcomeId);
}

// ---------------------------------------------------------------------------
// OB1 capture — replace with your MCP tool call or REST endpoint
// ---------------------------------------------------------------------------

async function writeToOB1(classified: Classified): Promise<void> {
  // Example: direct Supabase insert into the thoughts table.
  // If you use the OB1 MCP tool, call it here instead.
  await db.from("thoughts").insert({
    content: classified.title,
    type: classified.type,
    tags: classified.tags,
    project: classified.project,
    due_date: classified.due_date,
    created_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Process a capture through the full gating pipeline.
 * Returns a PipelineResult — the caller decides what to do based on autoClassify.
 */
export async function processCapture(
  rawText: string,
  options: {
    userContext?: string;
    hintType?: CaptureType;
    model?: string;
  } = {},
): Promise<PipelineResult> {
  const { userContext = "", hintType, model = DEFAULT_MODEL } = options;

  // Step 1: classify
  let classified = await callLLM(rawText, userContext, model, hintType);

  // Step 2: optional consistency check
  if (!hintType && classified.confidence < CONSISTENCY_CUTOFF) {
    const second = await callLLM(rawText, userContext, model);
    if (second.type !== classified.type) {
      classified.confidence = Math.round(classified.confidence * CONSISTENCY_FACTOR);
    }
  }

  // Step 3: look up learned threshold
  const threshold = await getThreshold(classified.type);

  // Step 4: gate
  const autoClassify = hintType !== undefined || (classified.confidence / 10) >= threshold;

  // Step 5: record outcome (user_accepted filled in later via completeCapture)
  const outcomeId = await recordOutcome(classified, autoClassify);

  return { classified, autoClassify, outcomeId, threshold };
}

/**
 * Complete a capture after the user has confirmed or corrected it.
 * Call this whether the capture was auto-classified or manually confirmed.
 */
export async function completeCapture(
  outcomeId: string,
  classified: Classified,
  accepted: boolean,
  userCorrection?: CaptureType,
): Promise<void> {
  if (accepted) {
    await writeToOB1(classified);
  }
  await resolveOutcome(outcomeId, accepted, userCorrection);
  await adjustThreshold(classified.type, accepted);
}

// ---------------------------------------------------------------------------
// Example usage
// ---------------------------------------------------------------------------

/*
const result = await processCapture("need to follow up with Sarah re the proposal", {
  userContext: "Active projects: client pitch, Q2 planning. Team: Sarah, James.",
});

if (result.autoClassify) {
  // High confidence — write immediately and record positive feedback
  await completeCapture(result.outcomeId, result.classified, true);
  console.log(`Captured as ${result.classified.type}: ${result.classified.title}`);
} else {
  // Low confidence — ask the user
  console.log(
    `I think this is a ${result.classified.type}: "${result.classified.title}"\n` +
    `Confidence: ${result.classified.confidence}/10. Correct? [y/n]`
  );

  // On user confirmation:
  const accepted = true; // replace with actual user input
  await completeCapture(result.outcomeId, result.classified, accepted);
}
*/
