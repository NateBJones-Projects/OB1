"use client";

import { useState, useTransition } from "react";
import { Markdown } from "@/components/markdown";
import { editThought } from "@/lib/thought-actions";

type Props = { id: string; initialContent: string };

export function EditableContent({ id, initialContent }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialContent);
  const [content, setContent] = useState(initialContent);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function startEdit() {
    setDraft(content);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setDraft(content);
    setError(null);
    setEditing(false);
  }

  function save() {
    const next = draft.trim();
    if (!next) {
      setError("Cannot save empty content.");
      return;
    }
    if (next === content.trim()) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await editThought(id, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setContent(next);
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-zinc-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.max(8, Math.min(30, draft.split("\n").length + 2))}
          autoFocus
          disabled={pending}
          className="w-full resize-y rounded-md border border-zinc-200 bg-white p-3 font-mono text-base sm:text-sm text-zinc-900 focus:outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500"
        />
        {error ? (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-zinc-500">
            Saving regenerates the embedding so search stays accurate.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={startEdit}
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Edit
        </button>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <Markdown>{content}</Markdown>
      </div>
    </div>
  );
}
