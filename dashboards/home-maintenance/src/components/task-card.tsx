import { cn } from "@/lib/utils";
import { MaintenanceTask } from "@/lib/types";
import { daysUntil, daysAgoLabel, formatDate } from "@/lib/utils";
import {
  CATEGORY_BORDER_COLORS,
  DEFAULT_CATEGORY_BORDER,
} from "@/lib/constants";
import { PriorityDot } from "./priority-dot";
import { CategoryBadge } from "./category-badge";

interface TaskCardProps {
  task: MaintenanceTask;
}

export function TaskCard({ task }: TaskCardProps) {
  const borderColor =
    CATEGORY_BORDER_COLORS[task.category?.toLowerCase() ?? ""] ??
    DEFAULT_CATEGORY_BORDER;
  const days = task.next_due ? daysUntil(task.next_due) : null;

  return (
    <div
      className={cn(
        "border-l-[3px] rounded-lg bg-bg-card px-4 py-3 transition-colors hover:bg-bg-card-hover",
        borderColor
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PriorityDot priority={task.priority} />
          <span className="font-medium text-text-primary">{task.name}</span>
        </div>
        <CategoryBadge category={task.category} />
      </div>
      <div className="mt-1 flex items-center gap-3 text-xs text-text-muted">
        {task.next_due && (
          <span>
            Due {formatDate(task.next_due)}
            {days !== null && (
              <span className="ml-1 text-text-secondary">
                ({daysAgoLabel(days)})
              </span>
            )}
          </span>
        )}
        <span>{task.priority}</span>
      </div>
    </div>
  );
}
