"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Props = {
  redirectTo: string;
};

export function LoginForm({ redirectTo }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(formData: FormData) {
    setError(null);

    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    if (!email || !password) {
      setError("Email and password are both required.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      return;
    }

    startTransition(() => {
      router.push(redirectTo);
      router.refresh();
    });
  }

  return (
    <div className="card stack">
      <div>
        <span className="pill">Owner Sign-In</span>
        <h1 className="headline" style={{ fontSize: "clamp(2rem, 3vw, 3.5rem)" }}>
          Authenticate your Open Brain owner account
        </h1>
        <p className="muted">
          Use the Supabase Auth user you created for Open Brain. After sign-in, this portal sends
          you back to the pending consent screen.
        </p>
      </div>
      <form
        className="stack"
        action={(formData) => {
          void handleSubmit(formData);
        }}
      >
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" />
        </div>
        {error ? <div className="error">{error}</div> : null}
        <button type="submit" disabled={isPending}>
          {isPending ? "Signing In..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
