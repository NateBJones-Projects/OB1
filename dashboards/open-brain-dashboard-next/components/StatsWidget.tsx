import type { StatsResponse } from "@/lib/types";

export function StatsWidget({ stats }: { stats: StatsResponse }) {
  const typeEntries = Object.entries(stats.types).sort(([, a], [, b]) => (b as number) - (a as number));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-bg-surface border border-border rounded-lg p-5">
        <p className="text-text-muted text-xs font-medium tracking-wide mb-1">
          Total entries
        </p>
        <p className="text-2xl font-semibold text-text-primary tabular-nums">
          {stats.total_thoughts.toLocaleString()}
        </p>
      </div>

      <div className="bg-bg-surface border border-border rounded-lg p-5">
        <p className="text-text-muted text-xs font-medium tracking-wide mb-3">
          By category
        </p>
        <div className="space-y-1.5">
          {typeEntries.slice(0, 5).map(([type, count]) => (
            <div key={type} className="flex items-center justify-between">
              <span className="text-[13px] text-text-secondary capitalize">{type.replace("_", " ")}</span>
              <span className="text-[13px] text-text-muted tabular-nums">{(count as number).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-bg-surface border border-border rounded-lg p-5">
        <p className="text-text-muted text-xs font-medium tracking-wide mb-3">
          Top topics
        </p>
        <div className="space-y-1.5">
          {stats.top_topics?.slice(0, 5).map((t) => (
            <div key={t.topic} className="flex items-center justify-between">
              <span className="text-[13px] text-text-secondary truncate">{t.topic}</span>
              <span className="text-[13px] text-text-muted tabular-nums ml-2">{t.count}</span>
            </div>
          ))}
          {(!stats.top_topics || stats.top_topics.length === 0) && (
            <p className="text-text-muted text-[13px]">No data yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
