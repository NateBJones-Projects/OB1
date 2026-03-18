import { SupabaseClient } from "@supabase/supabase-js";
import { MaintenanceTask, MaintenanceLog } from "./types";

export async function getOverdueTasks(
  client: SupabaseClient
): Promise<MaintenanceTask[]> {
  const { data, error } = await client
    .from("maintenance_tasks")
    .select("*")
    .not("next_due", "is", null)
    .lt("next_due", new Date().toISOString())
    .order("next_due", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function getUpcomingTasks(
  client: SupabaseClient,
  daysAhead = 30
): Promise<MaintenanceTask[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + daysAhead);

  const { data, error } = await client
    .from("maintenance_tasks")
    .select("*")
    .not("next_due", "is", null)
    .gte("next_due", new Date().toISOString())
    .lte("next_due", cutoff.toISOString())
    .order("next_due", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function getRecentLogs(
  client: SupabaseClient,
  limit = 10
): Promise<MaintenanceLog[]> {
  const { data, error } = await client
    .from("maintenance_logs")
    .select(
      `
      *,
      maintenance_tasks (
        id,
        name,
        category
      )
    `
    )
    .order("completed_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}
