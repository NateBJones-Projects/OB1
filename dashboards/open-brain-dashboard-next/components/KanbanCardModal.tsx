"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Thought, KanbanStatus } from "@/lib/types";
import { KANBAN_STATUSES, KANBAN_LABELS, PRIORITY_LEVELS, getPriorityLevel, THOUGHT_TYPES, KANBAN_TYPES } from "@/lib/types";

interface KanbanCardModalProps {
  thought: Thought;
  onSave: (
    thoughtId: string,
    updates: { content?: string; status?: string; importance?: number; type?: string }
  ) => void;
  onArchive: (thoughtId: string) => void;
  onDelete: (thoughtId: string) => void;
  onClose: () => void;
}

export function KanbanCardModal({
  thought,
  onSave,
  onArchive,
  onDelete,
  onClose,
}: KanbanCardModalProps) {
  const [content, setContent] = useState(thought.content);
  const [status, setStatus] = useState(thought.status ?? "new");
  const [importance, setImportance] = useState(thought.importance);
  const [type, setType] = useState(thought.type);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasChanges =
    content !== thought.content ||
    status !== (thought.status ?? "new") ||
    importance !== thought.importance ||
    type !== thought.type;

  const tryClose = useCallback(() => {
    if (hasChanges) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [hasChanges, onClose]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        tryClose();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [tryClose]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    // Scroll to top so fixed positioning works on mobile
    window.scrollTo(0, 0);
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [content]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) {
      tryClose();
    }
  }

  function handleSave() {
    const updates: Record<string, unknown> = {};
    if (content !== thought.content) updates.content = content;
    if (status !== (thought.status ?? "new")) updates.status = status;
    if (importance !== thought.importance) updates.importance = importance;
    if (type !== thought.type) {
      updates.type = type;
      // Changing to a non-kanban type removes it from the board
      if (!KANBAN_TYPES.includes(type)) {
        updates.status = null;
      }
    }

    if (Object.keys(updates).length > 0) {
      onSave(thought.id, updates);
    }
    onClose();
  }

  const topics = Array.isArray(thought.metadata?.topics)
    ? (thought.metadata.topics as string[])
    : [];
  const createdDate = new Date(thought.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const currentPriority = getPriorityLevel(importance);

  return <>{createPortal(
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit thought: ${thought.content.split("\n")[0].slice(0, 40)}`}
      className="fixed inset-0 z-50 bg-black/60 p-5 pt-16 pb-8 lg:p-0 lg:flex lg:items-center lg:justify-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-surface border border-border rounded-xl w-full max-h-full max-w-lg flex flex-col shadow-2xl overflow-hidden mx-auto"
      >
        {/* Discard confirmation banner */}
        {showDiscardConfirm && (
          <div className="flex items-center justify-between px-5 py-2.5 bg-warning/10 border-b border-warning/20 shrink-0">
            <span className="text-sm text-warning">Unsaved changes. Discard?</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1 text-xs text-danger hover:text-red-300 transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-text-primary truncate">
            Edit
          </h2>
          <button
            type="button"
            onClick={tryClose}
            className="text-text-muted hover:text-text-primary transition-colors text-lg"
          >
            ✕
          </button>
        </div>

        {/* Fields — scrollable */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Status + Priority + Type row */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full bg-bg-hover border border-border rounded-lg px-2.5 py-1.5 text-sm text-text-primary focus:outline-none focus:border-violet/40"
              >
                {KANBAN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {KANBAN_LABELS[s as KanbanStatus]}
                  </option>
                ))}
                <option value="archived">Archived</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">Priority</label>
              <select
                value={currentPriority.label}
                onChange={(e) => {
                  const level = PRIORITY_LEVELS.find((p) => p.label === e.target.value);
                  if (level) setImportance(level.value);
                }}
                className="w-full bg-bg-hover border border-border rounded-lg px-2.5 py-1.5 text-sm text-text-primary focus:outline-none focus:border-violet/40"
              >
                {PRIORITY_LEVELS.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full bg-bg-hover border border-border rounded-lg px-2.5 py-1.5 text-sm text-text-primary focus:outline-none focus:border-violet/40"
              >
                {THOUGHT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              {!KANBAN_TYPES.includes(type) && (
                <p className="text-[10px] text-warning mt-1">
                  This type won&apos;t appear on the kanban board
                </p>
              )}
            </div>
          </div>

          {/* Content */}
          <div>
            <label className="block text-xs text-text-muted mb-1">Content</label>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full bg-bg-hover border border-border rounded-lg px-3 py-2 text-sm text-text-primary leading-relaxed resize-none focus:outline-none focus:border-violet/40 min-h-[100px] max-h-[40vh]"
              rows={4}
            />
          </div>

          {/* Read-only info */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
            <span>Created: {createdDate}</span>
            {topics.length > 0 && (
              <span>Topics: {topics.join(", ")}</span>
            )}
            <span>ID: {thought.id}</span>
          </div>
        </div>

        {/* Actions — always visible */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border shrink-0">
          <div className="flex items-center gap-3">
            {thought.status === "done" && (
              <button
                type="button"
                onClick={() => {
                  onArchive(thought.id);
                  onClose();
                }}
                className="text-sm text-text-muted hover:text-amber-400 transition-colors"
              >
                Archive
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setShowDiscardConfirm(false);
                setShowDeleteConfirm(true);
              }}
              className="text-sm text-text-muted hover:text-danger transition-colors"
            >
              Delete
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={tryClose}
              className="px-4 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!hasChanges}
              className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
                hasChanges
                  ? "bg-violet text-white hover:bg-violet/80"
                  : "bg-bg-hover text-text-muted cursor-not-allowed"
              }`}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )}

  {showDeleteConfirm && createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={() => setShowDeleteConfirm(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-surface border border-border rounded-xl p-6 w-full max-w-sm shadow-2xl mx-4"
      >
        <h3 className="text-base font-semibold text-text-primary mb-2">Delete thought?</h3>
        <p className="text-sm text-text-secondary mb-5">
          This will permanently delete this thought. This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(false)}
            className="px-4 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onDelete(thought.id);
              onClose();
            }}
            className="px-4 py-1.5 text-sm rounded-lg bg-danger text-white hover:bg-danger/80 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body
  )}</>;

}
