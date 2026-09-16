"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { TypeBadge } from "@/components/ThoughtCard";
import { DeleteModal } from "@/components/DeleteModal";
import type { DuplicatePair } from "@/lib/types";

const PER_PAGE = 30;

// Tracks resolution for a pair — "keep_a" = delete B, "keep_b" = delete A, "keep_both" = dismiss
type Selection = "keep_a" | "keep_b" | "keep_both";

export default function DuplicatesPage() {
  const [pairs, setPairs] = useState<DuplicatePair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.85);
  const [offset, setOffset] = useState(0);
  const [resolving, setResolving] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    action: "keep_a" | "keep_b";
    pair: DuplicatePair;
  } | null>(null);

  // Batch selection state: pairKey -> which side to keep
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [confirmBatch, setConfirmBatch] = useState(false);

  const toggleSelection = (key: string, action: Selection) => {
    setSelections((prev) => {
      if (prev[key] === action) {
        // Deselect if clicking the same side
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: action };
    });
  };

  const clearSelections = () => setSelections({});

  const selectedCount = Object.keys(selections).length;

  const processBatch = async () => {
    setBatchProcessing(true);
    setError(null);
    const entries = Object.entries(selections);
    const removedKeys: string[] = [];

    for (const [key, action] of entries) {
      const pair = pairs.find((p) => pairKey(p) === key);
      if (!pair) continue;
      try {
        const res = await fetch("/api/duplicates/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            thought_id_a: pair.thought_id_a,
            thought_id_b: pair.thought_id_b,
          }),
        });
        if (!res.ok) throw new Error(`Failed for pair ${key}`);
        removedKeys.push(key);
      } catch {
        // Continue with remaining — partial success is fine
      }
    }

    // Remove resolved pairs from state
    setPairs((prev) => prev.filter((p) => !removedKeys.includes(pairKey(p))));
    setSelections((prev) => {
      const next = { ...prev };
      for (const k of removedKeys) delete next[k];
      return next;
    });
    setBatchProcessing(false);
    setConfirmBatch(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/duplicates?threshold=${threshold}&limit=${PER_PAGE}&offset=${offset}`
      );
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setPairs(data.pairs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [threshold, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (
    action: "keep_a" | "keep_b" | "keep_both",
    pair: DuplicatePair
  ) => {
    const key = `${pair.thought_id_a}-${pair.thought_id_b}`;
    setResolving(key);
    try {
      const res = await fetch("/api/duplicates/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          thought_id_a: pair.thought_id_a,
          thought_id_b: pair.thought_id_b,
        }),
      });
      if (!res.ok) throw new Error("Resolve failed");
      setPairs((prev) =>
        prev.filter(
          (p) =>
            !(
              p.thought_id_a === pair.thought_id_a &&
              p.thought_id_b === pair.thought_id_b
            )
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolve failed");
    } finally {
      setResolving(null);
      setConfirmDelete(null);
    }
  };

  const pairKey = (p: DuplicatePair) =>
    `${p.thought_id_a}-${p.thought_id_b}`;

  if (loading && pairs.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Duplicates</h1>
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <div className="w-4 h-4 border-2 border-violet/30 border-t-violet rounded-full animate-spin" />
          Searching for near-duplicates...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Duplicates</h1>
          <p className="text-text-secondary text-sm">
            Semantic near-duplicates (similarity &gt; {(threshold * 100).toFixed(0)}%)
            {!loading && ` | ${pairs.length} pairs found`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-text-muted text-xs">Threshold</label>
          <select
            value={threshold}
            onChange={(e) => {
              setThreshold(parseFloat(e.target.value));
              setOffset(0);
              clearSelections();
            }}
            className="bg-bg-elevated border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary"
          >
            <option value={0.95}>95%</option>
            <option value={0.90}>90%</option>
            <option value={0.85}>85%</option>
            <option value={0.80}>80%</option>
          </select>
        </div>
      </div>

      {/* Batch action toolbar */}
      {selectedCount > 0 && (() => {
        const deleteCount = Object.values(selections).filter(s => s === "keep_a" || s === "keep_b").length;
        const keepBothCount = Object.values(selections).filter(s => s === "keep_both").length;
        return (
          <div className="flex items-center gap-3 bg-violet-surface border border-violet/20 rounded-lg px-4 py-3">
            <span className="text-sm text-violet font-medium">
              {selectedCount} pair{selectedCount > 1 ? "s" : ""} selected
              {deleteCount > 0 && keepBothCount > 0 && (
                <span className="text-text-muted font-normal">
                  {" "}({deleteCount} to delete, {keepBothCount} to dismiss)
                </span>
              )}
            </span>
            <button
              disabled={batchProcessing}
              onClick={() => setConfirmBatch(true)}
              className="px-4 py-1.5 text-sm font-medium bg-violet hover:bg-violet-dim text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {batchProcessing ? "Processing..." : `Resolve ${selectedCount} pair${selectedCount > 1 ? "s" : ""}`}
            </button>
            <button
              disabled={batchProcessing}
              onClick={clearSelections}
              className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              Clear
            </button>
          </div>
        );
      })()}

      {error && <p className="text-danger text-sm">{error}</p>}

      {pairs.length === 0 && !loading && (
        <div className="text-text-muted text-sm py-12 text-center">
          No near-duplicates found at this threshold.
        </div>
      )}

      <div className="space-y-4">
        {pairs.map((pair) => {
          const key = pairKey(pair);
          const isResolving = resolving === key;
          const sim = (pair.similarity * 100).toFixed(1);

          return (
            <div
              key={key}
              className="bg-bg-surface border border-border rounded-lg p-4 space-y-3"
            >
              {/* Header with similarity badge */}
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  {sim}% similar
                </span>
                <div className="flex items-center gap-3">
                  <label
                    className={`flex items-center gap-1.5 cursor-pointer px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      selections[key] === "keep_both"
                        ? "text-violet border-violet/30 bg-violet-surface"
                        : "text-text-muted border-border hover:bg-bg-hover"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`pair-${key}`}
                      checked={selections[key] === "keep_both"}
                      onChange={() => toggleSelection(key, "keep_both")}
                      className="accent-violet"
                    />
                    Keep Both
                  </label>
                </div>
              </div>

              {/* Side-by-side content */}
              <div className="grid grid-cols-2 gap-3">
                {/* Left: Thought A */}
                <div
                  className={`bg-bg-elevated rounded-lg p-3 space-y-2 cursor-pointer border-2 transition-colors ${
                    selections[key] === "keep_a"
                      ? "border-emerald-500/50 bg-emerald-500/5"
                      : selections[key] === "keep_b"
                        ? "border-red-500/30 bg-red-500/5"
                        : "border-transparent"
                  }`}
                  onClick={() => toggleSelection(key, "keep_a")}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`pair-${key}`}
                        checked={selections[key] === "keep_a"}
                        onChange={() => toggleSelection(key, "keep_a")}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-emerald-500"
                        title="Keep this, delete the other"
                      />
                      <Link
                        href={`/thoughts/${pair.thought_id_a}`}
                        className="text-xs text-text-muted hover:text-violet"
                        onClick={(e) => e.stopPropagation()}
                      >
                        #{pair.thought_id_a}
                      </Link>
                      <TypeBadge type={pair.type_a} />
                    </div>
                    <span className="text-xs text-text-muted font-mono">
                      Q:{pair.quality_a ?? "—"}
                    </span>
                  </div>
                  <p className="text-sm text-text-primary leading-relaxed">
                    {pair.content_a.length > 200
                      ? pair.content_a.slice(0, 200) + "..."
                      : pair.content_a}
                  </p>
                  <div className="flex items-center justify-between">
                    <time className="text-xs text-text-muted">
                      {new Date(pair.created_a).toLocaleDateString()}
                    </time>
                    <div className="flex items-center gap-2">
                      {selections[key] === "keep_a" && (
                        <span className="text-xs text-emerald-400 font-medium">Keep</span>
                      )}
                      {selections[key] === "keep_b" && (
                        <span className="text-xs text-red-400 font-medium">Delete</span>
                      )}
                      <button
                        disabled={isResolving}
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete({ action: "keep_a", pair });
                        }}
                        className="px-3 py-1 text-xs font-medium text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/10 transition-colors disabled:opacity-30"
                      >
                        Keep This
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right: Thought B */}
                <div
                  className={`bg-bg-elevated rounded-lg p-3 space-y-2 cursor-pointer border-2 transition-colors ${
                    selections[key] === "keep_b"
                      ? "border-emerald-500/50 bg-emerald-500/5"
                      : selections[key] === "keep_a"
                        ? "border-red-500/30 bg-red-500/5"
                        : "border-transparent"
                  }`}
                  onClick={() => toggleSelection(key, "keep_b")}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`pair-${key}`}
                        checked={selections[key] === "keep_b"}
                        onChange={() => toggleSelection(key, "keep_b")}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-emerald-500"
                        title="Keep this, delete the other"
                      />
                      <Link
                        href={`/thoughts/${pair.thought_id_b}`}
                        className="text-xs text-text-muted hover:text-violet"
                        onClick={(e) => e.stopPropagation()}
                      >
                        #{pair.thought_id_b}
                      </Link>
                      <TypeBadge type={pair.type_b} />
                    </div>
                    <span className="text-xs text-text-muted font-mono">
                      Q:{pair.quality_b ?? "—"}
                    </span>
                  </div>
                  <p className="text-sm text-text-primary leading-relaxed">
                    {pair.content_b.length > 200
                      ? pair.content_b.slice(0, 200) + "..."
                      : pair.content_b}
                  </p>
                  <div className="flex items-center justify-between">
                    <time className="text-xs text-text-muted">
                      {new Date(pair.created_b).toLocaleDateString()}
                    </time>
                    <div className="flex items-center gap-2">
                      {selections[key] === "keep_b" && (
                        <span className="text-xs text-emerald-400 font-medium">Keep</span>
                      )}
                      {selections[key] === "keep_a" && (
                        <span className="text-xs text-red-400 font-medium">Delete</span>
                      )}
                      <button
                        disabled={isResolving}
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete({ action: "keep_b", pair });
                        }}
                        className="px-3 py-1 text-xs font-medium text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/10 transition-colors disabled:opacity-30"
                      >
                        Keep This
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {pairs.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-muted">
            Showing {offset + 1}–{offset + pairs.length}
          </p>
          <div className="flex gap-2">
            <button
              disabled={offset <= 0}
              onClick={() => setOffset((o) => Math.max(0, o - PER_PAGE))}
              className="px-3 py-1.5 text-sm bg-bg-elevated border border-border rounded-lg text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-30"
            >
              Previous
            </button>
            <button
              disabled={pairs.length < PER_PAGE}
              onClick={() => setOffset((o) => o + PER_PAGE)}
              className="px-3 py-1.5 text-sm bg-bg-elevated border border-border rounded-lg text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Confirm single delete modal */}
      {confirmDelete && (
        <DeleteModal
          title="Confirm Delete"
          message={`Keep thought #${
            confirmDelete.action === "keep_a"
              ? confirmDelete.pair.thought_id_a
              : confirmDelete.pair.thought_id_b
          } and permanently delete #${
            confirmDelete.action === "keep_a"
              ? confirmDelete.pair.thought_id_b
              : confirmDelete.pair.thought_id_a
          }?`}
          onConfirm={() =>
            resolve(confirmDelete.action, confirmDelete.pair)
          }
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Confirm batch resolve modal */}
      {confirmBatch && (() => {
        const deleteCount = Object.values(selections).filter(s => s === "keep_a" || s === "keep_b").length;
        const keepBothCount = Object.values(selections).filter(s => s === "keep_both").length;
        const parts: string[] = [];
        if (deleteCount > 0) parts.push(`delete ${deleteCount} duplicate${deleteCount > 1 ? "s" : ""}`);
        if (keepBothCount > 0) parts.push(`dismiss ${keepBothCount} pair${keepBothCount > 1 ? "s" : ""}`);
        return (
          <DeleteModal
            title="Confirm Batch Resolve"
            message={`This will ${parts.join(" and ")}. Continue?`}
            onConfirm={processBatch}
            onCancel={() => setConfirmBatch(false)}
          />
        );
      })()}
    </div>
  );
}
