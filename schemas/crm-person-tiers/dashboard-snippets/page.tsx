/**
 * CRM — people-centric view of the knowledge graph.
 *
 * Drop-in Next.js App Router page that renders the output of the
 * `crm_person_tiers` RPC shipped with this schema. Designed to slot
 * into `dashboards/open-brain-dashboard-next/` (or any Next.js 13+
 * App Router project with a Supabase client) at a route like
 * `app/crm/page.tsx`.
 *
 * Dependencies:
 *   - The `crm_person_tiers` schema installed (see ../schema.sql)
 *   - A Supabase server-side client at `@/lib/supabase/server`
 *     exporting a `getSupabaseServerClient()` helper that returns a
 *     service-role or authenticated Postgres client. Adjust the import
 *     path to match your dashboard.
 *
 * What you get:
 *   - Summary strip with per-tier counts
 *   - Paginated list of persons with name, tier badge, last-seen,
 *     and mention count
 *
 * What's deliberately not included:
 *   - A contact detail view. Add one at `app/crm/[id]/page.tsx`
 *     that queries `crm_persons` + `crm_person_mentions` directly.
 */

// NOTE: adjust this import path to wherever your dashboard exports
// its Supabase server client. The rest of the file is client-agnostic.
import { getSupabaseServerClient } from "@/lib/supabase/server";

type CrmTier = "connected" | "contact" | "known" | "unknown";

interface CrmPersonRow {
  id: string;
  canonical_name: string;
  aliases: string[] | null;
  metadata: Record<string, unknown> | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  mention_count: number;
  relationship_tier: CrmTier;
  effective_tier: CrmTier;
  total_count: number;
}

const TIER_ORDER: CrmTier[] = ["connected", "contact", "known", "unknown"];

const TIER_COPY: Record<CrmTier, { label: string; badge: string; desc: string }> = {
  connected: {
    label: "Connected",
    badge: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    desc: "Family, close contacts, or 20+ mentions in last 7d",
  },
  contact: {
    label: "Contact",
    badge: "border-violet-500/40 bg-violet-500/15 text-violet-300",
    desc: "In your contacts",
  },
  known: {
    label: "Known",
    badge: "border-slate-500/40 bg-slate-500/15 text-slate-300",
    desc: "Engaged thread (you replied)",
  },
  unknown: {
    label: "Unknown",
    badge: "border-slate-600/40 bg-slate-700/30 text-slate-400",
    desc: "No prior engagement",
  },
};

function formatSeen(at?: string | null): string {
  if (!at) return "no activity";
  const ms = Date.now() - new Date(at).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${(days / 365).toFixed(1)} years ago`;
}

type FetchResult =
  | { ok: true; rows: CrmPersonRow[]; total: number }
  | { ok: false; error: string };

async function fetchPersonTiers(
  limit = 200,
  offset = 0,
  search?: string
): Promise<FetchResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.rpc("crm_person_tiers", {
      p_limit: limit,
      p_offset: offset,
      p_search: search ?? null,
    });

    if (error) {
      // Log full detail server-side; return a typed failure to the page so
      // the dashboard can render a controlled error panel instead of
      // falling through to Next.js's default error surface.
      console.error("[crm_person_tiers] RPC error", error);
      return { ok: false, error: error.message };
    }

    const rows = (data ?? []) as CrmPersonRow[];
    const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
    return { ok: true, rows, total };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[crm_person_tiers] unexpected failure", err);
    return { ok: false, error: message };
  }
}

export default async function CrmPage() {
  const PER_PAGE = 200;
  const MAX_PAGES = 2;
  const rows: CrmPersonRow[] = [];
  let total = 0;
  let fetchError: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await fetchPersonTiers(PER_PAGE, page * PER_PAGE);
    if (!r.ok) {
      fetchError = r.error;
      break;
    }
    total = r.total;
    rows.push(...r.rows);
    if (r.rows.length < PER_PAGE) break;
  }

  // tierCounts reflects the LOADED rows only (up to MAX_PAGES * PER_PAGE).
  // The UI labels these as "loaded" when total exceeds the cap so users
  // don't mistake them for a global summary.
  const tierCounts: Record<CrmTier, number> = {
    connected: 0,
    contact: 0,
    known: 0,
    unknown: 0,
  };
  for (const r of rows) tierCounts[r.effective_tier] += 1;

  const loadedCap = PER_PAGE * MAX_PAGES;
  const hasMore = total > rows.length;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">CRM</h1>
        <p className="text-sm text-slate-400">
          People tracked in your Open Brain, tiered by relationship. Tiers
          default to the stored <code>relationship_tier</code> value and
          promote to <code>connected</code> for high-activity recent
          contacts.
        </p>
      </div>

      {fetchError && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          <div className="font-medium mb-1">Could not load CRM persons</div>
          <p className="text-xs text-rose-200/80">
            The <code>crm_person_tiers</code> RPC returned an error. Run{" "}
            <code>NOTIFY pgrst, &apos;reload schema&apos;;</code> in your
            Supabase SQL editor and confirm the schema has been applied.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {TIER_ORDER.map((t) => (
          <div
            key={t}
            className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-4"
          >
            <div className="flex items-baseline justify-between mb-1">
              <span
                className={`px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide border rounded ${TIER_COPY[t].badge}`}
              >
                {TIER_COPY[t].label}
              </span>
              <span className="text-lg font-semibold text-slate-100">
                {tierCounts[t]}
              </span>
            </div>
            <p className="text-[10px] text-slate-400">{TIER_COPY[t].desc}</p>
          </div>
        ))}
      </div>

      <div className="text-xs text-slate-400">
        {rows.length.toLocaleString()} loaded
        {hasMore && ` (of ${total.toLocaleString()} total — per-tier counts above reflect loaded rows only, capped at ${loadedCap.toLocaleString()})`}
        {!hasMore && total > 0 && ` · ${total.toLocaleString()} total persons`}
      </div>

      <div className="space-y-2">
        {rows.length === 0 && !fetchError && (
          <p className="text-sm text-slate-400">
            No persons yet. Insert rows into <code>crm_persons</code> to
            populate this view.
          </p>
        )}
        {rows.map((p) => (
          <ContactRow key={p.id} row={p} />
        ))}
      </div>
    </div>
  );
}

function ContactRow({ row }: { row: CrmPersonRow }) {
  const tierMeta = TIER_COPY[row.effective_tier];
  const seen = formatSeen(row.last_seen_at);
  const aliases = Array.isArray(row.aliases) ? row.aliases : [];

  return (
    <div className="flex items-start gap-4 rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 hover:border-violet-500/40 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-sm font-medium text-slate-100 truncate">
            {row.canonical_name}
          </span>
          <span
            className={`px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide border rounded ${tierMeta.badge}`}
          >
            {tierMeta.label}
          </span>
          {aliases.length > 0 && (
            <span className="text-[10px] text-slate-500 truncate">
              aka {aliases.slice(0, 3).join(", ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
          <span>{row.mention_count.toLocaleString()} mentions</span>
          <span className="text-slate-600">·</span>
          <span>last seen {seen}</span>
          {row.first_seen_at && (
            <>
              <span className="text-slate-600">·</span>
              <span>first seen {formatSeen(row.first_seen_at)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
