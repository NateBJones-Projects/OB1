"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

const IMPORTANCE_OPTIONS = [1, 2, 3, 4, 5];

export function ThoughtsFilter({
  types,
  currentType,
  currentSource,
  currentImportance,
}: {
  types: string[];
  currentType: string;
  currentSource: string;
  currentImportance: number | undefined;
}) {
  const router = useRouter();

  const applyFilters = useCallback(
    (overrides: Record<string, string>) => {
      const sp = new URLSearchParams();
      const vals = {
        type: currentType,
        source_type: currentSource,
        importance_min: currentImportance?.toString() || "",
        ...overrides,
      };
      sp.set("page", "1");
      if (vals.type) sp.set("type", vals.type);
      if (vals.source_type) sp.set("source_type", vals.source_type);
      if (vals.importance_min) sp.set("importance_min", vals.importance_min);
      router.push(`/thoughts?${sp.toString()}`);
    },
    [router, currentType, currentSource, currentImportance]
  );

  return (
    <div className="flex flex-wrap items-end gap-4 bg-bg-surface border border-border rounded-lg p-4">
      <div>
        <label className="block text-xs text-text-muted mb-1">Type</label>
        <select
          value={currentType}
          onChange={(e) => applyFilters({ type: e.target.value })}
          className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-violet"
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-text-muted mb-1">Source</label>
        <input
          type="text"
          value={currentSource}
          onChange={(e) => applyFilters({ source_type: e.target.value })}
          placeholder="e.g. chatgpt_import"
          className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-violet w-44"
        />
      </div>

      <div>
        <label className="block text-xs text-text-muted mb-1">
          Min Importance
        </label>
        <select
          value={currentImportance?.toString() || ""}
          onChange={(e) =>
            applyFilters({
              importance_min: e.target.value,
            })
          }
          className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-violet"
        >
          <option value="">All levels</option>
          {IMPORTANCE_OPTIONS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </div>

      {(currentType || currentSource || currentImportance) && (
        <button
          onClick={() =>
            applyFilters({ type: "", source_type: "", importance_min: "" })
          }
          className="text-xs text-text-muted hover:text-danger transition-colors pb-2"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
