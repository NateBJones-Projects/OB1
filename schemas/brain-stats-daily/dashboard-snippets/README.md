# Dashboard Snippets

Optional frontend bits that pair with the `brain-stats-daily` RPCs. None of these are required — the SQL functions work standalone via the Supabase REST API.

## HeatmapSourceFilter.tsx

A server-rendered pill row that filters the home-page heatmap by `source_type`. Pairs with the `brain_stats_daily(p_days, p_source_type, p_exclude_restricted)` RPC so the filtering happens in Postgres, not in the browser.

### What it renders

A horizontal row of rounded "pills" (All, LifeLog, Captures, ChatGPT, Claude, Gemini, Gmail, Telegram). Clicking a pill navigates to `/?heat_source=<source_type>`; the active pill is highlighted.

### Wiring it into `dashboards/open-brain-dashboard-next`

1. Copy `HeatmapSourceFilter.tsx` into `dashboards/open-brain-dashboard-next/components/`.
2. In the home page server component (usually `dashboards/open-brain-dashboard-next/app/page.tsx`), read the `heat_source` search param and pass it both into the RPC call and into the filter:

   ```tsx
   import { HeatmapSourceFilter } from "@/components/HeatmapSourceFilter";

   export default async function HomePage({
     searchParams,
   }: {
     searchParams: Promise<{ heat_source?: string }>;
   }) {
     const params = await searchParams;
     const heatSource = params.heat_source ?? "";

     // Call the RPC with the source filter — either the setof or jsonb variant.
     const { data: buckets } = await supabase.rpc("brain_stats_daily_jsonb", {
       p_days: 180,
       p_source_type: heatSource || null,
       p_exclude_restricted: true,
     });

     return (
       <>
         <HeatmapSourceFilter currentSource={heatSource} />
         {/* ...your existing heatmap component, fed by `buckets`... */}
       </>
     );
   }
   ```

3. If your dashboard uses different color tokens (the snippet uses `violet`, `bg-surface`, `text-muted`, etc., matching the `open-brain-dashboard-next` Tailwind theme), adjust the class names to match your own design tokens.

### Customizing the source list

Edit `HEATMAP_SOURCE_OPTIONS` at the top of the file. Each entry maps a human label to a `source_type` value that exists in your `thoughts` table. Keep the list short — the long tail of one-off source labels clutters the UI. The `All` option (empty `value`) is required to let users clear the filter.

### Requires

- `open-brain-dashboard-next` (Next.js 15/16 App Router) or equivalent
- Tailwind CSS
- The `brain_stats_daily` or `brain_stats_daily_jsonb` RPC from this schema installed
- The optional `source_type` column from the `enhanced-thoughts` schema (the filter is meaningless without it)
