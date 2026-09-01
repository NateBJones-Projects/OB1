"use client";

import { useActionState } from "react";

// The server action returns one of these; `undefined` is the initial state.
export type ResolveResult = { ok: true } | { error: string } | undefined;

/**
 * Accept/reject buttons for a single proposal row on the proposals inbox.
 * Mirrors the per-row pattern in contacts/[id]/ContactProposals.tsx, laid out
 * to sit inside a table cell.
 */
export function ProposalDecision({
  proposalId,
  action,
}: {
  proposalId: string;
  action: (prev: ResolveResult, formData: FormData) => Promise<ResolveResult>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <div className="space-y-1">
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="proposal_id" value={proposalId} />
        <button
          type="submit"
          name="decision"
          value="accept"
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded bg-violet hover:bg-violet-dim text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "…" : "Accept"}
        </button>
        <button
          type="submit"
          name="decision"
          value="reject"
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded border border-border text-text-muted hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reject
        </button>
      </form>
      {state && "error" in state && <p className="text-danger text-xs">{state.error}</p>}
    </div>
  );
}
