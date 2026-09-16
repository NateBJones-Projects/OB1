"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

/**
 * Optional dashboard snippet — client component that drives a Next.js
 * Server Action to run `scripts/synthesize-wiki.mjs --topic autobiography`
 * and report status inline. Pairs with `app/wiki/page.tsx`.
 *
 * Styling assumes a Tailwind CSS setup with these classes defined:
 *   text-text-muted, text-text-primary, text-text-secondary, text-danger
 *   bg-bg-hover, bg-bg-surface, bg-violet-surface
 *   border-border, border-violet/40, text-violet, hover:bg-violet/20
 * Swap these for whatever your dashboard theme uses.
 */
export interface GenerateAutobiographyActionState {
  status: "idle" | "ok" | "error";
  message?: string;
  slug?: string;
}

export function GenerateAutobiographyButton({
  action,
  variant = "primary",
  label,
}: {
  action: (
    state: GenerateAutobiographyActionState,
    formData: FormData,
  ) => Promise<GenerateAutobiographyActionState>;
  variant?: "primary" | "chip";
  label?: string;
}) {
  const [state, formAction] = useActionState<
    GenerateAutobiographyActionState,
    FormData
  >(action, { status: "idle" });

  return (
    <form action={formAction} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-text-muted">
          Scope
          <select
            name="scope_year"
            defaultValue=""
            className="ml-1.5 bg-bg-hover border border-border rounded px-1.5 py-0.5 text-[11px] text-text-primary"
          >
            <option value="">all years</option>
            {yearOptions().map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton variant={variant} label={label} />
      </div>
      {state.status === "ok" && (
        <p className="text-[11px] text-emerald-400">
          {state.message ?? "Generated."}
        </p>
      )}
      {state.status === "error" && (
        <p className="text-[11px] text-danger">
          {state.message ?? "Failed to generate."}
        </p>
      )}
    </form>
  );
}

function SubmitButton({
  variant,
  label,
}: {
  variant: "primary" | "chip";
  label?: string;
}) {
  const { pending } = useFormStatus();
  const base =
    variant === "primary"
      ? "px-4 py-2 text-sm font-medium rounded-md border"
      : "px-2.5 py-1 text-[11px] font-medium rounded-full border";
  const color = pending
    ? "border-border bg-bg-hover text-text-muted cursor-wait"
    : "border-violet/40 bg-violet-surface text-violet hover:bg-violet/20";
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${base} ${color} transition-colors`}
    >
      {pending
        ? "Generating..."
        : label ?? (variant === "chip" ? "Regenerate" : "Generate autobiography")}
    </button>
  );
}

/** Current year + 5 previous. Enough for scoped quick-tests. */
function yearOptions(): number[] {
  const now = new Date().getUTCFullYear();
  return [now, now - 1, now - 2, now - 3, now - 4, now - 5];
}
