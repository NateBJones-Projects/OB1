import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { Hono } from "npm:hono";
import { createClient } from "npm:@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Sweep window in minutes — tasks whose cron fired within this window get executed.
const SWEEP_WINDOW_MINUTES = 15;

// ──────────────────────────────────────────────
// Cron Expression Parser (5-field: min hour dom month dow)
// ──────────────────────────────────────────────

function cronMatchesNow(expression: string, now: Date, windowMinutes: number): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts;

  // Check each minute in the window to see if cron would have fired
  for (let offset = 0; offset < windowMinutes; offset++) {
    const check = new Date(now.getTime() - offset * 60_000);
    if (
      fieldMatches(minExpr, check.getMinutes()) &&
      fieldMatches(hourExpr, check.getHours()) &&
      fieldMatches(domExpr, check.getDate()) &&
      fieldMatches(monthExpr, check.getMonth() + 1) &&
      fieldMatches(dowExpr, check.getDay())
    ) {
      return true;
    }
  }
  return false;
}

function fieldMatches(expr: string, value: number): boolean {
  if (expr === "*") return true;

  // Handle step values: */2, 1-5/2
  if (expr.includes("/")) {
    const [rangeExpr, stepStr] = expr.split("/");
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return false;
    if (rangeExpr === "*") return value % step === 0;
    const [start, end] = parseRange(rangeExpr);
    return value >= start && value <= end && (value - start) % step === 0;
  }

  // Handle comma-separated values: 1,3,5
  if (expr.includes(",")) {
    return expr.split(",").some((part) => fieldMatches(part.trim(), value));
  }

  // Handle ranges: 1-5
  if (expr.includes("-")) {
    const [start, end] = parseRange(expr);
    return value >= start && value <= end;
  }

  // Exact match
  return parseInt(expr, 10) === value;
}

function parseRange(expr: string): [number, number] {
  const [a, b] = expr.split("-").map((s) => parseInt(s, 10));
  return [a, b];
}

// ──────────────────────────────────────────────
// Data Gathering
// ──────────────────────────────────────────────

interface GatherQuery {
  source: string;
  filter?: Record<string, unknown>;
  order?: string;
  limit?: number;
}

interface GatherConfig {
  queries?: GatherQuery[];
  scan_tables?: string[];
  thresholds_days?: number[];
}

async function gatherData(config: GatherConfig): Promise<Record<string, unknown[]>> {
  const results: Record<string, unknown[]> = {};
  if (!config.queries?.length) return results;

  for (const q of config.queries) {
    try {
      const data = await runGatherQuery(q);
      if (!results[q.source]) results[q.source] = [];
      results[q.source].push(...data);
    } catch (err) {
      console.error(`Gather error for source "${q.source}":`, err);
    }
  }
  return results;
}

async function runGatherQuery(q: GatherQuery): Promise<unknown[]> {
  const allowedSources = ["actions", "thoughts", "scheduled_tasks", "important_dates", "maintenance_tasks"];
  if (!allowedSources.includes(q.source)) {
    console.warn(`Unknown gather source: ${q.source}`);
    return [];
  }

  let query = supabase.from(q.source).select("*");

  if (q.filter) {
    // Status filter
    if (q.filter.status && typeof q.filter.status === "string") {
      query = query.eq("status", q.filter.status);
    }

    // Recency filter: items from the last N days
    if (q.filter.days && typeof q.filter.days === "number") {
      const since = new Date();
      since.setDate(since.getDate() - (q.filter.days as number));
      query = query.gte("created_at", since.toISOString());
    }

    // Due within N days
    if (q.filter.due_within_days && typeof q.filter.due_within_days === "number") {
      const now = new Date();
      const until = new Date();
      until.setDate(until.getDate() + (q.filter.due_within_days as number));
      query = query.gte("due_date", now.toISOString().split("T")[0]);
      query = query.lte("due_date", until.toISOString().split("T")[0]);
    }

    // Older than N days
    if (q.filter.older_than_days && typeof q.filter.older_than_days === "number") {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - (q.filter.older_than_days as number));
      query = query.lte("created_at", cutoff.toISOString());
    }

    // Tags filter (array overlap)
    if (q.filter.tags && Array.isArray(q.filter.tags)) {
      query = query.overlaps("tags", q.filter.tags as string[]);
    }
  }

  if (q.order) {
    query = query.order(q.order, { ascending: true, nullsFirst: false });
  }

  query = query.limit(q.limit ?? 20);

  const { data, error } = await query;
  if (error) {
    console.error(`Query error on "${q.source}":`, error.message);
    return [];
  }
  return data ?? [];
}

