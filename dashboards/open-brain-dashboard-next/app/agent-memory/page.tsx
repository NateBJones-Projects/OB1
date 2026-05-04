import Link from "next/link";
import { revalidatePath } from "next/cache";
import {
  agentMemoryDefaults,
  fetchAgentMemories,
  reviewAgentMemory,
} from "@/lib/agent-memory";
import { requireSessionOrRedirect } from "@/lib/auth";
import {
  PolicyBadges,
  ProvenanceBadge,
  StatusBadge,
} from "@/components/AgentMemoryBadges";
import { FormattedDate } from "@/components/FormattedDate";
import type { AgentMemoryReviewAction } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES = ["pending", "evidence_only", "confirmed", "rejected", "stale"] as const;
const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  evidence_only: "Evidence",
  confirmed: "Confirmed",
  rejected: "Rejected",
  stale: "Stale",
  all: "All",
};

export default async function AgentMemoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { apiKey } = await requireSessionOrRedirect();
  const defaults = agentMemoryDefaults();
  const params = await searchParams;
  const workspaceId = params.workspace_id || defaults.workspaceId;
  const projectId = params.project_id ?? defaults.projectId;
  const status = params.review_status ?? "pending";
  const limit = parseInt(params.limit || "50", 10);

  let data;
  let error: string | null = null;
  try {
    data = await fetchAgentMemories(apiKey, {
      workspace_id: workspaceId,
      project_id: projectId || undefined,
      review_status: status === "all" ? undefined : status,
      limit,
    });
  } catch (err) {
    data = { memories: [], count: 0 };
    error = err instanceof Error ? err.message : "Failed to load agent memory";
  }

  async function reviewAction(formData: FormData) {
    "use server";
    const { apiKey } = await requireSessionOrRedirect();
    const memoryId = String(formData.get("memory_id") || "");
    const action = String(formData.get("action") || "") as AgentMemoryReviewAction;
    await reviewAgentMemory(apiKey, memoryId, action, {
      actor_label: "Open Brain dashboard",
      notes: `Dashboard ${action}`,
    });
    revalidatePath("/agent-memory");
  }

  function statusUrl(nextStatus: string) {
    const sp = new URLSearchParams();
    sp.set("workspace_id", workspaceId);
    if (projectId) sp.set("project_id", projectId);
    sp.set("review_status", nextStatus);
    return `/agent-memory?${sp.toString()}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((item) => (
            <Link
              key={item}
              href={statusUrl(item)}
              className={`border px-3 py-1.5 text-sm transition-colors ${
                status === item
                  ? "border-violet/30 bg-violet-surface text-violet"
                  : "border-border bg-bg-surface text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              }`}
            >
              {STATUS_LABELS[item]}
            </Link>
          ))}
          <Link
            href={statusUrl("all")}
            className={`border px-3 py-1.5 text-sm transition-colors ${
              status === "all"
                ? "border-violet/30 bg-violet-surface text-violet"
                : "border-border bg-bg-surface text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            }`}
          >
            All
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <p className="font-mono text-xs text-text-muted">
            {workspaceId}
            <span className="mx-2 text-text-muted/60">/</span>
            {projectId || "all-projects"}
          </p>
        <Link
          href="/agent-memory/traces"
          className="ob1-command-button h-9 px-3 text-sm"
        >
          Recall traces
        </Link>
        </div>
      </div>

      {error && <p className="text-danger text-sm">{error}</p>}

      <div className="ob1-glass-panel overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wider text-text-muted">
              <th className="px-4 py-3 text-left font-medium">
                Memories:{" "}
                <span className="font-mono tracking-normal text-text-secondary">
                  {data.count}/{limit}
                </span>
              </th>
              <th className="px-4 py-3 text-left font-medium w-48">Trust</th>
              <th className="px-4 py-3 text-left font-medium w-44">Policy</th>
              <th className="px-4 py-3 text-left font-medium w-40">Created</th>
              <th className="px-4 py-3 text-right font-medium w-56">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {data.memories.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-text-muted">
                  No agent memories match this view.
                </td>
              </tr>
            ) : (
              data.memories.map((memory) => (
                <tr key={memory.memory_id} className="ob1-memory-row align-top">
                  <td className="px-4 py-3">
                    <Link
                      href={`/agent-memory/${memory.memory_id}`}
                      className="font-medium text-text-primary hover:text-violet transition-colors"
                    >
                      {memory.summary}
                    </Link>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">
                      {memory.content}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-text-muted">
                      <span>{memory.scope.visibility}</span>
                      {memory.scope.project_id && <span>{memory.scope.project_id}</span>}
                      {memory.provenance.runtime && <span>{memory.provenance.runtime}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <ProvenanceBadge value={memory.provenance.status} />
                      <StatusBadge
                        value={
                          memory.use_policy.requires_user_confirmation
                            ? "pending"
                            : memory.use_policy.can_use_as_instruction
                              ? "confirmed"
                              : "evidence_only"
                        }
                      />
                    </div>
                    <p className="mt-2 text-xs text-text-muted">
                      Confidence {(memory.provenance.confidence * 100).toFixed(0)}%
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <PolicyBadges policy={memory.use_policy} />
                  </td>
                  <td className="px-4 py-3 text-xs text-text-muted">
                    <FormattedDate date={memory.freshness.created_at} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <form action={reviewAction}>
                        <input type="hidden" name="memory_id" value={memory.memory_id} />
                        <input type="hidden" name="action" value="evidence_only" />
                        <button className="border border-border px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary">
                          Evidence
                        </button>
                      </form>
                      <form action={reviewAction}>
                        <input type="hidden" name="memory_id" value={memory.memory_id} />
                        <input type="hidden" name="action" value="confirm" />
                        <button className="border border-success/30 px-2 py-1 text-xs text-success hover:bg-success/10">
                          Confirm
                        </button>
                      </form>
                      <form action={reviewAction}>
                        <input type="hidden" name="memory_id" value={memory.memory_id} />
                        <input type="hidden" name="action" value="reject" />
                        <button className="border border-danger/30 px-2 py-1 text-xs text-danger hover:bg-danger/10">
                          Reject
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
