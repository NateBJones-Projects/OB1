"use client";

import { useActionState } from "react";

const FIELDS: Array<{ name: string; label: string; type: string; required?: boolean; placeholder?: string }> = [
  { name: "display_name", label: "Name", type: "text", required: true, placeholder: "Ada Lovelace" },
  { name: "canonical_email", label: "Email", type: "email", placeholder: "ada@example.com" },
  { name: "organization_name", label: "Organization", type: "text", placeholder: "Analytical Engines Ltd" },
  { name: "job_title", label: "Title", type: "text", placeholder: "Mathematician" },
];

export function NewContactForm({
  action,
}: {
  action: (formData: FormData) => Promise<{ error: string } | undefined>;
}) {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error: string } | undefined, formData: FormData) => {
      return await action(formData);
    },
    undefined
  );

  return (
    <form action={formAction} className="space-y-4">
      {FIELDS.map((field) => (
        <div key={field.name}>
          <label htmlFor={field.name} className="block text-sm font-medium text-text-secondary mb-1.5">
            {field.label}
            {field.required && <span className="text-danger"> *</span>}
          </label>
          <input
            id={field.name}
            name={field.name}
            type={field.type}
            required={field.required}
            placeholder={field.placeholder}
            className="w-full px-4 py-2.5 bg-bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition"
          />
        </div>
      ))}

      {state?.error && <p className="text-danger text-sm">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full py-2.5 bg-violet hover:bg-violet-dim text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? "Creating…" : "Create contact"}
      </button>
    </form>
  );
}
