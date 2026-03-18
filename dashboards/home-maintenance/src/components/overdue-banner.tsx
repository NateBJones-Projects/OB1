import { AlertTriangle } from "lucide-react";
import { MaintenanceTask } from "@/lib/types";
import { daysUntil, formatDate } from "@/lib/utils";

interface OverdueBannerProps {
  tasks: MaintenanceTask[];
}

export function OverdueBanner({ tasks }: OverdueBannerProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="rounded-lg border-l-4 border-priority-urgent bg-priority-urgent/10 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-4 w-4 text-priority-urgent animate-pulse" />
        <span className="text-sm font-semibold text-priority-urgent">
          {tasks.length} overdue
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {tasks.map((task) => (
          <span
            key={task.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-priority-urgent/10 px-3 py-1 text-xs text-text-primary"
          >
            {task.name}
            <span className="text-priority-urgent font-medium">
              {Math.abs(daysUntil(task.next_due!))}d late
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
