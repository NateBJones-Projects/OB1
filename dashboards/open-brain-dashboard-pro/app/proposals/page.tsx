import Link from "next/link";
import { revalidatePath } from "next/cache";
import { fetchCrmProposals, resolveCrmProposal, resolveCrmProposalsByRun, ApiError } from "@/lib/api";
import { requireSessionOrRedirect } from "@/lib/auth";
import { FormattedDate } from "@/components/FormattedDate";
import { ProposalDecision } from "./ProposalDecision";
import type { ResolveResult } from "./ProposalDecision";
import { RunBulkActions } from "./RunBulkActions";

export const dynamic = "force-dynamic";

const STATUSES = ["open", "accepted", "rejected", "all"];

// origin_ref is an opaque JSON bag; the run id, when present, lives under run_id.
function runIdOf(originRef: Record<string, unknown>): string | null {
  const value = originRef?.run_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "open"
      ? "text-violet border-violet/30 bg-violet-surface"
      : status === "accepted"
        ? "text-emerald border-emerald/30 bg-emerald/10"
        : "text-text-muted border-border bg-bg-elevated";
  return <span className={`inline-block text-xs px-2 py-0.5 rounded border ${color}`}>{status}</span>;
}

async function resolveOneAction(
  _prev: ResolveResult,
  formData: FormData
): Promise<ResolveResult> {
  "use server";
  const { apiKey } = await requireSessionOrRedirect();
  const proposalId = String(formData.get("proposal_id") || "");
  const decision = String(formData.get("decision") || "");
  if (!proposalId || (decision !== "accept" && decision !== "reject")) {
    return { error: "That decision can't be recorded." };
  }

  try {
    await resolveCrmProposal(apiKey, proposalId, { decision, actor: "dashboard" });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[proposals/resolve] upstream", err.status, err.upstreamBody);
      if (err.status === 409) {
        return { error: "This proposal was already decided. Reload to refresh." };
      }
      if (err.status === 403) {
        return { error: "You can't decide this proposal." };
      }
      if (err.status === 404) {
        return { error: "This proposal no longer exists. Reload to refresh." };
      }
      return { error: err.message };
    }
    console.error("[proposals/resolve]", err);
    return { error: "Failed to record the decision." };
  }

  revalidatePath("/proposals");
  return { ok: true };
}

