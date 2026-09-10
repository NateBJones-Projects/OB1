"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Per-section outcome from a wiki-profile worker run. `action` values:
//   created / updated — section written in place (machine-owned)
//   pending           — section is human-owned; draft parked for review
//   skipped           — no supporting thoughts / cap reached; left untouched
//   error             — that section failed; the rest of the run continued
type SectionOutcome = {
  section_key: string;
  action: string;
  reason?: string;
  thought_count?: number;
};

type RegenerateResponse = {
  sections?: SectionOutcome[];
  error?: string;
};

const ACTION_STYLES: Record<string, string> = {
  created: "text-violet",
  updated: "text-violet",
  pending: "text-amber",
  skipped: "text-text-muted",
  error: "text-danger",
};

function outcomeLabel(o: SectionOutcome): string {
  if (o.action === "pending") return "pending — awaiting your review";
  if (o.action === "skipped" && o.reason === "no_supporting_thoughts") return "skipped — no evidence";
  return o.action;
}

/**
 * Triggers the wiki-profile consolidation worker via
 * POST /api/wiki/profile/regenerate and renders the per-section outcome
 * summary the worker returns. Used in the /wiki/user-profile page header
 * ("Regenerate profile") and, with `successHref`, by the /wiki list's
 * "Create your profile" card — the worker bootstraps the page itself, so
 * both flows hit the same route.
 */
export function RegenerateProfileButton({
  label = "Regenerate profile",
  successHref,
}: {
  label?: string;
  /**
   * When set, navigate here after a successful run instead of rendering the
   * outcome summary in place (the create-CTA lands the user on the fresh page,
   * where the sections — including any pending review panels — are visible).
   */
  successHref?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<SectionOutcome[] | null>(null);

  async function handleRun() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setOutcomes(null);
    try {
      const res = await fetch("/api/wiki/profile/regenerate", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as RegenerateResponse;
      if (!res.ok) {
        throw new Error(data.error || "Profile generation failed");
      }
      const sections = Array.isArray(data.sections) ? data.sections : [];
      // The worker returns 200 even when individual sections fail; only
      // navigate away when the run was fully clean, otherwise stay and show
      // the per-section outcomes so errors aren't silently dropped.
      if (successHref && !sections.some((s) => s.action === "error")) {
        router.push(successHref);
        router.refresh();
        return;
      }
      setOutcomes(sections);
      // Re-read the server component so new/updated section bodies (and any
      // pending review panels) render without a manual reload.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2 max-w-sm">
      <button
        type="button"
        onClick={handleRun}
        disabled={busy}
        className="px-3 py-2 text-sm bg-violet hover:bg-violet-dim text-white font-medium rounded-lg transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? "Generating… this can take a minute" : label}
      </button>
      {error && <p className="text-danger text-xs text-right">{error}</p>}
      {outcomes && (
        <div className="w-full bg-bg-surface border border-border rounded-lg px-3 py-2 space-y-1">
          {outcomes.length === 0 ? (
            <p className="text-text-muted text-xs">The run completed but reported no sections.</p>
          ) : (
            outcomes.map((o) => (
              <div
                key={o.section_key}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="font-mono text-text-secondary truncate">{o.section_key}</span>
                <span className={`whitespace-nowrap ${ACTION_STYLES[o.action] ?? "text-text-secondary"}`}>
                  {outcomeLabel(o)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
