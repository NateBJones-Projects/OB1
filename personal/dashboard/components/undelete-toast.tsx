"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { undeleteThought } from "@/lib/thought-actions";

const AUTO_DISMISS_MS = 8000;

export function UndeleteToast({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [visible, setVisible] = useState(true);
  const [pending, startTransition] = useTransition();

  // Auto-dismiss removes the toast UI but keeps the row soft-deleted. The
  // user's last chance to undo is within this window — after that they'd
  // need to revisit the row directly (deleted_at is still set in the DB).
  useEffect(() => {
    const t = setTimeout(() => dismiss(), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss() {
    setVisible(false);
    const next = new URLSearchParams(params.toString());
    next.delete("deleted");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function undo() {
    startTransition(async () => {
      // undeleteThought redirects to /, so this never returns.
      await undeleteThought(id);
    });
  }

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      <span className="text-zinc-700 dark:text-zinc-200">Thought deleted.</span>
      <button
        type="button"
        onClick={undo}
        disabled={pending}
        className="text-sm font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-600 disabled:opacity-50 dark:text-zinc-100 dark:hover:text-zinc-300"
      >
        {pending ? "Undoing…" : "Undo"}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
      >
        ✕
      </button>
    </div>
  );
}
