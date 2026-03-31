"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Thought } from "@/lib/types";
import { TypeBadge } from "@/components/ThoughtCard";
import { PriorityDot } from "@/components/PriorityDot";

function formatAge(dateString: string): string {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 1) return "today";
  if (diffDays === 1) return "1d";
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
  return `${Math.floor(diffDays / 365)}y`;
}

interface KanbanCardProps {
  thought: Thought;
  onCardClick: (thought: Thought) => void;
  onPriorityChange: (thoughtId: number, importance: number) => void;
  showArchiveButton?: boolean;
  onArchive?: (thoughtId: number) => void;
}

export function KanbanCard({
  thought,
  onCardClick,
  onPriorityChange,
  showArchiveButton = false,
  onArchive,
}: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: thought.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    touchAction: "pan-y pinch-zoom",
  };

  const title = thought.content.split("\n")[0].slice(0, 60);
  const topics = Array.isArray(thought.metadata?.topics)
    ? (thought.metadata.topics as string[]).slice(0, 2)
    : [];

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onCardClick(thought)}
      className={`bg-bg-surface border rounded-lg p-3 cursor-pointer select-none transition-all ${
        isDragging
          ? "border-violet/40 shadow-lg opacity-80 scale-[1.02]"
          : "border-border hover:border-violet/30"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <PriorityDot
          importance={thought.importance}
          onPriorityChange={(val) => onPriorityChange(thought.id, val)}
        />
        <TypeBadge type={thought.type} />
      </div>

      <p className="text-sm text-text-primary leading-snug mb-2 line-clamp-2">
        {title}
      </p>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          {topics.map((topic) => (
            <span
              key={topic}
              className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted truncate"
            >
              {topic}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-text-muted">
            {formatAge(thought.created_at)}
          </span>
          {showArchiveButton && onArchive && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onArchive(thought.id);
              }}
              className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
              title="Archive"
            >
              ✓
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
