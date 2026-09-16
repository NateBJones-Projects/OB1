"use client";

import { useState, useCallback } from "react";
import type {
  AddToBrainMode,
  AddToBrainResult,
  IngestionItem,
  IngestionJobDetail,
} from "@/lib/types";

interface AddToBrainProps {
  /** Textarea row count (default 4) */
  rows?: number;
  /** Show mode selector (default false — auto only) */
  showModeControl?: boolean;
  /** Show inline job detail + execute (default false) */
  showJobDetail?: boolean;
  /** Callback after successful add */
  onSuccess?: (result: AddToBrainResult) => void;
}

const MODES: { value: AddToBrainMode; label: string; description: string }[] = [
  {
    value: "auto",
    label: "Auto",
    description: "Open Brain decides the best path",
  },
  {
    value: "single",
    label: "Save as one thought",
    description: "Save the entire input as a single thought",
  },
  {
    value: "extract",
    label: "Extract multiple thoughts",
    description: "Run smart-ingest to extract atomic thoughts",
  },
];

const ACTION_COLORS: Record<string, string> = {
  add: "text-success",
  skip: "text-text-muted",
  create_revision: "text-info",
  append_evidence: "text-violet",
};

const ACTION_LABELS: Record<string, string> = {
  add: "Add",
  skip: "Skip",
  create_revision: "Revise",
  append_evidence: "Append",
};

export function AddToBrain({
  rows = 4,
  showModeControl = false,
  showJobDetail = false,
  onSuccess,
}: AddToBrainProps) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<AddToBrainMode>("auto");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AddToBrainResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dryRun, setDryRun] = useState(false);

  // Job detail state (only used when showJobDetail is true)
  const [jobDetail, setJobDetail] = useState<IngestionJobDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);

  const fetchJobDetail = useCallback(async (jobId: number) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/ingest/${jobId}`);
      if (!res.ok) throw new Error("Failed to load job detail");
      const data: IngestionJobDetail = await res.json();
      setJobDetail(data);
    } catch {
      // Non-critical — the job link still works
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || submitting) return;

    setSubmitting(true);
    setError(null);
    setResult(null);
    setJobDetail(null);
    setExecuteError(null);

    try {
      const body: Record<string, unknown> = { text: text.trim(), mode };
      if (showJobDetail && dryRun) {
        body.dry_run = true;
      }

      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as Record<string, string>).error || "Failed to add"
        );
      }
      const data: AddToBrainResult = await res.json();
      setResult(data);
      setText("");
      setMode("auto");
      onSuccess?.(data);

      // Auto-fetch job detail if enabled and we got a job_id
      if (showJobDetail && data.job_id) {
        fetchJobDetail(data.job_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const handleExecute = async () => {
    if (!jobDetail || executing) return;
    setExecuting(true);
    setExecuteError(null);

    try {
      const res = await fetch(`/api/ingest/${jobDetail.job.id}/execute`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as Record<string, string>).error || "Execution failed"
        );
      }
      // Refresh job detail to show updated status
      await fetchJobDetail(jobDetail.job.id);
      // Update the result message
      setResult((prev) =>
        prev
          ? { ...prev, status: "complete", message: "Thoughts committed to brain" }
          : prev
      );
    } catch (err) {
      setExecuteError(
        err instanceof Error ? err.message : "Execution failed"
      );
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={rows}
          placeholder="Paste a thought, notes, or source text..."
          className="w-full bg-bg-elevated border border-border rounded-lg px-4 py-3 text-text-primary placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition resize-y"
        />

        {/* Advanced mode control */}
        {showModeControl && (
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-text-muted hover:text-text-secondary transition-colors flex items-center gap-1"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}
              >
                <path
                  d="M4 2l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Advanced
            </button>

            {showAdvanced && (
              <div className="mt-2 space-y-2">
                <div className="flex gap-2 flex-wrap">
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setMode(m.value)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                        mode === m.value
                          ? "bg-violet-surface text-violet border-violet/30"
                          : "bg-bg-surface text-text-secondary border-border hover:border-text-muted"
                      }`}
                      title={m.description}
                    >
                      {m.label}
                      {m.value === "auto" && " (recommended)"}
                    </button>
                  ))}
                </div>

                {/* Dry-run toggle — only in job detail mode */}
                {showJobDetail && (
                  <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dryRun}
                      onChange={(e) => setDryRun(e.target.checked)}
                      className="rounded border-border text-violet focus:ring-violet/30"
                    />
                    Preview before adding (dry run)
                  </label>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          {mode !== "auto" && (
            <span className="text-xs text-text-muted">
              Mode: {MODES.find((m) => m.value === mode)?.label}
            </span>
          )}
          <div className="ml-auto">
            <button
              type="submit"
              disabled={submitting || !text.trim()}
              className="px-5 py-2.5 bg-violet hover:bg-violet-dim text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Adding..." : "Add to Brain"}
            </button>
          </div>
        </div>
      </form>

      {/* Result feedback */}
      {result && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-success">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className="flex-shrink-0"
            >
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M5 8l2 2 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {result.message}
            {result.path === "single" && result.type && (
              <span className="text-text-muted">({result.type})</span>
            )}
            {result.path === "extract" && result.job_id && (
              <span className="text-text-muted">Job #{result.job_id}</span>
            )}
          </div>

          {/* Link to job history for extract results */}
          {result.path === "extract" && result.job_id && (
            <a
              href="/ingest"
              className="text-xs text-violet hover:text-violet-dim transition-colors underline underline-offset-2"
            >
              View in job history
            </a>
          )}
        </div>
      )}

      {error && <p className="text-danger text-sm">{error}</p>}

      {/* Inline job detail (only when showJobDetail is true and we have data) */}
      {showJobDetail && loadingDetail && (
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <div className="w-4 h-4 border-2 border-violet/30 border-t-violet rounded-full animate-spin" />
          Loading extracted items...
        </div>
      )}

      {showJobDetail && jobDetail && (
        <div className="bg-bg-surface border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-text-primary">
              Extracted Items ({jobDetail.items.length})
            </h3>
            <span
              className={`text-xs font-medium ${
                jobDetail.job.status === "dry_run_complete"
                  ? "text-violet"
                  : jobDetail.job.status === "complete"
                    ? "text-success"
                    : "text-text-muted"
              }`}
            >
              {jobDetail.job.status.replace(/_/g, " ")}
            </span>
          </div>

          {/* Items list */}
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {jobDetail.items.map((item: IngestionItem) => (
              <div
                key={item.id}
                className="border border-border rounded-md p-3 bg-bg-elevated"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-bg-surface border border-border text-text-secondary">
                    {item.type}
                  </span>
                  <span
                    className={`text-xs font-medium ${ACTION_COLORS[item.action] || "text-text-muted"}`}
                  >
                    {ACTION_LABELS[item.action] || item.action}
                  </span>
                  {item.reason && (
                    <span className="text-xs text-text-muted">
                      — {item.reason}
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-secondary leading-relaxed">
                  {item.content.length > 150
                    ? item.content.slice(0, 150) + "..."
                    : item.content}
                </p>
              </div>
            ))}
          </div>

          {/* Execute button for dry-run jobs */}
          {jobDetail.job.status === "dry_run_complete" && (
            <div className="pt-2 border-t border-border">
              <button
                type="button"
                onClick={handleExecute}
                disabled={executing}
                className="px-4 py-2 bg-violet hover:bg-violet-dim text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {executing ? "Executing..." : "Review & Execute"}
              </button>
              {executeError && (
                <p className="text-danger text-xs mt-1">{executeError}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
