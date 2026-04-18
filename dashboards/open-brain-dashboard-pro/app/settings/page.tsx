"use client";

import { useState, useEffect } from "react";

interface BrainStatus {
  healthy: boolean;
  totalThoughts: number;
  embeddingCoverage: string;
  types: Record<string, number>;
  topTopics: Array<{ topic: string; count: number }>;
  sources: Record<string, number>;
  apiKeyPrefix: string;
}

export default function SettingsPage() {
  const [status, setStatus] = useState<BrainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings/status");
        if (!res.ok) throw new Error("Failed to load brain status");
        const data: BrainStatus = await res.json();
        setStatus(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <div className="w-4 h-4 border-2 border-violet/30 border-t-violet rounded-full animate-spin" />
          Loading brain status...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
        <div className="bg-danger/10 border border-danger/20 rounded-lg p-4 text-danger text-sm">
          {error}
        </div>
      </div>
    );
  }

  if (!status) return null;

  const typeEntries = Object.entries(status.types).sort((a, b) => b[1] - a[1]);
  const sourceEntries = Object.entries(status.sources).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
        <p className="text-sm text-text-muted mt-1">
          Brain status and connection details
        </p>
      </div>

      {/* Connection status */}
      <section className="bg-bg-surface border border-border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
          Connection
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-xs text-text-muted">Status</span>
            <div className="flex items-center gap-2 mt-1">
              <div className={`w-2 h-2 rounded-full ${status.healthy ? "bg-success" : "bg-danger"}`} />
              <span className={`text-sm font-medium ${status.healthy ? "text-success" : "text-danger"}`}>
                {status.healthy ? "Connected" : "Disconnected"}
              </span>
            </div>
          </div>
          <div>
            <span className="text-xs text-text-muted">API Key</span>
            <p className="text-sm text-text-secondary mt-1 font-mono">
              {status.apiKeyPrefix}...
            </p>
          </div>
        </div>
      </section>

      {/* Brain overview */}
      <section className="bg-bg-surface border border-border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
          Your Brain
        </h2>

        {status.totalThoughts === 0 ? (
          <div className="text-center py-8">
            <p className="text-text-muted text-sm mb-4">
              Your brain is empty. Add your first thought to get started.
            </p>
            <a
              href="/ingest"
              className="inline-flex px-5 py-2.5 bg-violet hover:bg-violet-dim text-white font-medium rounded-lg transition-colors"
            >
              Add your first thought
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard label="Total Thoughts" value={status.totalThoughts.toLocaleString()} />
            <StatCard label="Embeddings" value={status.embeddingCoverage} />
            <StatCard label="Types" value={String(typeEntries.length)} />
          </div>
        )}
      </section>

      {/* Type breakdown */}
      {typeEntries.length > 0 && (
        <section className="bg-bg-surface border border-border rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
            Thought Types
          </h2>
          <div className="space-y-2">
            {typeEntries.map(([type, count]) => {
              const pct = Math.round((count / status.totalThoughts) * 100);
              return (
                <div key={type} className="flex items-center gap-3">
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-bg-elevated border border-border text-text-secondary w-24 text-center">
                    {type}
                  </span>
                  <div className="flex-1 h-2 bg-bg-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet rounded-full transition-all"
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                  <span className="text-xs text-text-muted w-20 text-right">
                    {count.toLocaleString()} ({pct}%)
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Source breakdown */}
      {sourceEntries.length > 0 && (
        <section className="bg-bg-surface border border-border rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
            Sources
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {sourceEntries.map(([source, count]) => (
              <div
                key={source}
                className="flex items-center justify-between px-3 py-2 bg-bg-elevated border border-border rounded-md"
              >
                <span className="text-xs text-text-secondary truncate">
                  {source.replace(/_/g, " ")}
                </span>
                <span className="text-xs text-text-muted font-medium ml-2">
                  {count.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top topics */}
      {status.topTopics.length > 0 && (
        <section className="bg-bg-surface border border-border rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
            Top Topics
          </h2>
          <div className="flex flex-wrap gap-2">
            {status.topTopics.map(({ topic, count }) => (
              <span
                key={topic}
                className="text-xs px-2.5 py-1 rounded-full bg-bg-elevated border border-border text-text-secondary"
              >
                {topic}
                <span className="text-text-muted ml-1.5">{count}</span>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-elevated border border-border rounded-md px-4 py-3">
      <span className="text-xs text-text-muted">{label}</span>
      <p className="text-lg font-semibold text-text-primary mt-0.5">{value}</p>
    </div>
  );
}
