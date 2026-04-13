"use client";

import { useState, useEffect } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Thought, KanbanStatus } from "@/lib/types";
import { KANBAN_LABELS } from "@/lib/types";
import { KanbanCard } from "@/components/KanbanCard";

const COLUMN_ACCENT: Record<string, string> = {
  new: "border-t-slate-500",
  planning: "border-t-violet",
  active: "border-t-blue-500",
  review: "border-t-amber-500",
  done: "border-t-emerald-500",
  archived: "border-t-slate-600",
};

function collapseKey(status: string): string {
  return `kanban-${status}-collapsed`;
}

interface KanbanColumnProps {
  status: string;
  thoughts: Thought[];
  onCardClick: (thought: Thought) => void;
  onPriorityChange: (thoughtId: number, importance: number) => void;
  onArchive: (thoughtId: number) => void;
}

export function KanbanColumn({
  status,
  thoughts,
  onCardClick,
  onPriorityChange,
  onArchive,
}: KanbanColumnProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Load collapse state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(collapseKey(status));
    if (stored === "true") setIsCollapsed(true);
  }, [status]);

  function toggleCollapse() {
    const nextState = !isCollapsed;
    setIsCollapsed(nextState);
    localStorage.setItem(collapseKey(status), String(nextState));
  }

  const { setNodeRef, isOver } = useDroppable({ id: status });
  const accentClass = COLUMN_ACCENT[status] || COLUMN_ACCENT.new;
  const label = KANBAN_LABELS[status as KanbanStatus] ?? status;

  // Collapsed: slim vertical bar with rotated label
  if (isCollapsed) {
    return (
      <div
        ref={setNodeRef}
        className={`flex flex-col items-center rounded-lg border border-border border-t-2 ${accentClass} bg-bg-primary shrink-0 transition-all w-10 min-w-10 cursor-pointer max-h-[calc(100vh-130px)] md:max-h-[calc(100vh-220px)] ${
          isOver ? "bg-violet/5 border-violet/20" : "hover:border-violet/20"
        }`}
        onClick={toggleCollapse}
        title={`Expand ${label} column`}
      >
        <div className="py-3 flex flex-col items-center gap-2">
          <span className="text-xs text-text-muted">▶</span>
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-bg-hover text-text-muted text-xs font-medium">
            {thoughts.length}
          </span>
          <span
            className="text-xs font-medium text-text-secondary"
            style={{ writingMode: "vertical-lr" }}
          >
            {label}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-lg border border-border border-t-2 ${accentClass} bg-bg-primary flex-1 min-w-[120px] md:min-w-0 transition-colors max-h-[calc(100vh-130px)] md:max-h-[calc(100vh-220px)] ${
        isOver ? "bg-violet/5 border-violet/20" : ""
      }`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleCollapse}
            className="text-text-muted hover:text-text-primary transition-colors text-xs"
            title="Collapse"
          >
            ◀
          </button>
          <span className="text-sm font-medium text-text-primary">
            {label}
          </span>
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-bg-hover text-text-muted text-xs font-medium">
            {thoughts.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <SortableContext
        items={thoughts.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px]">
          {thoughts.length === 0 ? (
            <p className="text-xs text-text-muted text-center py-8">
              No items
            </p>
          ) : (
            thoughts.map((thought) => (
              <KanbanCard
                key={thought.id}
                thought={thought}
                onCardClick={onCardClick}
                onPriorityChange={onPriorityChange}
                showArchiveButton={status === "done"}
                onArchive={onArchive}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}
