"use client";

import { CalendarItem, SOURCE_LABELS } from "@/lib/calendar-types";

interface DayDetailProps {
  date: string;
  items: CalendarItem[];
  onClose: () => void;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function DayDetail({ date, items, onClose }: DayDetailProps) {
  // Group by source
  const grouped: Record<string, CalendarItem[]> = {};
  for (const item of items) {
    if (!grouped[item.source]) grouped[item.source] = [];
    grouped[item.source].push(item);
  }

  return (
    <div className="rounded-lg border border-border bg-bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">
          {formatDate(date)}
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-text-muted hover:text-text-secondary"
        >
          Close
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-text-muted">Nothing scheduled.</p>
      ) : (
        Object.entries(grouped).map(([source, sourceItems]) => (
          <div key={source}>
            <div className="flex items-center gap-2 mb-2">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: sourceItems[0].color }}
              />
              <span className="text-xs font-medium text-text-secondary">
                {SOURCE_LABELS[source] || source} ({sourceItems.length})
              </span>
            </div>
            <div className="space-y-1 pl-4">
              {sourceItems.map((item) => (
                <div
                  key={item.id}
                  className="text-xs text-text-primary leading-relaxed"
                >
                  {item.title}
                  {item.status && (
                    <span className="ml-2 text-text-muted">
                      [{item.status}]
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
