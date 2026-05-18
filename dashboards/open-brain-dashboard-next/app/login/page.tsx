import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import {
  getGithubSignInUrl,
  getGoogleSignInUrl,
  signInWithPassword,
  signUpWithPassword,
} from "@/lib/supabaseAuth";
import { LoginForm } from "./LoginForm";

type LoginState = {
  error?: string;
  success?: string;
};

function normalizeEmail(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validatePassword(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

async function credentialAction(formData: FormData): Promise<LoginState | undefined> {
  "use server";

  const intent = formData.get("intent");
  const email = normalizeEmail(formData.get("email"));
  const password = validatePassword(formData.get("password"));

  if (!email) {
    return { error: "Email is required" };
  }

  if (!password) {
    return { error: "Password is required" };
  }

  try {
    if (intent === "sign-up") {
      const data = await signUpWithPassword(email, password);

      if (data.user && data.session) {
        const session = await getSession();
        session.userId = data.user.id;
        session.email = data.user.email ?? email;
        session.loggedIn = true;
        session.restrictedUnlocked = false;
        await session.save();
        redirect("/");
      }

      return {
        success:
          "Account created. Check your email to confirm your address before signing in.",
      };
    }

    const user = await signInWithPassword(email, password);
    const session = await getSession();
    session.userId = user.id;
    session.email = user.email ?? email;
    session.loggedIn = true;
    session.restrictedUnlocked = false;
    await session.save();

    redirect("/");
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Authentication failed",
    };
  }
}

async function githubAction() {
  "use server";

  const url = await getGithubSignInUrl("/");
  redirect(url);
}

async function googleAction() {
  "use server";

  const url = await getGoogleSignInUrl("/");
  redirect(url);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  if (session.loggedIn && session.userId) {
    redirect("/");
  }

  const params = await searchParams;
  const callbackError = params.error;

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary ml-0">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-violet flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl font-bold">OB</span>
          </div>
          <h1 className="text-2xl font-semibold text-text-primary">
            Open Brain
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Sign in with GitHub, Google, or your Google / Gmail email
          </p>
        </div>

        {callbackError && (
          <p className="text-danger text-sm mb-4 text-center">{callbackError}</p>
        )}

        <LoginForm
          credentialAction={credentialAction}
          githubAction={githubAction}
          googleAction={googleAction}
        />
      </div>
    </div>
  );
}
