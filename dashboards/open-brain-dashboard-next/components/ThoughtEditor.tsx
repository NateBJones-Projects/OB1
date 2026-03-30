"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Thought } from "@/lib/types";

const TYPES = [
  "idea",
  "task",
  "person_note",
  "reference",
  "decision",
  "lesson",
  "meeting",
  "journal",
];

const IMPORTANCE_OPTIONS = [1, 2, 3, 4, 5];

export function ThoughtEditor({
  thought,
  editAction,
}: {
  thought: Thought;
  editAction: (formData: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const router = useRouter();

  if (!editing) {
    return (
      <div className="bg-bg-surface border border-border rounded-lg p-5">
        <div className="flex justify-between items-start mb-3">
          <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
            Content
          </h2>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-violet hover:text-violet-dim transition-colors"
          >
            Edit
          </button>
        </div>
        <p className="text-text-primary whitespace-pre-wrap leading-relaxed">
          {thought.content}
        </p>
      </div>
    );
  }

  return (
    <form
      action={async (formData) => {
        await editAction(formData);
        setEditing(false);
        router.refresh();
      }}
      className="bg-bg-surface border border-violet/30 rounded-lg p-5 space-y-4"
    >
      <textarea
        name="content"
        defaultValue={thought.content}
        rows={8}
        className="w-full bg-bg-elevated border border-border rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition resize-y"
      />
      <div className="flex gap-4">
        <div>
          <label className="block text-xs text-text-muted mb-1">Type</label>
          <select
            name="type"
            defaultValue={thought.type}
            className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-violet"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">
            Importance
          </label>
          <select
            name="importance"
            defaultValue={String(
              Math.min(Math.max(thought.importance || 3, 1), 5)
            )}
            className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-20 focus:outline-none focus:border-violet"
          >
            {IMPORTANCE_OPTIONS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium bg-violet hover:bg-violet-dim text-white rounded-lg transition-colors"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-elevated border border-border rounded-lg hover:bg-bg-hover transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
