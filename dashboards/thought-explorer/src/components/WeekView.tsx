"use client";

import { CalendarItem, SOURCE_LABELS } from "@/lib/calendar-types";

interface WeekViewProps {
  startDate: string; // YYYY-MM-DD of the week's Sunday
  items: CalendarItem[];
  onSelectDate: (date: string) => void;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function WeekView({ startDate, items, onSelectDate }: WeekViewProps) {
  const start = new Date(startDate + "T12:00:00");
  const today = new Date().toISOString().slice(0, 10);

  // Build 7 days
  const days: { date: string; label: string; dayName: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    days.push({
      date: dateStr,
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      dayName: DAY_NAMES[d.getDay()],
    });
  }

  // Group items by date
  const itemsByDate: Record<string, CalendarItem[]> = {};
  for (const item of items) {
    if (!itemsByDate[item.date]) itemsByDate[item.date] = [];
    itemsByDate[item.date].push(item);
  }

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((day) => {
        const dayItems = itemsByDate[day.date] || [];
        const isToday = day.date === today;

        return (
          <div
            key={day.date}
            className={`rounded-lg border p-2 min-h-[10rem] cursor-pointer transition-colors ${
              isToday
                ? "border-accent/50 bg-accent/5"
                : "border-border bg-bg-card hover:bg-bg-card-hover"
            }`}
            onClick={() => onSelectDate(day.date)}
          >
            <div className="text-center mb-2">
              <div className="text-[10px] text-text-muted">{day.dayName}</div>
              <div
                className={`text-xs font-medium ${isToday ? "text-accent" : "text-text-primary"}`}
              >
                {day.label}
              </div>
            </div>

            <div className="space-y-1">
              {dayItems.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-1"
                >
                  <div
                    className="mt-1 h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-[10px] text-text-secondary leading-tight line-clamp-2">
                    {item.title}
                  </span>
                </div>
              ))}
              {dayItems.length > 6 && (
                <span className="text-[9px] text-text-muted">
                  +{dayItems.length - 6} more
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
