"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Mode = "ask" | "search";

export function SearchBar({
  initialQuery,
  initialMode,
}: {
  initialQuery: string;
  initialMode: Mode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const [mode, setMode] = useState<Mode>(initialMode);
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = value.trim();
    const next = new URLSearchParams(params.toString());
    if (trimmed) {
      next.set("q", trimmed);
      next.set("mode", mode);
      next.delete("source");
      next.delete("project");
      next.delete("cursor");
    } else {
      next.delete("q");
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function clear() {
    setValue("");
    router.push(pathname);
  }

  const trimmed = value.trim();
  const hasInput = trimmed.length > 0;
  // "Submitted" = current input matches the active URL query exactly. After
  // a submit lands, swap the dark primary submit button for a gray DEL button
  // (secondary action) so users have a one-click way home. Editing the input
  // afterwards switches back to the submit button.
  const isSubmitted = hasInput && trimmed === initialQuery.trim();

  // Window-level Delete-key handler so the user doesn't have to focus the
  // searchbox to clear. Only active when there's a submitted query, and
  // only when no editable element has focus (so Delete still does its
  // normal thing inside inputs/textareas/contenteditable).
  useEffect(() => {
    if (!isSubmitted) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Delete") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const isEditable =
        tag === "INPUT" || tag === "TEXTAREA" || (t?.isContentEditable ?? false);
      if (isEditable) return;
      e.preventDefault();
      setValue("");
      router.push(pathname);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSubmitted, pathname, router]);

  return (
    <div className="space-y-2">
      <ModeToggle mode={mode} onChange={setMode} />
      <form onSubmit={submit} className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            mode === "ask"
              ? "Ask your brain a question…"
              : "Search your brain — semantic, not keyword"
          }
          className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 pr-12 text-base sm:text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
        />
        {isSubmitted ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear query and return to default dashboard"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 items-center justify-center rounded-md bg-zinc-200 px-2 text-[11px] font-semibold tracking-wide text-zinc-700 transition-colors hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
          >
            DEL
          </button>
        ) : hasInput ? (
          <button
            type="submit"
            aria-label={mode === "ask" ? "Ask" : "Search"}
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        ) : null}
      </form>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const baseBtn =
    "px-2 py-0.5 text-xs font-medium rounded transition-colors focus:outline-none";
  const activeCls = "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900";
  const inactiveCls =
    "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";

  return (
    <div
      role="tablist"
      aria-label="Search mode"
      className="inline-flex items-center gap-0.5 rounded-md border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === "ask"}
        onClick={() => onChange("ask")}
        className={`${baseBtn} ${mode === "ask" ? activeCls : inactiveCls}`}
      >
        Ask
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "search"}
        onClick={() => onChange("search")}
        className={`${baseBtn} ${mode === "search" ? activeCls : inactiveCls}`}
      >
        Search
      </button>
    </div>
  );
}
