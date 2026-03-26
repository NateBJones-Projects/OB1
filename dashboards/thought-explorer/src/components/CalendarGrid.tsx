"use client";

import { CalendarItem } from "@/lib/calendar-types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CalendarGridProps {
  year: number;
  month: number; // 1-indexed
  items: CalendarItem[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

export function CalendarGrid({
  year,
  month,
  items,
  selectedDate,
  onSelectDate,
}: CalendarGridProps) {
  // Build calendar days
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const startPad = firstDay.getDay();
  const totalDays = lastDay.getDate();

  // Group items by date
  const itemsByDate: Record<string, CalendarItem[]> = {};
  for (const item of items) {
    if (!itemsByDate[item.date]) itemsByDate[item.date] = [];
    itemsByDate[item.date].push(item);
  }

  // Build 6 weeks of cells
  const cells: { date: string; day: number; inMonth: boolean }[] = [];

  // Previous month padding
  for (let i = startPad - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, -i);
    cells.push({
      date: d.toISOString().slice(0, 10),
      day: d.getDate(),
      inMonth: false,
    });
  }

  // Current month
  for (let d = 1; d <= totalDays; d++) {
    const dt = new Date(year, month - 1, d);
    cells.push({
      date: dt.toISOString().slice(0, 10),
      day: d,
      inMonth: true,
    });
  }

  // Next month padding to fill grid
  while (cells.length % 7 !== 0 || cells.length < 35) {
    const last = new Date(cells[cells.length - 1].date);
    last.setDate(last.getDate() + 1);
    cells.push({
      date: last.toISOString().slice(0, 10),
      day: last.getDate(),
      inMonth: false,
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAY_NAMES.map((name) => (
          <div
            key={name}
            className="text-center text-xs text-text-muted py-1"
          >
            {name}
          </div>
        ))}
      </div>

      {/* Calendar cells */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const dayItems = itemsByDate[cell.date] || [];
          const isToday = cell.date === today;
          const isSelected = cell.date === selectedDate;

          // Deduplicate dots by source
          const sources = new Set(dayItems.map((i) => i.source));
          const dots = Array.from(sources).map((s) => {
            const item = dayItems.find((i) => i.source === s)!;
            return { source: s, color: item.color };
          });

          return (
            <button
              key={cell.date}
              onClick={() => onSelectDate(cell.date)}
              className={`relative flex flex-col items-center rounded-md p-1 min-h-[3.5rem] transition-colors ${
                cell.inMonth ? "" : "opacity-30"
              } ${
                isSelected
                  ? "bg-accent/15 border border-accent"
                  : "border border-transparent hover:bg-bg-card-hover"
              } ${isToday ? "ring-1 ring-accent/50" : ""}`}
            >
              <span
                className={`text-xs ${
                  isToday
                    ? "font-bold text-accent"
                    : cell.inMonth
                      ? "text-text-primary"
                      : "text-text-muted"
                }`}
              >
                {cell.day}
              </span>

              {/* Dot indicators */}
              {dots.length > 0 && (
                <div className="flex flex-wrap justify-center gap-0.5 mt-1">
                  {dots.slice(0, 5).map(({ source, color }) => (
                    <div
                      key={source}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              )}

              {/* Item count badge */}
              {dayItems.length > 0 && (
                <span className="text-[9px] text-text-muted mt-0.5">
                  {dayItems.length}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
