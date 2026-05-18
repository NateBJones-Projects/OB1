"use client";

import { useActionState } from "react";

type FormState = {
  error?: string;
  success?: string;
};

export function LoginForm({
  credentialAction,
  githubAction,
  googleAction,
}: {
  credentialAction: (formData: FormData) => Promise<FormState | undefined>;
  githubAction: () => Promise<void>;
  googleAction: () => Promise<void>;
}) {
  const [credentialState, credentialFormAction, credentialPending] =
    useActionState(
      async (_prev: FormState | undefined, formData: FormData) => {
        return credentialAction(formData);
      },
      undefined
    );

  return (
    <div className="space-y-6">
      <form action={credentialFormAction} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-text-secondary mb-1.5"
          >
            Google / Gmail email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            placeholder="you@gmail.com"
            className="w-full px-4 py-2.5 bg-bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-text-secondary mb-1.5"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            placeholder="Your password"
            className="w-full px-4 py-2.5 bg-bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition"
          />
        </div>

        {credentialState?.error && (
          <p className="text-danger text-sm">{credentialState.error}</p>
        )}
        {credentialState?.success && (
          <p className="text-emerald-400 text-sm">{credentialState.success}</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="submit"
            name="intent"
            value="sign-in"
            disabled={credentialPending}
            className="w-full py-2.5 bg-violet hover:bg-violet-dim text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {credentialPending ? "Working..." : "Sign in"}
          </button>
          <button
            type="submit"
            name="intent"
            value="sign-up"
            disabled={credentialPending}
            className="w-full py-2.5 bg-bg-elevated border border-border text-text-primary font-medium rounded-lg transition-colors hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {credentialPending ? "Working..." : "Create account"}
          </button>
        </div>
      </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-bg-primary px-3 text-xs text-text-muted">
              Or continue with Google or GitHub
            </span>
          </div>
        </div>

      <div className="grid grid-cols-2 gap-3">
        <form action={googleAction}>
          <button
            type="submit"
            className="w-full py-2.5 bg-bg-elevated border border-border text-text-primary font-medium rounded-lg transition-colors hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue with Google
          </button>
        </form>

        <form action={githubAction}>
          <button
            type="submit"
            className="w-full py-2.5 bg-bg-elevated border border-border text-text-primary font-medium rounded-lg transition-colors hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue with GitHub
          </button>
        </form>
      </div>
    </div>
  );
}
