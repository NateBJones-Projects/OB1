"use client";

import { useActionState } from "react";
import type { CrmProposal } from "@/lib/types";

// The server action returns one of these; `undefined` is the initial state.
export type ResolveResult = { ok: true } | { error: string } | undefined;

function ProposalRow({
  contactId,
  proposal,
  action,
}: {
  contactId: string;
  proposal: CrmProposal;
  action: (prev: ResolveResult, formData: FormData) => Promise<ResolveResult>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <li className="px-4 py-3 space-y-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-text-primary font-medium">{proposal.field_key}</span>
        <span className="text-text-muted text-xs">{proposal.target_kind}</span>
        {proposal.confidence !== null && (
          <span className="text-text-muted text-xs">· {Math.round(proposal.confidence * 100)}%</span>
        )}
      </div>
      <div>
        <span className="text-text-muted line-through">{proposal.current_value || "∅"}</span>
        <span className="text-text-muted mx-1.5">→</span>
        <span className="text-text-primary">{proposal.proposed_value || "∅"}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-text-muted text-xs">{proposal.origin}</span>
        <form action={formAction} className="flex items-center gap-2 ml-auto">
          <input type="hidden" name="contact_id" value={contactId} />
          <input type="hidden" name="proposal_id" value={proposal.id} />
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
      </div>
      {state && "error" in state && <p className="text-danger text-xs">{state.error}</p>}
    </li>
  );
}

export function ContactProposals({
  contactId,
  proposals,
  action,
}: {
  contactId: string;
  proposals: CrmProposal[];
  action: (prev: ResolveResult, formData: FormData) => Promise<ResolveResult>;
}) {
  if (proposals.length === 0) {
    return null;
  }

  return (
    <section className="bg-bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-text-primary">
          Open proposals <span className="text-text-muted font-normal">({proposals.length})</span>
        </h2>
        <p className="text-text-muted text-xs mt-0.5">Machine-suggested changes awaiting your decision.</p>
      </div>
      <ul className="divide-y divide-border-subtle">
        {proposals.map((proposal) => (
          <ProposalRow
            key={proposal.id}
            contactId={contactId}
            proposal={proposal}
            action={action}
          />
        ))}
      </ul>
    </section>
  );
}
