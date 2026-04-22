import type { StatsResponse } from "@/lib/types";
import { TypeBadge } from "./ThoughtCard";

export function StatsWidget({ stats }: { stats: StatsResponse }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Total thoughts */}
      <div className="bg-bg-surface border border-border rounded-lg p-5">
        <p className="text-text-muted text-xs font-medium uppercase tracking-wider mb-1">
          Total Thoughts
        </p>
        <p className="text-3xl font-bold text-text-primary">
          {stats.total_thoughts.toLocaleString()}
        </p>
        <p className="text-xs text-text-muted mt-1">
          {stats.window_days === "all" ? "All time" : `Last ${stats.window_days} days`}
        </p>
      </div>

      {/* Type distribution */}
      <div className="bg-bg-surface border border-border rounded-lg p-5">
        <p className="text-text-muted text-xs font-medium uppercase tracking-wider mb-3">
          By Type
        </p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats.types).map(([type, count]) => (
            <div key={type} className="flex items-center gap-1.5">
              <TypeBadge type={type} />
              <span className="text-xs text-text-muted">
                {(count as number).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Top topics */}
      <div className="bg-bg-surface border border-border rounded-lg p-5">
        <p className="text-text-muted text-xs font-medium uppercase tracking-wider mb-3">
          Top Topics
        </p>
        <div className="space-y-1.5">
          {stats.top_topics?.slice(0, 5).map((t) => (
            <div
              key={t.topic}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-text-secondary truncate">{t.topic}</span>
              <span className="text-text-muted text-xs ml-2">{t.count}</span>
            </div>
          ))}
          {(!stats.top_topics || stats.top_topics.length === 0) && (
            <p className="text-text-muted text-sm">No topic data</p>
          )}
        </div>
      </div>
    </div>
  );
}
