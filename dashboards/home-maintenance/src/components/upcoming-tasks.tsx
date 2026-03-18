import { MaintenanceTask } from "@/lib/types";
import { daysUntil } from "@/lib/utils";
import { TaskCard } from "./task-card";
import { CalendarClock } from "lucide-react";

interface UpcomingTasksProps {
  tasks: MaintenanceTask[];
}

export function UpcomingTasks({ tasks }: UpcomingTasksProps) {
  const thisWeek = tasks.filter((t) => t.next_due && daysUntil(t.next_due) <= 7);
  const later = tasks.filter((t) => t.next_due && daysUntil(t.next_due) > 7);

  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-text-secondary">
        <CalendarClock className="h-4 w-4" />
        Upcoming
      </h2>

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-bg-card px-4 py-8 text-center text-sm text-text-muted">
          No upcoming tasks
        </div>
      ) : (
        <div className="space-y-6">
          {thisWeek.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium text-text-muted">
                This Week
              </h3>
              <div className="space-y-2">
                {thisWeek.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            </div>
          )}

          {later.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium text-text-muted">
                This Month
              </h3>
              <div className="space-y-2">
                {later.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