function formatGatheredData(gathered: Record<string, unknown[]>): string {
  const sections: string[] = [];
  for (const [source, rows] of Object.entries(gathered)) {
    if (!rows.length) continue;
    sections.push(`## ${source} (${rows.length} items)\n`);
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      if (source === "actions") {
        const due = r.due_date ? ` | Due: ${r.due_date}` : "";
        const tags = (r.tags as string[])?.length ? ` | Tags: ${(r.tags as string[]).join(", ")}` : "";
        sections.push(`- [${r.status}] ${r.content}${due}${tags}`);
      } else if (source === "thoughts") {
        const date = r.created_at ? new Date(r.created_at as string).toLocaleDateString() : "";
        sections.push(`- [${date}] ${r.content}`);
      } else if (source === "important_dates") {
        const date = r.date ?? r.event_date ?? "";
        sections.push(`- ${r.name ?? r.title ?? r.description ?? "Untitled"} (${date})`);
      } else if (source === "maintenance_tasks") {
        const due = r.next_due ?? "";
        sections.push(`- ${r.name ?? r.task ?? r.description ?? "Untitled"} (next due: ${due})`);
      } else {
        sections.push(`- ${JSON.stringify(r)}`);
      }
    }
    sections.push("");
  }
  return sections.join("\n") || "(no data gathered)";
}

// ──────────────────────────────────────────────
// Task Type Handlers
// ──────────────────────────────────────────────

