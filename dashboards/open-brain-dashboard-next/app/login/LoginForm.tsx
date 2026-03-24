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
          MCP Access Key
        </label>
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          required
          autoFocus
          placeholder="your-api-key"
          className="w-full px-4 py-2.5 bg-bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition"
        />
      </div>

      {state?.error && (
        <p className="text-danger text-sm">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full py-2.5 bg-violet hover:bg-violet-dim text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? "Verifying..." : "Sign in"}
      </button>
    </form>
  );
}
