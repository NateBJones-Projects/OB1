import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

async function loginAction(formData: FormData) {
  "use server";

  const apiKey = formData.get("apiKey") as string;
  if (!apiKey?.trim()) {
    return { error: "API key is required" };
  }

  // Validate key against health endpoint
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  try {
    const res = await fetch(`${apiUrl}/health`, {
      headers: { "x-brain-key": apiKey },
    });
    if (!res.ok) {
      return { error: "Invalid API key or service unavailable" };
    }
  } catch {
    return { error: "Could not reach API. Check your connection." };
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
          <div className="w-14 h-14 rounded-xl bg-violet flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl font-bold">OB</span>
          </div>
          <h1 className="text-2xl font-semibold text-text-primary">
            Open Brain
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Enter your API key to continue
          </p>
        </div>

        <LoginForm action={loginAction} />
      </div>
    </div>
  );
}
