"use client";

import { useActionState, useState } from "react";

// The server action returns one of these; `undefined` is the initial state.
export type AddMethodResult = { ok: true } | { error: string } | undefined;

// Common method types. The truth layer accepts arbitrary strings, so "other"
// falls back to a free-text input for anything not in the list.
const METHOD_TYPES = ["email", "phone", "address", "handle", "url", "other"];

export function AddMethodForm({
  contactId,
  action,
}: {
  contactId: string;
  action: (prev: AddMethodResult, formData: FormData) => Promise<AddMethodResult>;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("email");
  const [state, formAction, pending] = useActionState(
    async (prev: AddMethodResult, formData: FormData) => {
      const result = await action(prev, formData);
      if (result && "ok" in result && result.ok) {
        setOpen(false);
        setType("email");
      }
      return result;
    },
    undefined
  );

  if (!open) {
    return (
      <div className="px-4 py-3 border-t border-border">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-text-muted hover:text-violet transition-colors"
        >
          + Add method
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="px-4 py-3 border-t border-border space-y-3">
      <input type="hidden" name="id" value={contactId} />
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="method_type" className="block text-text-muted text-xs uppercase tracking-wider mb-1">
            Type
          </label>
          <select
            id="method_type"
            name="method_type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="px-3 py-1.5 bg-bg-elevated border border-border rounded text-text-primary text-sm focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition"
          >
            {METHOD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        {type === "other" && (
          <div>
            <label htmlFor="method_type_custom" className="block text-text-muted text-xs uppercase tracking-wider mb-1">
              Custom type
            </label>
            <input
              id="method_type_custom"
              name="method_type_custom"
              placeholder="e.g. fax"
              className="px-3 py-1.5 bg-bg-elevated border border-border rounded text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition"
            />
          </div>
        )}
        <div className="flex-1 min-w-[12rem]">
          <label htmlFor="value" className="block text-text-muted text-xs uppercase tracking-wider mb-1">
            Value
          </label>
          <input
            id="value"
            name="value"
            required
            placeholder="ada@example.com"
            className="w-full px-3 py-1.5 bg-bg-elevated border border-border rounded text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition"
          />
        </div>
        <div>
          <label htmlFor="label" className="block text-text-muted text-xs uppercase tracking-wider mb-1">
            Label
          </label>
          <input
            id="label"
            name="label"
            placeholder="work (optional)"
            className="px-3 py-1.5 bg-bg-elevated border border-border rounded text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-text-secondary text-sm">
        <input type="checkbox" name="is_primary" value="true" className="accent-violet" />
        Primary
      </label>

      {state && "error" in state && <p className="text-danger text-xs">{state.error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded bg-violet hover:bg-violet-dim text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Adding…" : "Add method"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs px-3 py-1.5 rounded border border-border text-text-muted hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
