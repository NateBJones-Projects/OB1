import Link from "next/link";

/**
 * HeatmapSourceFilter — optional UI pill row for the dashboard heatmap.
 *
 * Pairs with the `brain_stats_daily(p_days, p_source_type, p_exclude_restricted)`
 * RPC from the `brain-stats-daily` schema. Each pill links to the home
 * page with a `?heat_source=<source_type>` query param; your server
 * component reads that param and passes it into the RPC call so the
 * database does the filtering server-side.
 *
 * Server-rendered — every pill is a plain Next.js <Link>, so the page
 * stays a server component. Tailwind-only styling so it drops into the
 * open-brain-dashboard-next install with no extra dependencies.
 *
 * Customize HEATMAP_SOURCE_OPTIONS for the source_types that matter in
 * your own brain. Curated options are better than auto-discovered ones
 * because the long tail (one-off ingest labels, legacy pipelines) tends
 * to clutter the UI.
 */

export interface HeatmapSourceOption {
  label: string;
  /** Empty string = "all sources" (no source_type filter). */
  value: string;
}

// Example values only — replace these with `source_type` values that
// actually exist in your `thoughts` table. Run
//   select source_type, count(*) from thoughts group by 1 order by 2 desc;
// in the Supabase SQL Editor to see yours, then edit this list.
export const HEATMAP_SOURCE_OPTIONS: HeatmapSourceOption[] = [
  { label: "All", value: "" },
  { label: "LifeLog", value: "google_drive_import" },
  { label: "Captures", value: "rest_api" },
  { label: "ChatGPT", value: "chatgpt_import" },
  { label: "Claude", value: "claude_import" },
  { label: "Gemini", value: "gemini_import" },
  { label: "Gmail", value: "gmail_wiki" },
  { label: "Telegram", value: "telegram" },
];

export function HeatmapSourceFilter({
  currentSource,
}: {
  currentSource: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-text-muted mr-1">
        Source
      </span>
      {HEATMAP_SOURCE_OPTIONS.map((opt) => {
        const active = opt.value === currentSource;
        const href = opt.value
          ? `/?heat_source=${encodeURIComponent(opt.value)}`
          : "/";
        return (
          <Link
            key={opt.value || "all"}
            href={href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={[
              "px-2 py-0.5 text-[11px] rounded-full border transition-colors",
              active
                ? "bg-violet-surface border-violet/40 text-violet"
                : "bg-bg-surface border-border text-text-secondary hover:border-violet/30 hover:text-text-primary",
            ].join(" ")}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}
