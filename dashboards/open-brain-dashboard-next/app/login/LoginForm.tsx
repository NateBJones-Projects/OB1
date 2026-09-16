"use client";

import { useActionState } from "react";

export function LoginForm({
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
      <div>
        <label
          htmlFor="apiKey"
          className="block text-sm font-medium text-text-secondary mb-1.5"
        >
          OB1 Access Key
        </label>
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          required
          autoFocus
          placeholder="your-ob1-key"
          className="w-full border border-border bg-bg-surface px-4 py-2.5 text-text-primary placeholder-text-muted transition focus:border-violet focus:outline-none focus:ring-1 focus:ring-violet/30"
        />
      </div>

      {state?.error && (
        <p className="text-danger text-sm">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full border border-violet/35 bg-violet-surface py-2.5 font-medium text-violet transition-colors hover:bg-violet/15 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Verifying..." : "Sign in"}
      </button>
    </form>
  );
}