async function handleLlmPrompt(
  task: Record<string, unknown>,
  gatheredText: string
): Promise<string> {
  const systemPrompt = (task.prompt_template as string) || "Summarize the following data concisely.";

  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: gatheredText },
      ],
    }),
  });

  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter call failed: ${r.status} ${msg}`);
  }

  const d = await r.json();
  return d.choices?.[0]?.message?.content ?? "(empty LLM response)";
}

async function handleAlertDigest(task: Record<string, unknown>): Promise<string> {
  const config = (task.gather_config ?? {}) as GatherConfig;
  const thresholds = config.thresholds_days ?? [1, 3, 7];
  const maxDays = Math.max(...thresholds);

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const horizonDate = new Date(today);
  horizonDate.setDate(horizonDate.getDate() + maxDays);
  const horizonStr = horizonDate.toISOString().split("T")[0];

  interface DigestItem {
    source: string;
    label: string;
    dueDate: string;
    daysUntil: number;
  }

  const items: DigestItem[] = [];

  // Query actions with due dates in range
  const { data: actions } = await supabase
    .from("actions")
    .select("*")
    .eq("status", "open")
    .gte("due_date", todayStr)
    .lte("due_date", horizonStr)
    .order("due_date", { ascending: true });

  if (actions) {
    for (const a of actions) {
      const daysUntil = Math.ceil(
        (new Date(a.due_date).getTime() - today.getTime()) / 86_400_000
      );
      items.push({
        source: "action",
        label: a.content ?? a.name ?? "Untitled action",
        dueDate: a.due_date,
        daysUntil,
      });
    }
  }

  // Query important_dates in range
  const { data: dates } = await supabase
    .from("important_dates")
    .select("*")
    .gte("date", todayStr)
    .lte("date", horizonStr)
    .order("date", { ascending: true });

  if (dates) {
    for (const d of dates) {
      const dateField = d.date ?? d.event_date;
      const daysUntil = Math.ceil(
        (new Date(dateField).getTime() - today.getTime()) / 86_400_000
      );
      items.push({
        source: "important_date",
        label: d.name ?? d.title ?? d.description ?? "Untitled date",
        dueDate: dateField,
        daysUntil,
      });
    }
  }

  // Query maintenance_tasks in range
  const { data: maintenance } = await supabase
    .from("maintenance_tasks")
    .select("*")
    .gte("next_due", todayStr)
    .lte("next_due", horizonStr)
    .order("next_due", { ascending: true });

  if (maintenance) {
    for (const m of maintenance) {
      const daysUntil = Math.ceil(
        (new Date(m.next_due).getTime() - today.getTime()) / 86_400_000
      );
      items.push({
        source: "maintenance",
        label: m.name ?? m.task ?? m.description ?? "Untitled task",
        dueDate: m.next_due,
        daysUntil,
      });
    }
  }

  if (!items.length) {
    return `# Alert Digest — ${todayStr}\n\nNo items due in the next ${maxDays} days.`;
  }

  // Group by urgency tier using thresholds (sorted ascending)
  const sortedThresholds = [...thresholds].sort((a, b) => a - b);

  interface Tier {
    label: string;
    emoji: string;
    items: DigestItem[];
  }

  const tiers: Tier[] = [
    { label: "Due Today", emoji: "\uD83D\uDD34", items: [] },
    { label: `Due in ${sortedThresholds[1] ?? 3} Days`, emoji: "\uD83D\uDFE1", items: [] },
    { label: "Due This Week", emoji: "\uD83D\uDFE2", items: [] },
  ];

  for (const item of items) {
    if (item.daysUntil <= sortedThresholds[0]) {
      tiers[0].items.push(item);
    } else if (item.daysUntil <= sortedThresholds[1]) {
      tiers[1].items.push(item);
    } else {
      tiers[2].items.push(item);
    }
  }

  // Format digest
  const lines: string[] = [`# Alert Digest — ${todayStr}\n`];

  for (const tier of tiers) {
    if (!tier.items.length) continue;
    lines.push(`## ${tier.emoji} ${tier.label}`);
    for (const item of tier.items) {
      lines.push(`- [${item.source}] ${item.label} (due ${item.dueDate})`);
    }
    lines.push("");
  }

  const counts = tiers
    .filter((t) => t.items.length > 0)
    .map((t) => `${t.items.length} ${t.label.toLowerCase()}`)
    .join(" · ");

  lines.push("---");
  lines.push(counts);

  return lines.join("\n");
}

// ──────────────────────────────────────────────
// Task Execution Pipeline
// ──────────────────────────────────────────────

interface TaskResult {
  task_id: string;
  task_name: string;
  status: "success" | "error";
  output?: string;
  error?: string;
}

