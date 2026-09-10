"use client";

import { useActionState } from "react";
import type { ResolveResult } from "./ProposalDecision";

/**
 * Bulk accept/reject bar shown when the inbox is filtered to a single import
 * run (`?run_id=…`). Resolves every open proposal in that run in one call via
 * the /crm/proposals/resolve-run route.
 */
export function RunBulkActions({
  runId,
  openCount,
  action,
}: {
  runId: string;
  openCount: number;
  action: (prev: ResolveResult, formData: FormData) => Promise<ResolveResult>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <div className="bg-violet-surface border border-violet/20 rounded-lg px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="text-sm text-text-secondary">
        Filtered to run <span className="font-mono text-text-primary break-all">{runId}</span>
        {openCount > 0 && (
          <span className="text-text-muted"> · {openCount} open in this run</span>
        )}
      </div>
      {openCount > 0 && (
        <form action={formAction} className="flex items-center gap-2 ml-auto">
          <input type="hidden" name="run_id" value={runId} />
          <button
            type="submit"
            name="decision"
            value="accept"
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded bg-violet hover:bg-violet-dim text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? "…" : "Accept all"}
          </button>
          <button
            type="submit"
            name="decision"
            value="reject"
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded border border-border text-text-muted hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Reject all
          </button>
        </form>
      )}
      {state && "error" in state && <p className="text-danger text-xs w-full">{state.error}</p>}
    </div>
  );
}
