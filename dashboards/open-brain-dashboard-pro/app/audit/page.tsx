"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { TypeBadge } from "@/components/ThoughtCard";
import { DeleteModal } from "@/components/DeleteModal";
import type { Thought, BrowseResponse } from "@/lib/types";

export default function AuditPage() {
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showDelete, setShowDelete] = useState(false);
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/audit?page=${page}`);
      if (!res.ok) throw new Error("Failed to load");
      const d = await res.json();
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!data) return;
    if (selected.size === data.data.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.data.map((t) => t.id)));
    }
  };

  const handleBulkDelete = async () => {
    try {
      const res = await fetch("/api/audit/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error("Delete failed");
      setSelected(new Set());
      setShowFinalConfirm(false);
      setShowDelete(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Audit</h1>
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <div className="w-4 h-4 border-2 border-violet/30 border-t-violet rounded-full animate-spin" />
          Loading low-quality thoughts...
        </div>
      </div>
    );
  }

  const totalPages = data ? Math.ceil(data.total / data.per_page) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Audit</h1>
          <p className="text-text-secondary text-sm">
            Review low quality thoughts (score &lt; 30)
            {data && ` | ${data.total.toLocaleString()} total`}
          </p>
        </div>
        {selected.size > 0 && (
          <button
            onClick={() => setShowDelete(true)}
            className="px-4 py-2 text-sm font-medium text-danger border border-danger/30 rounded-lg hover:bg-danger/10 transition-colors"
          >
            Delete {selected.size} selected
          </button>
        )}
      </div>

      {error && <p className="text-danger text-sm">{error}</p>}

      {data && (
        <div className="bg-bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wider">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={
                      data.data.length > 0 &&
                      selected.size === data.data.length
                    }
                    onChange={toggleAll}
                    className="accent-violet"
                  />
                </th>
                <th className="text-left px-4 py-3 font-medium">Content</th>
                <th className="text-left px-4 py-3 font-medium w-24">Type</th>
                <th className="text-left px-4 py-3 font-medium w-20">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {data.data.map((t: Thought) => (
                <tr key={t.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggleSelect(t.id)}
                      className="accent-violet"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/thoughts/${t.id}`}
                      className="text-text-primary hover:text-violet transition-colors"
                    >
                      {t.content.length > 100
                        ? t.content.slice(0, 100) + "..."
                        : t.content}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <TypeBadge type={t.type} />
                  </td>
                  <td className="px-4 py-3 text-warning font-mono text-xs">
                    {t.quality_score}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-muted">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 text-sm bg-bg-elevated border border-border rounded-lg text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-30"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 text-sm bg-bg-elevated border border-border rounded-lg text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Two-step delete: first confirm count */}
      {showDelete && !showFinalConfirm && (
        <DeleteModal
          title="Confirm Bulk Delete"
          message={`You are about to delete ${selected.size} thought${selected.size !== 1 ? "s" : ""}. Proceed to final confirmation?`}
          onConfirm={async () => {
            setShowDelete(false);
            setShowFinalConfirm(true);
          }}
          onCancel={() => setShowDelete(false)}
        />
      )}
      {showFinalConfirm && (
        <DeleteModal
          title="Final Confirmation"
          message={`This will permanently delete ${selected.size} thought${selected.size !== 1 ? "s" : ""}. This cannot be undone.`}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowFinalConfirm(false)}
        />
      )}
    </div>
  );
}
