"use client";

import { useState, useCallback } from "react";

export function SearchBar({
  onSearch,
  initialQuery = "",
  initialMode = "semantic",
  placeholder = "Search your thoughts...",
}: {
  onSearch: (query: string, mode: "semantic" | "text") => void;
  initialQuery?: string;
  initialMode?: "semantic" | "text";
  placeholder?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [mode, setMode] = useState<"semantic" | "text">(initialMode);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (query.trim()) onSearch(query.trim(), mode);
    },
    [query, mode, onSearch]
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="flex-1 px-4 py-2.5 bg-bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition"
        />
        <button
          type="submit"
          className="px-5 py-2.5 bg-violet hover:bg-violet-dim text-white font-medium rounded-lg transition-colors"
        >
          Search
        </button>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="semantic"
              checked={mode === "semantic"}
              onChange={() => setMode("semantic")}
              className="accent-violet"
            />
            <span className="text-sm text-text-secondary">Semantic</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="text"
              checked={mode === "text"}
              onChange={() => setMode("text")}
              className="accent-violet"
            />
            <span className="text-sm text-text-secondary">Full-text</span>
          </label>
        </div>
        {mode === "text" && (
          <span className="text-xs text-text-muted">
            Supports: <code className="text-violet/70">&quot;exact phrase&quot;</code>{" "}
            <code className="text-violet/70">AND</code>{" "}
            <code className="text-violet/70">OR</code>{" "}
            <code className="text-violet/70">-exclude</code>
          </span>
        )}
      </div>
    </form>
  );
}
