"use client";

import { useState, useEffect, useCallback } from "react";
import { AddToBrain } from "@/components/AddToBrain";
import type { IngestionJob } from "@/lib/types";
import { formatDate } from "@/lib/format";

const statusColor: Record<string, string> = {
  complete: "text-success",
  dry_run_complete: "text-violet",
  executing: "text-violet",
  extracting: "text-warning",
  pending: "text-warning",
  failed: "text-danger",
};

export default function AddToBrainPage() {
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [loading, setLoading] = useState(true);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/ingest");
      if (!res.ok) throw new Error("Failed to load jobs");
      const data = await res.json();
      setJobs(data);
    } catch {
      // silently ignore — job list is secondary
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Add to Brain</h1>
        <p className="text-text-secondary text-sm">
          Paste a thought, notes, or source text. Open Brain will decide whether
          to save one thought or extract several.
        </p>
      </div>

      {/* Unified input */}
      <div className="bg-bg-surface border border-border rounded-lg p-5">
        <AddToBrain
          rows={6}
          showModeControl={true}
          showJobDetail={true}
          onSuccess={() => loadJobs()}
        />
      </div>

      {/* Job history */}
      <div>
        <h2 className="text-lg font-medium mb-3">Recent Activity</h2>
        {loading ? (
          <div className="flex items-center gap-2 text-text-muted text-sm">
            <div className="w-4 h-4 border-2 border-violet/30 border-t-violet rounded-full animate-spin" />
            Loading...
          </div>
        ) : jobs.length === 0 ? (
          <p className="text-text-muted text-sm">
            No ingestion jobs yet. Add longer content to see extraction results
            here.
          </p>
        ) : (
          <div className="grid gap-3">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="bg-bg-surface border border-border rounded-lg p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-text-primary">
                      {job.source_label || `Job #${job.id}`}
                    </span>
                    <span
                      className={`text-xs font-medium ${statusColor[job.status] || "text-text-muted"}`}
                    >
                      {job.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <span className="text-xs text-text-muted">
                    {formatDate(job.created_at)}
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-text-muted">
                  <span>
                    Extracted:{" "}
                    <span className="text-text-secondary">
                      {job.extracted_count}
                    </span>
                  </span>
                  <span>
                    Added:{" "}
                    <span className="text-success">{job.added_count}</span>
                  </span>
                  <span>
                    Skipped:{" "}
                    <span className="text-text-secondary">
                      {job.skipped_count}
                    </span>
                  </span>
                  {job.revised_count > 0 && (
                    <span>
                      Revised:{" "}
                      <span className="text-info">{job.revised_count}</span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