async function resolveRunAction(
  _prev: ResolveResult,
  formData: FormData
): Promise<ResolveResult> {
  "use server";
  const { apiKey } = await requireSessionOrRedirect();
  const runId = String(formData.get("run_id") || "");
  const decision = String(formData.get("decision") || "");
  if (!runId || (decision !== "accept" && decision !== "reject")) {
    return { error: "That decision can't be recorded." };
  }

  try {
    await resolveCrmProposalsByRun(apiKey, { run_id: runId, decision, actor: "dashboard" });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[proposals/resolve-run] upstream", err.status, err.upstreamBody);
      if (err.status === 403) {
        return { error: "You can't decide these proposals." };
      }
      return { error: err.message };
    }
    console.error("[proposals/resolve-run]", err);
    return { error: "Failed to record the decisions." };
  }

  revalidatePath("/proposals");
  return { ok: true };
}

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { apiKey } = await requireSessionOrRedirect();
  const params = await searchParams;
  const page = parseInt(params.page || "1", 10);
  const status = params.status || "open";
  const runId = params.run_id || undefined;

  let data;
  try {
    data = await fetchCrmProposals(apiKey, { page, per_page: 25, status, run_id: runId });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[proposals] upstream", err.status, err.upstreamBody);
    } else {
      console.error("[proposals]", err);
    }
    const safeMessage = err instanceof ApiError ? err.message : "";
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Proposals</h1>
        <p className="text-danger text-sm">Failed to load proposals. {safeMessage}</p>
      </div>
    );
  }

  const totalPages = Math.ceil(data.total / data.per_page);
  // Bulk-by-run resolves only the OPEN proposals in the run; count them so the
  // bar can hide its buttons once nothing is left to decide.
  const openInRun = runId ? data.data.filter((p) => p.status === "open").length : 0;

  function pageUrl(p: number) {
    const sp = new URLSearchParams();
    sp.set("page", String(p));
    sp.set("status", status);
    if (runId) sp.set("run_id", runId);
    return `/proposals?${sp.toString()}`;
  }

  function statusUrl(s: string) {
    const sp = new URLSearchParams();
    sp.set("status", s);
    if (runId) sp.set("run_id", runId);
    return `/proposals?${sp.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Proposals</h1>
        <p className="text-text-secondary text-sm">
          Machine-suggested changes awaiting a human decision. {data.total.toLocaleString()} {status !== "all" ? status : ""} total.
        </p>
      </div>

      <div className="flex gap-1.5">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={statusUrl(s)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors capitalize ${
              status === s ? "bg-violet-surface text-violet border-violet/20" : "bg-bg-elevated border-border text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      {runId && (
        <div className="space-y-2">
          <RunBulkActions runId={runId} openCount={openInRun} action={resolveRunAction} />
          <Link href={`/proposals?status=${status}`} className="text-xs text-text-muted hover:text-violet transition-colors">
            ← Clear run filter
          </Link>
        </div>
      )}

      <div className="bg-bg-surface border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Field</th>
              <th className="text-left px-4 py-3 font-medium">Change</th>
              <th className="text-left px-4 py-3 font-medium w-24">Origin</th>
              <th className="text-left px-4 py-3 font-medium w-24">Status</th>
              <th className="text-left px-4 py-3 font-medium w-40">Created</th>
              <th className="text-left px-4 py-3 font-medium w-44">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {data.data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                  No {status !== "all" ? status : ""} proposals{runId ? " in this run" : ""}.
                </td>
              </tr>
            )}
            {data.data.map((proposal) => {
              const proposalRunId = runIdOf(proposal.origin_ref);
              return (
                <tr key={proposal.id} className="hover:bg-bg-hover transition-colors align-top">
                  <td className="px-4 py-3">
                    <Link
                      href={`/contacts/${proposal.contact_id}`}
                      className="text-text-primary hover:text-violet transition-colors font-medium"
                    >
                      {proposal.field_key}
                    </Link>
                    <span className="text-text-muted text-xs block">{proposal.target_kind}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-text-muted line-through">{proposal.current_value || "∅"}</span>
                    <span className="text-text-muted mx-1.5">→</span>
                    <span className="text-text-primary">{proposal.proposed_value || "∅"}</span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    <span>{proposal.origin}</span>
                    {proposalRunId && !runId && (
                      <Link
                        href={`/proposals?status=${status}&run_id=${encodeURIComponent(proposalRunId)}`}
                        className="text-violet hover:text-violet-dim transition-colors block mt-0.5 font-mono break-all"
                        title="Filter to this import run"
                      >
                        run: {proposalRunId}
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={proposal.status} /></td>
                  <td className="px-4 py-3 text-text-muted text-xs whitespace-nowrap">
                    <FormattedDate date={proposal.created_at} />
                  </td>
                  <td className="px-4 py-3">
                    {proposal.status === "open" ? (
                      <ProposalDecision proposalId={proposal.id} action={resolveOneAction} />
                    ) : (
                      <span className="text-text-muted text-xs">
                        {proposal.decided_by ? `by ${proposal.decided_by}` : "—"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-muted">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={pageUrl(page - 1)} className="px-3 py-1.5 text-sm bg-bg-elevated border border-border rounded-lg text-text-secondary hover:bg-bg-hover transition-colors">Previous</Link>
            )}
            {page < totalPages && (
              <Link href={pageUrl(page + 1)} className="px-3 py-1.5 text-sm bg-bg-elevated border border-border rounded-lg text-text-secondary hover:bg-bg-hover transition-colors">Next</Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
