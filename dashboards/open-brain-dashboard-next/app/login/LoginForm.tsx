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
          className="block text-[13px] font-medium text-text-secondary mb-1.5"
        >
          Access key
        </label>
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          required
          autoFocus
          placeholder="Paste your access key"
          className="w-full px-3.5 py-2.5 bg-bg-surface border border-border rounded-lg text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition"
        />
      </div>

      {state?.error && (
        <p className="text-danger text-sm">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full py-2.5 bg-accent hover:bg-accent/90 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
