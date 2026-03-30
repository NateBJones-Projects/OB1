"use client";

import { useState, useCallback } from "react";
import { SearchBar } from "@/components/SearchBar";
import { TypeBadge } from "@/components/ThoughtCard";
import Link from "next/link";
import type { Thought } from "@/lib/types";
import { formatDate } from "@/lib/format";

type SearchResult = Thought & { similarity?: number; rank?: number };

interface SearchState {
  results: SearchResult[];
  total: number;
  page: number;
  totalPages: number;
  mode: "semantic" | "text";
}

export default function SearchPage() {
  const [state, setState] = useState<SearchState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState("");
  const [lastMode, setLastMode] = useState<"semantic" | "text">("semantic");

  const doSearch = useCallback(
    async (query: string, mode: "semantic" | "text", page: number = 1) => {
      setLoading(true);
      setError(null);
      setLastQuery(query);
      setLastMode(mode);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query)}&mode=${mode}&page=${page}`
        );
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        setState({
          results: data.results || [],
          total: data.total || 0,
          page: data.page || 1,
          totalPages: data.total_pages || 1,
          mode,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        setState(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const handleSearch = useCallback(
    (query: string, mode: "semantic" | "text") => {
      doSearch(query, mode, 1);
    },
    [doSearch]
  );

  const goToPage = useCallback(
    (page: number) => {
      if (lastQuery) doSearch(lastQuery, lastMode, page);
    },
    [doSearch, lastQuery, lastMode]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Search</h1>
        <p className="text-text-secondary text-sm">
          Search across your second brain
        </p>
      </div>

      <SearchBar onSearch={handleSearch} />

      {loading && (
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <div className="w-4 h-4 border-2 border-violet/30 border-t-violet rounded-full animate-spin" />
          Searching...
        </div>
      )}

      {error && <p className="text-danger text-sm">{error}</p>}

      {state !== null && !loading && (
        <div>
          <p className="text-sm text-text-muted mb-3">
            {state.total} result{state.total !== 1 ? "s" : ""}
            {state.totalPages > 1 && (
              <span>
                {" "}
                &middot; Page {state.page} of {state.totalPages}
              </span>
            )}
          </p>
          <div className="space-y-3">
            {state.results.map((r) => (
              <Link
                key={r.id}
                href={`/thoughts/${r.id}`}
                className="block bg-bg-surface border border-border rounded-lg p-4 hover:border-violet/30 transition-colors"
              >
                <div className="flex items-center gap-3 mb-2">
                  <TypeBadge type={r.type} />
                  {state.mode === "semantic" && r.similarity != null && (
                    <span className="text-xs text-violet font-mono">
                      {(r.similarity * 100).toFixed(1)}% match
                    </span>
                  )}
                  <span className="text-xs text-text-muted ml-auto">
                    {formatDate(r.created_at)}
                  </span>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed">
                  {r.content.length > 300
                    ? r.content.slice(0, 300) + "..."
                    : r.content}
                </p>
              </Link>
            ))}
            {state.results.length === 0 && (
              <p className="text-text-muted text-sm">No results found.</p>
            )}
          </div>

          {/* Pagination */}
          {state.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-text-muted">
                Page {state.page} of {state.totalPages} ({state.total} results)
              </p>
              <div className="flex gap-2">
                {state.page > 1 && (
                  <button
                    onClick={() => goToPage(state.page - 1)}
                    className="px-3 py-1.5 text-sm bg-bg-elevated border border-border rounded-lg text-text-secondary hover:bg-bg-hover transition-colors"
                  >
                    Previous
                  </button>
                )}
                {state.page < state.totalPages && (
                  <button
                    onClick={() => goToPage(state.page + 1)}
                    className="px-3 py-1.5 text-sm bg-bg-elevated border border-border rounded-lg text-text-secondary hover:bg-bg-hover transition-colors"
                  >
                    Next
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
