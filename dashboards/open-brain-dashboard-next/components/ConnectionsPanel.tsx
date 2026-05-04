"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TypeBadge } from "./ThoughtCard";
import { FormattedDate } from "./FormattedDate";

interface Connection {
  id: number;
  type: string;
  importance: number;
  preview: string;
  content: string;
  created_at: string;
  similarity: number;
  metadata: { topics?: string[]; people?: string[] };
  shared_topics?: string[];
  shared_people?: string[];
  overlap_count?: number;
}

export function ConnectionsPanel({
  thoughtId,
  hasMetadata,
}: {
  thoughtId: number;
  hasMetadata: boolean;
}) {
  const [connections, setConnections] = useState<Connection[] | null>(
    hasMetadata ? null : []
  );

  useEffect(() => {
    if (!hasMetadata) return;

    let cancelled = false;
    fetch(`/api/thoughts/${thoughtId}/connections`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setConnections(data.connections ?? []);
      })
      .catch(() => {
        if (!cancelled) setConnections([]);
      });

    return () => {
      cancelled = true;
    };
  }, [thoughtId, hasMetadata]);

  const loading = hasMetadata && connections === null;
  const items = connections ?? [];

  if (!hasMetadata || (!loading && items.length === 0)) return null;

  return (
    <div className="bg-bg-surface border border-border rounded-lg p-5">
      <h3 className="text-sm font-medium text-text-primary mb-3">
        Connections
      </h3>
      {loading ? (
        <p className="text-xs text-text-muted">Loading connections...</p>
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <Link
              key={c.id}
              href={`/thoughts/${c.id}`}
              className="block p-3 rounded-lg border border-border hover:border-violet/50 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <TypeBadge type={c.type} />
                <span className="text-xs text-text-muted">
                  <FormattedDate date={c.created_at} />
                </span>
                {c.similarity > 0 && (
                  <span className="text-xs text-violet/70 ml-auto">
                    {(c.similarity * 100).toFixed(0)}% match
                  </span>
                )}
              </div>
              <p className="text-sm text-text-secondary line-clamp-2">
                {c.preview || c.content}
              </p>
              {(() => {
                const topics = c.shared_topics ?? c.metadata?.topics ?? [];
                const people = c.shared_people ?? c.metadata?.people ?? [];
                if (topics.length === 0 && people.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {topics.map((t) => (
                      <span
                        key={t}
                        className="px-1.5 py-0.5 rounded bg-violet-surface text-violet text-[10px]"
                      >
                        {t}
                      </span>
                    ))}
                    {people.map((p) => (
                      <span
                        key={p}
                        className="px-1.5 py-0.5 rounded bg-bg-elevated text-text-secondary text-[10px]"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                );
              })()}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
