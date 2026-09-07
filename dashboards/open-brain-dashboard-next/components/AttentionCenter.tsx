import Link from "next/link";
import type { AgentMemory } from "@/lib/types";

const PROJECTS = [
  { id: "open-brain", label: "OpenBrain" },
  { id: "dotfiles", label: "dotfiles" },
  { id: "3d-printing", label: "3D Printing" },
] as const;

function newestDate(memories: AgentMemory[]) {
  return memories.reduce<string | null>((latest, memory) => {
    const created = memory.freshness.created_at;
    return !latest || created > latest ? created : latest;
  }, null);
}

function shortDate(value: string | null) {
  if (!value) return "No project snapshot";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function AttentionCenter({
  memories,
  pending,
  stale,
  workspaceId,
  error,
}: {
  memories: AgentMemory[];
  pending: AgentMemory[];
  stale: AgentMemory[];
  workspaceId: string;
  error?: string | null;
}) {
  const needsAttention = pending.length + stale.length;

  return (
    <section className="ob1-glass-panel overflow-hidden rounded-lg">
      <div className="flex flex-col gap-4 border-b border-border px-5 py-5 md:flex-row md:items-start md:justify-between">
        <div>
          <span className="ob1-brand-kicker">Human checkpoint</span>
          <h2 className="mt-2 text-xl font-semibold">Needs your attention</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Decisions and stale context stay here until you review them. Evidence-only
            records remain available to agents but are not treated as instructions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`min-w-24 border px-4 py-3 text-center ${
            needsAttention > 0
              ? "border-warning/30 bg-warning/10 text-warning"
              : "border-success/30 bg-success/10 text-success"
          }`}>
            <div className="text-2xl font-bold">{needsAttention}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider">
              {needsAttention === 0 ? "All clear" : "Open items"}
            </div>
          </div>
          <Link href="/agent-memory" className="ob1-command-button h-11 px-4 text-sm">
            Open review queue
          </Link>
        </div>
      </div>

      {error ? (
        <div className="border-b border-danger/20 bg-danger/10 px-5 py-3 text-sm text-danger">
          Agent Memory status is unavailable: {error}
        </div>
      ) : needsAttention > 0 ? (
        <div className="grid gap-px border-b border-border bg-border md:grid-cols-2">
          {[...pending, ...stale].slice(0, 6).map((memory) => (
            <Link
              key={memory.memory_id}
              href={`/agent-memory/${memory.memory_id}`}
              className="bg-bg-primary px-5 py-4 transition-colors hover:bg-bg-hover"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wider text-warning">
                  {pending.some((item) => item.memory_id === memory.memory_id)
                    ? "Review"
                    : "Stale"}
                </span>
                <span className="font-mono text-xs text-text-muted">
                  {memory.scope.project_id || "unscoped"}
                </span>
              </div>
              <p className="mt-2 text-sm font-medium text-text-primary">
                {memory.summary}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="border-b border-success/20 bg-success/5 px-5 py-4 text-sm text-success">
          Nothing is waiting on you. Open Brain can continue using confirmed instructions
          and evidence-only context within their scopes.
        </div>
      )}

      <div className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="ob1-section-label">Project coverage</h3>
          <span className="text-xs text-text-muted">Latest captured project context</span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {PROJECTS.map((project) => {
            const projectMemories = memories.filter(
              (memory) => memory.scope.project_id === project.id
            );
            const projectPending = pending.filter(
              (memory) => memory.scope.project_id === project.id
            ).length;
            const latest = newestDate(projectMemories);
            return (
              <Link
                key={project.id}
                href={`/agent-memory?workspace_id=${encodeURIComponent(workspaceId)}&project_id=${project.id}&review_status=all`}
                className="border border-border bg-bg-surface p-4 transition-colors hover:bg-bg-hover"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{project.label}</span>
                  <span className={projectPending ? "text-xs text-warning" : "text-xs text-success"}>
                    {projectPending ? `${projectPending} to review` : latest ? "Current" : "Not captured"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-text-muted">
                  {projectMemories.length} records · {shortDate(latest)}
                </p>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
