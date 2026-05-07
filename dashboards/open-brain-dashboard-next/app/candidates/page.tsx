"use client";

import { useState, useEffect, useCallback } from "react";

interface Candidate {
  id: string;
  title: string;
  contrarian_position: string;
  why_worthy: string;
  suggested_framework: string | null;
  evidence: string;
  challenges: string;
  spov_type: "truth" | "myth";
  confidence: number;
  source_insights: string[];
  created_at: string;
}

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/candidates");
      if (!res.ok) throw new Error("Failed to load candidates");
      const d = await res.json();
      setCandidates(d.candidates || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAction = async (id: string, action: "promote" | "dismiss") => {
    setActing(id);
    try {
      const res = await fetch("/api/candidates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) throw new Error("Action failed");
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      setExpanded((prev) => (prev === id ? null : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">DOK4 Candidates</h1>
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <div className="w-4 h-4 border-2 border-violet/30 border-t-violet rounded-full animate-spin" />
          Loading candidates...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">DOK4 Candidates</h1>
        <p className="text-text-secondary text-sm">
          SPOV-worthy insights surfaced by the pipeline. Review, promote the ones
          worth crafting into full SPOVs, or dismiss.
        </p>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-danger text-sm">
          {error}
        </div>
      )}

      {candidates.length === 0 && (
        <div className="bg-bg-surface border border-border rounded-lg p-8 text-center">
          <p className="text-text-muted text-sm">
            No pending candidates. Run the DOK pipeline to surface new ones.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {candidates.map((c) => (
          <div
            key={c.id}
            className="bg-bg-surface border border-border rounded-lg overflow-hidden"
          >
            {/* Header */}
            <div
              className="px-5 py-4 cursor-pointer hover:bg-bg-hover transition-colors"
              onClick={() => setExpanded(expanded === c.id ? null : c.id)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                        c.spov_type === "truth"
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                          : "bg-red-500/15 text-red-400 border border-red-500/20"
                      }`}
                    >
                      {c.spov_type.toUpperCase()}
                    </span>
                    <span className="text-xs text-text-muted">
                      Confidence: {(c.confidence * 100).toFixed(0)}%
                    </span>
                    {c.suggested_framework && (
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-violet/15 text-violet border border-violet/20">
                        {c.suggested_framework}
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-medium text-text-primary">
                    {c.title}
                  </h3>
                  <p className="text-sm text-text-secondary mt-1 line-clamp-2">
                    {c.contrarian_position}
                  </p>
                </div>
                <svg
                  className={`w-5 h-5 text-text-muted shrink-0 transition-transform ${
                    expanded === c.id ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </div>

            {/* Expanded detail */}
            {expanded === c.id && (
              <div className="px-5 pb-5 border-t border-border pt-4 space-y-4">
                {/* Why worthy */}
                <div>
                  <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">
                    Why This Is SPOV-Worthy
                  </h4>
                  <p className="text-sm text-text-primary">
                    {c.why_worthy}
                  </p>
                </div>

                {/* Evidence */}
                <div>
                  <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">
                    Supporting Evidence
                  </h4>
                  <p className="text-sm text-text-secondary">
                    {c.evidence}
                  </p>
                </div>

                {/* Challenges */}
                <div>
                  <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">
                    Challenges
                  </h4>
                  <p className="text-sm text-text-secondary">
                    {c.challenges}
                  </p>
                </div>

                {/* Framework suggestion */}
                {c.suggested_framework && (
                  <div>
                    <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">
                      Suggested Framework
                    </h4>
                    <p className="text-sm text-violet font-medium">
                      {c.suggested_framework}
                    </p>
                  </div>
                )}

                {/* Source insights */}
                {c.source_insights && c.source_insights.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">
                      Source Insights
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {c.source_insights.map((s, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 text-xs bg-bg-elevated border border-border rounded text-text-secondary"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={() => handleAction(c.id, "promote")}
                    disabled={acting === c.id}
                    className="px-4 py-2 text-sm font-medium bg-violet text-white rounded-lg hover:bg-violet/90 transition-colors disabled:opacity-50"
                  >
                    {acting === c.id ? "..." : "Promote to SPOV"}
                  </button>
                  <button
                    onClick={() => handleAction(c.id, "dismiss")}
                    disabled={acting === c.id}
                    className="px-4 py-2 text-sm font-medium border border-border rounded-lg text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
