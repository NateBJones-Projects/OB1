"use client";

import { useState, useTransition } from "react";
import { softDeleteThought } from "@/lib/thought-actions";

type Props = { id: string };

export function DeleteButton({ id }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function ask() {
    setConfirming(true);
  }

  function cancel() {
    setConfirming(false);
  }

  function confirm() {
    startTransition(async () => {
      // softDeleteThought redirects, so this never returns.
      await softDeleteThought(id);
    });
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        <span className="text-zinc-500">Delete this thought?</span>
        <button
          type="button"
          onClick={confirm}
          disabled={pending}
          className="rounded-md bg-red-600 px-2 py-0.5 text-white hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Yes, delete"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="rounded-md px-2 py-0.5 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={ask}
      className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
    >
      Delete
    </button>
  );
}
