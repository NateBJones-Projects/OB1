"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { getOverdueTasks, getUpcomingTasks, getRecentLogs } from "@/lib/queries";
import { MaintenanceTask, MaintenanceLog } from "@/lib/types";
import { Header } from "@/components/header";
import { OverdueBanner } from "@/components/overdue-banner";
import { UpcomingTasks } from "@/components/upcoming-tasks";
import { RecentActivity } from "@/components/recent-activity";
import { SkeletonSection } from "@/components/skeleton-section";

export default function Dashboard() {
  const [overdue, setOverdue] = useState<MaintenanceTask[]>([]);
  const [upcoming, setUpcoming] = useState<MaintenanceTask[]>([]);
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = createClient();

    async function load() {
      try {
        const [overdueData, upcomingData, logsData] = await Promise.all([
          getOverdueTasks(client),
          getUpcomingTasks(client, 30),
          getRecentLogs(client, 10),
        ]);
        setOverdue(overdueData);
        setUpcoming(upcomingData);
        setLogs(logsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  return (
    <div className="min-h-screen bg-bg-primary">
      <Header />

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
        {error && (
          <div className="rounded-lg border border-priority-urgent/30 bg-priority-urgent/10 px-4 py-3 text-sm text-priority-urgent">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-8">
            <SkeletonSection />
            <SkeletonSection />
          </div>
        ) : (
          <>
            <OverdueBanner tasks={overdue} />
            <UpcomingTasks tasks={upcoming} />
            <RecentActivity logs={logs} />
          </>
        )}
      </main>
    </div>
  );
}
