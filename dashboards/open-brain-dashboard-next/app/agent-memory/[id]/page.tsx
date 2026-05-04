import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  fetchAgentMemory,
  reviewAgentMemory,
} from "@/lib/agent-memory";
import { requireSessionOrRedirect } from "@/lib/auth";
import {
  MemoryRecordPolicy,
  ProvenanceBadge,
  StatusBadge,
} from "@/components/AgentMemoryBadges";
import { FormattedDate } from "@/components/FormattedDate";
import type { AgentMemoryReviewAction } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AgentMemoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { apiKey } = await requireSessionOrRedirect();
  const { id } = await params;

  let memory;
  try {
    memory = await fetchAgentMemory(apiKey, id);
  } catch {
    notFound();
  }

  async function reviewAction(formData: FormData) {
    "use server";
    const { apiKey } = await requireSessionOrRedirect();
    const action = String(formData.get("action") || "") as AgentMemoryReviewAction;
    await reviewAgentMemory(apiKey, id, action, {
      actor_label: "Open Brain dashboard",
      notes: `Dashboard detail ${action}`,
    });
    revalidatePath(`/agent-memory/${id}`);
    revalidatePath("/agent-memory");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <Link
            href="/agent-memory"
            className="text-sm text-text-muted hover:text-violet transition-colors"
          >
            Back to Agent Memory
          </Link>
          <p className="ob1-section-label mt-4">Memory Inspector</p>
          <h1 className="mt-2 max-w-4xl truncate text-2xl font-semibold tracking-tight">
            {memory.summary}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={reviewAction}>
            <input type="hidden" name="action" value="evidence_only" />
            <button className="ob1-command-button h-9 px-3 text-sm">
              Evidence only
            </button>
          </form>
          <form action={reviewAction}>
            <input type="hidden" name="action" value="confirm" />
            <button className="h-9 border border-success/30 px-3 text-sm text-success hover:bg-success/10">
              Confirm
            </button>
          </form>
          <form action={reviewAction}>
            <input type="hidden" name="action" value="reject" />
            <button className="h-9 border border-danger/30 px-3 text-sm text-danger hover:bg-danger/10">
              Reject
            </button>
          </form>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_340px]">
        <section className="space-y-4">
          <div className="ob1-glass-panel p-5">
            <div className="mb-3 flex flex-wrap gap-2">
              <StatusBadge value={memory.review_status} />
              <StatusBadge value={memory.lifecycle_status} />
              <ProvenanceBadge value={memory.provenance_status} />
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-text-secondary">
              {memory.content}
            </p>
          </div>

          <div className="ob1-glass-panel p-5">
            <h2 className="ob1-section-label mb-3">Source References</h2>
            {memory.agent_memory_source_refs?.length ? (
              <div className="divide-y divide-border-subtle">
                {memory.agent_memory_source_refs.map((source) => (
                  <div key={source.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-sm text-text-primary">
                      {source.title || source.source_kind}
                    </p>
                    <p className="mt-1 text-xs text-text-muted">{source.source_kind}</p>
                    {source.uri && (
                      <p className="mt-1 break-all font-mono text-xs text-info">
                        {source.uri}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted">No source references saved.</p>
            )}
          </div>

          <div className="ob1-glass-panel p-5">
            <h2 className="ob1-section-label mb-3">Metadata</h2>
            <pre className="max-h-[360px] overflow-auto border border-border-subtle bg-black/20 p-3 text-xs leading-5 text-text-secondary">
              {JSON.stringify(memory.metadata, null, 2)}
            </pre>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="ob1-frost-panel p-4">
            <h2 className="ob1-section-label mb-3">Use Policy</h2>
            <MemoryRecordPolicy memory={memory} />
          </div>

          <div className="ob1-glass-panel p-4 text-sm">
            <h2 className="ob1-section-label mb-3">Scope</h2>
            <dl className="space-y-2 text-xs">
              <Row label="Workspace" value={memory.workspace_id} />
              <Row label="Project" value={memory.project_id || "none"} />
              <Row label="Visibility" value={memory.visibility} />
              <Row label="Channel" value={memory.channel_id || "none"} />
              <Row label="Task" value={memory.task_id || "none"} />
            </dl>
          </div>

          <div className="ob1-glass-panel p-4 text-sm">
            <h2 className="ob1-section-label mb-3">Origin</h2>
            <dl className="space-y-2 text-xs">
              <Row label="Created by" value={memory.created_by} />
              <Row label="Runtime" value={memory.runtime_name || "unknown"} />
              <Row label="Model" value={memory.model || "unknown"} />
              <Row label="Confidence" value={`${(Number(memory.confidence) * 100).toFixed(0)}%`} />
              <Row label="Created" value={<FormattedDate date={memory.created_at} />} />
              <Row label="Stale after" value={memory.stale_after ? <FormattedDate date={memory.stale_after} /> : "none"} />
            </dl>
          </div>

          <div className="ob1-glass-panel p-4 text-xs text-text-muted">
            <p className="break-all font-mono">ID: {memory.id}</p>
            {memory.thought_id && (
              <p className="mt-2 break-all font-mono">Thought: {memory.thought_id}</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right text-text-secondary">{value}</dd>
    </div>
  );
}
