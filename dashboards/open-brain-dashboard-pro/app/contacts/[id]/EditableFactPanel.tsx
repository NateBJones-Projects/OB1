"use client";

import { useActionState, useState } from "react";

// The server action returns one of these; `undefined` is the initial state.
export type EditResult =
  | { ok: true }
  | { error: string; stale?: boolean }
  | undefined;

export interface EditableField {
  key: string;
  label: string;
  value: string;
  origin?: string;
  locked?: boolean;
  editable: boolean;
}

function OriginChip({ origin, locked }: { origin?: string; locked?: boolean }) {
  if (!origin && !locked) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-border bg-bg-elevated text-text-muted">
      {origin || "manual"}
      {locked && <span title="Locked" className="text-amber">🔒</span>}
    </span>
  );
}

export function EditableFactPanel({
  contactId,
  updatedAt,
  fields,
  action,
  lockAction,
}: {
  contactId: string;
  updatedAt: string;
  fields: EditableField[];
  action: (prev: EditResult, formData: FormData) => Promise<EditResult>;
  lockAction: (prev: EditResult, formData: FormData) => Promise<EditResult>;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // Close the editor as part of the action transition when the save succeeds;
  // the route revalidates server-side so the refreshed value (and its new
  // provenance chip) renders in place.
  const [state, formAction, pending] = useActionState(
    async (prev: EditResult, formData: FormData) => {
      const result = await action(prev, formData);
      if (result && "ok" in result && result.ok) setEditingKey(null);
      return result;
    },
    undefined
  );
  // Locking has its own transition so a lock error surfaces independently of
  // an in-flight field edit. The route revalidates on success, refreshing the
  // lock chip and flipping the toggle label.
  const [lockState, lockFormAction, lockPending] = useActionState(
    lockAction,
    undefined
  );

  const stale = !!(state && "stale" in state && state.stale);
  const lockError = lockState && "error" in lockState ? lockState.error : null;

  return (
    <section className="bg-bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-text-primary">Fields</h2>
        <p className="text-text-muted text-xs">
          Each field shows its origin; a lock blocks all writes until unlocked. Manual edits win over machine writers.
        </p>
      </div>

      {lockError && (
        <div className="px-4 py-2 border-b border-border bg-bg-elevated">
          <p className="text-danger text-sm">{lockError}</p>
        </div>
      )}

      {stale && (
        <div className="px-4 py-3 border-b border-border bg-bg-elevated flex items-center justify-between gap-3">
          <p className="text-amber text-sm">
            {state && "error" in state
              ? state.error
              : "This contact changed since you loaded it."}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-xs px-3 py-1.5 rounded border border-border text-text-primary hover:border-violet transition-colors shrink-0"
          >
            Reload
          </button>
        </div>
      )}

      <dl className="divide-y divide-border-subtle">
        {fields.map((field) => {
          const editing = editingKey === field.key;
          return (
            <div key={field.key} className="px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <dt className="text-text-muted text-xs uppercase tracking-wider">{field.label}</dt>
                  {!editing && (
                    <dd className="text-text-primary text-sm mt-0.5 break-words">
                      {field.value || <span className="text-text-muted">—</span>}
                    </dd>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <OriginChip origin={field.origin} locked={field.locked} />
                  {field.editable && !field.locked && !editing && (
                    <button
                      type="button"
                      onClick={() => setEditingKey(field.key)}
                      className="text-xs text-text-muted hover:text-violet transition-colors"
                    >
                      Edit
                    </button>
                  )}
                  {field.editable && !editing && (
                    <form action={lockFormAction} className="contents">
                      <input type="hidden" name="id" value={contactId} />
                      <input type="hidden" name="field_key" value={field.key} />
                      <input
                        type="hidden"
                        name="locked"
                        value={field.locked ? "false" : "true"}
                      />
                      <button
                        type="submit"
                        disabled={lockPending}
                        className="text-xs text-text-muted hover:text-violet transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title={
                          field.locked
                            ? "Unlock this field so it can be edited or written by agents"
                            : "Lock this field to block all writes until unlocked"
                        }
                      >
                        {field.locked ? "Unlock" : "Lock"}
                      </button>
                    </form>
                  )}
                </div>
              </div>

              {editing && (
                <>
                  <form action={formAction} className="mt-2 flex items-center gap-2">
                    <input type="hidden" name="id" value={contactId} />
                    <input type="hidden" name="field_key" value={field.key} />
                    <input type="hidden" name="expected_updated_at" value={updatedAt} />
                    <input
                      name="value"
                      defaultValue={field.value}
                      placeholder="Leave blank to clear"
                      className="flex-1 px-3 py-1.5 bg-bg-elevated border border-border rounded text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition"
                    />
                    <button
                      type="submit"
                      disabled={pending}
                      className="text-xs px-3 py-1.5 rounded bg-violet hover:bg-violet-dim text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    >
                      {pending ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingKey(null)}
                      className="text-xs px-3 py-1.5 rounded border border-border text-text-muted hover:text-text-primary transition-colors shrink-0"
                    >
                      Cancel
                    </button>
                  </form>
                  {state && "error" in state && !stale && (
                    <p className="text-danger text-xs mt-1">{state.error}</p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </dl>
    </section>
  );
}
