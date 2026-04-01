import { fetchStats, fetchThoughts } from "@/lib/api";
import { requireSessionOrRedirect, getSession } from "@/lib/auth";
import { StatsWidget } from "@/components/StatsWidget";
import { ThoughtCard } from "@/components/ThoughtCard";
import { AddToBrain } from "@/components/AddToBrain";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { apiKey } = await requireSessionOrRedirect();
  const session = await getSession();
  const excludeRestricted = !session.restrictedUnlocked;

  let stats, recent;
  try {
    [stats, recent] = await Promise.all([
      fetchStats(apiKey, undefined, excludeRestricted),
      fetchThoughts(apiKey, { page: 1, per_page: 5, exclude_restricted: excludeRestricted }),
    ]);
  } catch (err) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">Overview</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          Unable to load data. Check your connection.
          <br />
          <span className="text-red-500 text-xs">
            {err instanceof Error ? err.message : "Unknown error"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold mb-0.5">Overview</h1>
        <p className="text-text-muted text-sm">
          Your practice at a glance
        </p>
      </div>

      <StatsWidget stats={stats} />

      <div>
        <h2 className="text-sm font-medium text-text-secondary mb-2">Quick capture</h2>
        <AddToBrain rows={2} />
      </div>

      <div>
        <h2 className="text-sm font-medium text-text-secondary mb-3">Recent entries</h2>
        <div className="space-y-2">
          {recent.data?.map((thought) => (
            <ThoughtCard key={thought.id} thought={thought} />
          ))}
          {(!recent.data || recent.data.length === 0) && (
            <p className="text-text-muted text-sm">Nothing captured yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
