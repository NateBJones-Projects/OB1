import { FormattedDate } from "@/components/FormattedDate";
import { requireSessionOrRedirect } from "@/lib/auth";
import { listPendingThoughts } from "@/lib/triage";
import { promotePendingThoughtAction } from "./actions";

export const dynamic = "force-dynamic";

function MetadataBadge({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-elevated px-2 py-1 text-xs text-text-secondary">
      <span className="text-text-muted">{label}</span>
      <span>{String(value)}</span>
    </span>
  );
}

export default async function TriagePage() {
  await requireSessionOrRedirect();

  let pending;
  try {
    pending = await listPendingThoughts(50);
  } catch (err) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Triage</h1>
          <p className="text-text-secondary text-sm">
            Review low-confidence Open Brain captures before promoting them.
          </p>
        </div>
        <p className="text-danger text-sm">
          Failed to load pending thoughts.{" "}
          {err instanceof Error ? err.message : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Triage</h1>
          <p className="text-text-secondary text-sm">
            {pending.length.toLocaleString()} low-confidence capture
            {pending.length === 1 ? "" : "s"} waiting for review.
          </p>
        </div>
      </div>

      {pending.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-surface p-8 text-center">
          <p className="text-text-primary font-medium">No pending thoughts.</p>
          <p className="text-text-muted text-sm mt-1">
            Low-confidence captures will appear here when the MCP routes them to
            `thoughts_pending`.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((row) => {
            const metadata = row.candidate_metadata || {};
            return (
              <article
                key={row.id}
                className="rounded-lg border border-border bg-bg-surface p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <p className="text-text-primary leading-relaxed">
                      {row.content}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <MetadataBadge label="confidence" value={row.confidence} />
                      <MetadataBadge label="type" value={metadata.type} />
                      <MetadataBadge label="program" value={metadata.program_id} />
                      <MetadataBadge
                        label="workstream"
                        value={metadata.workstream}
                      />
                      <MetadataBadge label="source" value={row.source_ref} />
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-text-muted whitespace-nowrap">
                    <FormattedDate date={row.created_at} />
                  </span>
                </div>

                {row.surrounding_context && (
                  <div className="rounded-md border border-border-subtle bg-bg-elevated p-3">
                    <p className="text-xs uppercase tracking-wider text-text-muted mb-1">
                      Context
                    </p>
                    <p className="text-sm text-text-secondary whitespace-pre-wrap">
                      {row.surrounding_context}
                    </p>
                  </div>
                )}

                <details className="text-sm">
                  <summary className="cursor-pointer text-text-muted hover:text-text-secondary">
                    Candidate metadata
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-md border border-border-subtle bg-bg-elevated p-3 text-xs text-text-secondary">
                    {JSON.stringify(metadata, null, 2)}
                  </pre>
                </details>

                <form action={promotePendingThoughtAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <button
                    type="submit"
                    className="rounded-lg bg-violet px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
                  >
                    Promote to thoughts
                  </button>
                </form>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
