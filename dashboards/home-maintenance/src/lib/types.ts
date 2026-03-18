export interface MaintenanceTask {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  frequency_days: number | null;
  last_completed: string | null;
  next_due: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceLog {
  id: string;
  task_id: string;
  user_id: string;
  completed_at: string;
  performed_by: string | null;
  cost: number | null;
  notes: string | null;
  next_action: string | null;
  maintenance_tasks?: {
    id: string;
    name: string;
    category: string | null;
  };
}
