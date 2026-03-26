export interface CalendarItem {
  id: string;
  source: "thought" | "action" | "activity" | "important_date" | "maintenance";
  title: string;
  date: string;
  status?: string;
  color: string;
}

export const SOURCE_LABELS: Record<string, string> = {
  thought: "Thought",
  action: "Action",
  activity: "Activity",
  important_date: "Important Date",
  maintenance: "Maintenance",
};

export const SOURCE_COLORS: Record<string, string> = {
  thought: "#6b7280",
  action: "#3b82f6",
  activity: "#a855f7",
  important_date: "#ef4444",
  maintenance: "#fb7185",
};
