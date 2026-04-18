"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Thought } from "@/lib/types";
import { KANBAN_STATUSES, KANBAN_TYPES } from "@/lib/types";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCard } from "@/components/KanbanCard";
import { KanbanCardModal } from "@/components/KanbanCardModal";

const AUTO_ARCHIVE_DAYS = 30;

async function apiUpdateKanban(
  thoughtId: number,
  updates: Record<string, unknown>
): Promise<void> {
  const res = await fetch("/api/kanban/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thoughtId, ...updates }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Update failed");
  }
}

export function KanbanBoard() {
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedThought, setSelectedThought] = useState<Thought | null>(null);
  const [activeDragThought, setActiveDragThought] = useState<Thought | null>(null);
  const previousThoughts = useRef<Thought[]>([]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 10 } })
  );

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(
        `/api/kanban${showArchived ? "?archived=true" : ""}`
      );
      if (!res.ok) throw new Error("Failed to load kanban data");
      const data = await res.json();
      setThoughts(data.thoughts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setIsLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Group thoughts by status, with auto-archive for old done items
  function groupByStatus(): Record<string, Thought[]> {
    const groups: Record<string, Thought[]> = {};
    for (const s of KANBAN_STATUSES) groups[s] = [];
    if (showArchived) groups["archived"] = [];

    for (const t of thoughts) {
      const thoughtStatus = t.status ?? "new";

      // Auto-archive: done items older than 30 days
      if (
        thoughtStatus === "done" &&
        t.status_updated_at &&
        Date.now() - new Date(t.status_updated_at).getTime() >
          AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000
      ) {
        if (showArchived) groups["archived"].push(t);
        continue;
      }

      if (thoughtStatus === "archived") {
        if (showArchived) groups["archived"].push(t);
        continue;
      }

      if (groups[thoughtStatus]) {
        groups[thoughtStatus].push(t);
      } else {
        groups["new"].push(t);
      }
    }
    return groups;
  }

  function handleDragStart(event: DragStartEvent) {
    const thought = thoughts.find((t) => t.id === event.active.id);
    setActiveDragThought(thought ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragThought(null);
    const { active, over } = event;
    if (!over) return;

    const thoughtId = active.id as number;
    const newStatus = over.id as string;

    // Find which column the thought is currently in
    const thought = thoughts.find((t) => t.id === thoughtId);
    if (!thought || thought.status === newStatus) return;

    // Optimistic update
    previousThoughts.current = [...thoughts];
    setThoughts((prev) =>
      prev.map((t) =>
        t.id === thoughtId
          ? { ...t, status: newStatus, status_updated_at: new Date().toISOString() }
          : t
      )
    );

    // API call in background
    apiUpdateKanban(thoughtId, { status: newStatus }).catch(() => {
      // Revert on failure
      setThoughts(previousThoughts.current);
      setError("Failed to update status. Reverted.");
      setTimeout(() => setError(null), 5000);
    });
  }

  async function handlePriorityChange(thoughtId: number, newImportance: number) {
    previousThoughts.current = [...thoughts];
    setThoughts((prev) =>
      prev.map((t) =>
        t.id === thoughtId ? { ...t, importance: newImportance } : t
      )
    );

    try {
      await apiUpdateKanban(thoughtId, { importance: newImportance });
    } catch {
      setThoughts(previousThoughts.current);
      setError("Failed to update priority. Reverted.");
      setTimeout(() => setError(null), 5000);
    }
  }

  async function handleArchive(thoughtId: number) {
    previousThoughts.current = [...thoughts];
    setThoughts((prev) =>
      prev.map((t) =>
        t.id === thoughtId
          ? { ...t, status: "archived", status_updated_at: new Date().toISOString() }
          : t
      )
    );

    try {
      await apiUpdateKanban(thoughtId, { status: "archived" });
    } catch {
      setThoughts(previousThoughts.current);
      setError("Failed to archive. Reverted.");
      setTimeout(() => setError(null), 5000);
    }
  }

  async function handleDelete(thoughtId: number) {
    previousThoughts.current = [...thoughts];
    setThoughts((prev) => prev.filter((t) => t.id !== thoughtId));

    try {
      const res = await fetch("/api/kanban/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thoughtId }),
      });
      if (!res.ok) throw new Error("Delete failed");
    } catch {
      setThoughts(previousThoughts.current);
      setError("Failed to delete. Reverted.");
      setTimeout(() => setError(null), 5000);
    }
  }

  async function handleModalSave(
    thoughtId: number,
    updates: Record<string, unknown>
  ) {
    previousThoughts.current = [...thoughts];

    // If type changed to non-kanban, remove from board entirely
    const isLeavingKanban =
      typeof updates.type === "string" && !KANBAN_TYPES.includes(updates.type);

    if (isLeavingKanban) {
      setThoughts((prev) => prev.filter((t) => t.id !== thoughtId));
    } else {
      setThoughts((prev) =>
        prev.map((t) => {
          if (t.id !== thoughtId) return t;
          const updated = { ...t, ...updates };
          if (updates.status) updated.status_updated_at = new Date().toISOString();
          return updated as Thought;
        })
      );
    }

    try {
      await apiUpdateKanban(thoughtId, updates);
    } catch {
      setThoughts(previousThoughts.current);
      setError("Failed to save changes. Reverted.");
      setTimeout(() => setError(null), 5000);
    }
  }

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="flex gap-3">
        {KANBAN_STATUSES.map((s) => (
          <div
            key={s}
            className="flex-1 min-w-0 rounded-lg border border-border bg-bg-primary"
          >
            <div className="px-3 py-2.5 border-b border-border">
              <div className="h-4 w-20 bg-bg-hover rounded animate-pulse" />
            </div>
            <div className="p-2 space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-20 bg-bg-hover rounded-lg animate-pulse"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const grouped = groupByStatus();
  const columns = showArchived
    ? [...KANBAN_STATUSES, "archived" as const]
    : [...KANBAN_STATUSES];

  return (
    <>
      {/* Error banner */}
      {error && (
        <div className="mb-4 px-4 py-2 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded border-border"
            />
            Show archived
          </label>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsLoading(true);
            fetchData();
          }}
          className="text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Board */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-2 md:gap-3 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:overflow-x-visible">
          {columns.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              thoughts={grouped[status] || []}
              onCardClick={setSelectedThought}
              onPriorityChange={handlePriorityChange}
              onArchive={handleArchive}
            />
          ))}
        </div>
        <DragOverlay>
          {activeDragThought && (
            <div className="rotate-[2deg] opacity-95 shadow-2xl w-[200px]">
              <KanbanCard
                thought={activeDragThought}
                onCardClick={() => {}}
                onPriorityChange={() => {}}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Modal */}
      {selectedThought && (
        <KanbanCardModal
          thought={selectedThought}
          onSave={handleModalSave}
          onArchive={handleArchive}
          onDelete={handleDelete}
          onClose={() => setSelectedThought(null)}
        />
      )}
    </>
  );
}
