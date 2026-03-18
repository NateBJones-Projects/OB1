import { MaintenanceLog } from "@/lib/types";
import { formatDate, formatCurrency } from "@/lib/utils";
import {
  CATEGORY_TEXT_COLORS,
  DEFAULT_CATEGORY_TEXT,
} from "@/lib/constants";
import { History } from "lucide-react";

interface RecentActivityProps {
  logs: MaintenanceLog[];
}

export function RecentActivity({ logs }: RecentActivityProps) {
  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-text-secondary">
        <History className="h-4 w-4" />
        Recent Activity
      </h2>

      {logs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-bg-card px-4 py-8 text-center text-sm text-text-muted">
          No maintenance logged yet
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-secondary text-left text-xs text-text-muted">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Task</th>
                  <th className="px-4 py-2 font-medium">By</th>
                  <th className="px-4 py-2 font-medium text-right">Cost</th>
                  <th className="px-4 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => {
                  const cat =
                    log.maintenance_tasks?.category?.toLowerCase() ?? "";
                  const dotColor =
                    CATEGORY_TEXT_COLORS[cat] ?? DEFAULT_CATEGORY_TEXT;

                  return (
                    <tr
                      key={log.id}
                      className={`border-b border-border last:border-0 ${
                        i % 2 === 0 ? "bg-bg-card" : "bg-bg-secondary"
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 py-2 text-text-secondary">
                        {formatDate(log.completed_at)}
                      </td>
                      <td className="px-4 py-2 text-text-primary">
                        <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${dotColor.replace("text-", "bg-")}`} />
                        {log.maintenance_tasks?.name ?? "Unknown"}
                      </td>
                      <td className="px-4 py-2 text-text-secondary">
                        {log.performed_by ?? "Self"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right text-text-primary">
                        {formatCurrency(log.cost)}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-2 text-text-muted">
                        {log.notes ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {logs.map((log) => {
              const cat =
                log.maintenance_tasks?.category?.toLowerCase() ?? "";
              const dotColor =
                CATEGORY_TEXT_COLORS[cat] ?? DEFAULT_CATEGORY_TEXT;

              return (
                <div
                  key={log.id}
                  className="rounded-lg bg-bg-card px-4 py-3 border border-border"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block h-2 w-2 rounded-full ${dotColor.replace("text-", "bg-")}`} />
                      <span className="text-sm font-medium text-text-primary">
                        {log.maintenance_tasks?.name ?? "Unknown"}
                      </span>
                    </div>
                    <span className="text-sm font-medium text-text-primary">
                      {formatCurrency(log.cost)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                    <span>{formatDate(log.completed_at)}</span>
                    <span>·</span>
                    <span>{log.performed_by ?? "Self"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
