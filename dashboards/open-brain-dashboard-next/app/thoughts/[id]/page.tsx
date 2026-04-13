import { notFound, redirect } from "next/navigation";
import {
  fetchThought,
  updateThought,
  deleteThought,
  fetchReflections,
  ApiError,
} from "@/lib/api";
import { requireSessionOrRedirect, getSession } from "@/lib/auth";
import { TypeBadge } from "@/components/ThoughtCard";
import { ThoughtEditor } from "@/components/ThoughtEditor";
import { ThoughtDeleteButton } from "@/components/ThoughtDeleteButton";
import { ReflectionComposer } from "@/components/ReflectionComposer";
import { ConnectionsPanel } from "@/components/ConnectionsPanel";
import { FormattedDate } from "@/components/FormattedDate";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ThoughtDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { apiKey } = await requireSessionOrRedirect();
  const session = await getSession();
  const excludeRestricted = !session.restrictedUnlocked;
  const { id } = await params;
  const thoughtId = parseInt(id, 10);
  if (isNaN(thoughtId)) notFound();

  let thought;
  try {
    thought = await fetchThought(apiKey, thoughtId, excludeRestricted);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
          <div className="text-4xl">🔒</div>
          <h1 className="text-xl font-semibold text-text-primary">Restricted Content</h1>
          <p className="text-text-secondary text-sm text-center max-w-md">
            This thought is classified as restricted. Unlock restricted content using the lock icon in the sidebar to view it.
          </p>
          <Link
            href="/thoughts"
            className="px-4 py-2 bg-violet hover:bg-violet-dim text-white text-sm rounded-lg transition-colors"
          >
            Back to Thoughts
          </Link>
        </div>
      );
    }
    notFound();
  }

  let reflections: Awaited<ReturnType<typeof fetchReflections>> = [];
  try {
    reflections = await fetchReflections(apiKey, thoughtId);
  } catch {
    reflections = [];
  }

  const meta = thought.metadata || {};
  const topics = (meta.topics as string[]) || [];
  const tags = (meta.tags as string[]) || [];

  async function editAction(formData: FormData) {
    "use server";
    const { apiKey } = await requireSessionOrRedirect();
    const content = formData.get("content") as string;
    const type = formData.get("type") as string;
    const importance = parseInt(formData.get("importance") as string, 10);
    await updateThought(apiKey, thoughtId, { content, type, importance });
  }

  async function deleteAction() {
    "use server";
    const { apiKey } = await requireSessionOrRedirect();
    await deleteThought(apiKey, thoughtId);
    redirect("/thoughts");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <TypeBadge type={thought.type} />
            {thought.status && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-violet/15 text-violet border-violet/20">
                {thought.status}
              </span>
            )}
            <span className="text-xs text-text-muted font-mono">
              ID: {thought.id}
            </span>
            {thought.uuid && (
              <span className="text-xs text-text-muted font-mono">
                UUID: {thought.uuid}
              </span>
            )}
            <span className="text-xs text-text-muted">
              Importance: {thought.importance}
            </span>
            {thought.quality_score > 0 && (
              <span className="text-xs text-text-muted">
                Quality: {thought.quality_score}
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted">
            Created <FormattedDate date={thought.created_at} />
            {thought.source_type && ` | Source: ${thought.source_type}`}
            {thought.sensitivity_tier &&
              thought.sensitivity_tier !== "standard" &&
              ` | Sensitivity: ${thought.sensitivity_tier}`}
          </p>
        </div>
        <ThoughtDeleteButton deleteAction={deleteAction} />
      </div>

      {/* Content + Edit */}
      <ThoughtEditor thought={thought} editAction={editAction} />

      {/* Metadata panel */}
      {(topics.length > 0 ||
        tags.length > 0 ||
        Object.keys(meta).length > 0) && (
        <div className="bg-bg-surface border border-border rounded-lg p-5">
          <h3 className="text-sm font-medium text-text-primary mb-3">
            Metadata
          </h3>
          {topics.length > 0 && (
            <div className="mb-3">
              <span className="text-xs text-text-muted">Topics: </span>
              <div className="inline-flex flex-wrap gap-1.5 ml-1">
                {topics.map((t) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 rounded bg-violet-surface text-violet text-xs"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {tags.length > 0 && (
            <div className="mb-3">
              <span className="text-xs text-text-muted">Tags: </span>
              <div className="inline-flex flex-wrap gap-1.5 ml-1">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 rounded bg-bg-elevated text-text-secondary text-xs"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {typeof meta.summary === "string" && (
            <div>
              <span className="text-xs text-text-muted">Summary: </span>
              <span className="text-sm text-text-secondary">
                {meta.summary}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Connections */}
      <ConnectionsPanel
        thoughtId={thought.id}
        hasMetadata={
          topics.length > 0 ||
          ((meta.people as string[]) || []).length > 0
        }
      />

      {/* Reflections */}
      {reflections.length > 0 && (
        <div>
          <h3 className="text-lg font-medium mb-3">Reflections</h3>
          <div className="space-y-3">
            {reflections.map((r) => (
              <div
                key={r.id}
                className="bg-bg-surface border border-border rounded-lg p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-violet font-medium">
                    {r.reflection_type}
                  </span>
                  <span className="text-xs text-text-muted">
                    Confidence: {(r.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-sm text-text-secondary">{r.conclusion}</p>
                {r.trigger_context && (
                  <p className="text-xs text-text-muted mt-2">
                    Trigger: {r.trigger_context}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <ReflectionComposer thoughtId={thought.id} />
    </div>
  );
}
