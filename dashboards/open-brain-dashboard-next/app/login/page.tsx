import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

async function loginAction(formData: FormData) {
  "use server";

  const apiKey = formData.get("apiKey") as string;
  if (!apiKey?.trim()) {
    return { error: "Access key is required" };
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  try {
    const res = await fetch(`${apiUrl}/health`, {
      headers: { "x-brain-key": apiKey },
    });
    if (!res.ok) {
      return { error: "Invalid access key" };
    }
  } catch {
    return { error: "Service unavailable. Check your connection." };
  }

  const session = await getSession();
  session.apiKey = apiKey;
  session.loggedIn = true;
  await session.save();

  redirect("/");
}

export default async function LoginPage() {
  const session = await getSession();
  if (session.loggedIn && session.apiKey) {
    redirect("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary ml-0">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-lg bg-accent flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-lg font-semibold">AS</span>
          </div>
          <h1 className="text-xl font-semibold text-text-primary">
            Amicus Superbrain
          </h1>
          <p className="text-text-muted text-sm mt-1">
            Enter your access key to sign in
          </p>
        </div>

        <LoginForm action={loginAction} />
      </div>
    </div>
  );
}