async function executeTask(task: Record<string, unknown>): Promise<TaskResult> {
  const taskId = task.id as string;
  const taskName = task.name as string;

  // 1. Create run log entry
  const { data: logRow, error: logErr } = await supabase
    .from("task_run_log")
    .insert({ task_id: taskId, status: "running" })
    .select("id")
    .single();

  if (logErr) {
    return { task_id: taskId, task_name: taskName, status: "error", error: `Failed to create log: ${logErr.message}` };
  }
  const logId = logRow.id;

  try {
    // 2. Gather data
    const gatherConfig = (task.gather_config ?? {}) as GatherConfig;
    const gathered = await gatherData(gatherConfig);
    const gatheredText = formatGatheredData(gathered);

    const inputSummary = Object.entries(gathered)
      .map(([src, rows]) => `${src}: ${rows.length}`)
      .join(", ") || "none";

    // 3. Execute task type handler
    let output: string;
    const taskType = task.task_type as string;

    switch (taskType) {
      case "llm_prompt":
        output = await handleLlmPrompt(task, gatheredText);
        break;
      case "alert_digest":
        output = await handleAlertDigest(task);
        break;
      case "stale_loop_scan":
      case "deck_builder":
      case "trend_analysis":
        output = `Task type "${taskType}" is not yet implemented. Gathered data:\n\n${gatheredText}`;
        break;
      default:
        throw new Error(`Unknown task type: ${taskType}`);
    }

    // 4. Delivery (mcp_response = return as text; others are stubs)
    let deliveryStatus = "sent";
    const channel = task.delivery_channel as string;
    if (channel && channel !== "mcp_response") {
      deliveryStatus = "skipped";
      output += `\n\n(Delivery via ${channel} is not yet implemented — output returned inline.)`;
    }

    // 5. Update log and task
    await supabase
      .from("task_run_log")
      .update({
        status: "success",
        completed_at: new Date().toISOString(),
        input_summary: inputSummary,
        output_summary: output.slice(0, 2000),
        delivery_status: deliveryStatus,
      })
      .eq("id", logId);

    await supabase
      .from("scheduled_tasks")
      .update({ last_run_at: new Date().toISOString(), last_run_status: "success" })
      .eq("id", taskId);

    return { task_id: taskId, task_name: taskName, status: "success", output };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    await supabase
      .from("task_run_log")
      .update({
        status: "error",
        completed_at: new Date().toISOString(),
        error_message: errMsg,
        delivery_status: "failed",
      })
      .eq("id", logId);

    await supabase
      .from("scheduled_tasks")
      .update({ last_run_at: new Date().toISOString(), last_run_status: "error" })
      .eq("id", taskId);

    return { task_id: taskId, task_name: taskName, status: "error", error: errMsg };
  }
}

// ──────────────────────────────────────────────
// Cron Sweep — evaluate triggers for all enabled tasks
// ──────────────────────────────────────────────

async function cronSweep(): Promise<TaskResult[]> {
  const { data: tasks, error } = await supabase
    .from("scheduled_tasks")
    .select("*")
    .eq("enabled", true);

  if (error || !tasks?.length) {
    return [];
  }

  const now = new Date();
  const results: TaskResult[] = [];

  for (const task of tasks) {
    const triggerType = task.trigger_type as string;

    if (triggerType === "manual") continue;

    // Skip if already ran within the sweep window
    if (task.last_run_at) {
      const lastRun = new Date(task.last_run_at as string);
      const msSinceLastRun = now.getTime() - lastRun.getTime();
      if (msSinceLastRun < SWEEP_WINDOW_MINUTES * 60_000) continue;
    }

    let shouldRun = false;

    if (triggerType === "cron" && task.cron_expression) {
      shouldRun = cronMatchesNow(task.cron_expression as string, now, SWEEP_WINDOW_MINUTES);
    }

    // due_date and event triggers are not yet implemented
    if (triggerType === "due_date" || triggerType === "event") {
      continue;
    }

    if (shouldRun) {
      const result = await executeTask(task);
      results.push(result);
    }
  }

  return results;
}

// ──────────────────────────────────────────────
// HTTP Handler
// ──────────────────────────────────────────────

const app = new Hono();

app.post("*", async (c) => {
  // Auth: accept service role key via Authorization header
  const authHeader = c.req.header("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({}));

  // Mode A: single task execution
  if (body.task_id) {
    const { data: task, error } = await supabase
      .from("scheduled_tasks")
      .select("*")
      .eq("id", body.task_id)
      .single();

    if (error || !task) {
      return c.json({ error: `Task not found: ${error?.message ?? "unknown"}` }, 404);
    }

    const result = await executeTask(task);
    return c.json(result, result.status === "success" ? 200 : 500);
  }

  // Mode B: cron sweep
  if (body.mode === "cron_sweep") {
    const results = await cronSweep();
    return c.json({ mode: "cron_sweep", tasks_evaluated: true, results });
  }

  return c.json({ error: "Provide task_id or mode: cron_sweep" }, 400);
});

app.get("*", (c) =>
  c.json({ status: "ok", service: "Task Runner", version: "1.0.0" })
);

Deno.serve(app.fetch);
