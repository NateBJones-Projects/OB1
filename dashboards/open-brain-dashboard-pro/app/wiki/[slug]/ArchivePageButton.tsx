"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Archive (soft-delete) the page. Two-step confirm so a stray click can't archive
// a page. On success the page becomes fetchable-but-archived; we refresh so the
// header flips to the archived state.
export function ArchivePageButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleArchive() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/wiki/pages/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Failed to archive page");
      }
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => {
          setConfirming(true);
          setError(null);
        }}
        className="text-xs px-3 py-1.5 rounded border border-border text-text-muted hover:text-danger hover:border-danger/30 transition-colors"
      >
        Archive
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-text-secondary text-xs">Archive this page?</span>
        <button
          type="button"
          onClick={handleArchive}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded bg-danger/90 hover:bg-danger text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "Archiving…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-xs px-3 py-1.5 rounded border border-border text-text-muted hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  );
}
